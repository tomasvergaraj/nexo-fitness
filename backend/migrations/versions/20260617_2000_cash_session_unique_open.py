"""cash register: índice único parcial — un solo turno OPEN por (tenant, branch)

Cierra el race de doble-apertura: `open_cash_session` validaba con
check-then-insert sin lock ni constraint, así que dos aperturas concurrentes
(o doble-click) de la misma sucursal creaban dos turnos OPEN y el arqueo se
partía. Este índice único parcial enforce la invariante a nivel DB.

`COALESCE(branch_id, sentinel)` colapsa el branch_id NULL (turno sin sucursal):
en Postgres los NULL son distintos en un índice único, así que sin el COALESCE
dos turnos sin sucursal NO colisionarían.

upgrade() primero resuelve duplicados existentes (deja abierto el más reciente
por grupo y cierra los demás), porque CREATE UNIQUE INDEX falla si ya hay
duplicados en la tabla.

Revision ID: 20260617_2000_cashopen
Revises: f6a7b8c9d0e1
Create Date: 2026-06-17 20:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260617_2000_cashopen"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX_NAME = "uq_open_cash_session_per_branch"
_SENTINEL = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Remediar duplicados preexistentes: por cada (tenant, branch) con >1 turno
    #    OPEN, dejar abierto solo el más reciente (opened_at desc) y cerrar el resto.
    bind.execute(
        sa.text(
            f"""
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY tenant_id,
                                        COALESCE(branch_id, '{_SENTINEL}'::uuid)
                           ORDER BY opened_at DESC, id DESC
                       ) AS rn
                FROM cash_register_sessions
                WHERE status = 'open'
            )
            UPDATE cash_register_sessions s
            SET status = 'closed',
                closed_at = COALESCE(s.closed_at, now())
            FROM ranked
            WHERE s.id = ranked.id AND ranked.rn > 1
            """
        )
    )

    # 2) Índice único parcial: una sola sesión OPEN por (tenant, branch).
    op.create_index(
        _INDEX_NAME,
        "cash_register_sessions",
        [sa.text("tenant_id"), sa.text(f"COALESCE(branch_id, '{_SENTINEL}'::uuid)")],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="cash_register_sessions")
