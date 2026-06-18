"""platform billing: índice único parcial — cobro idempotente por (tenant, método, referencia externa)

Cierra el race de doble-registro de cobro SaaS: `record_platform_billing_payment`
deduplica con check-then-insert (SELECT por external_reference → si existe, return;
si no, INSERT) SIN lock ni constraint. Dos entregas concurrentes del MISMO evento
de webhook (Stripe/Fintoc reintentan el mismo evento) → ambos SELECT ven 0 filas →
ambos insertan → fila de cobro duplicada + doble incremento de `uses_count` del
promo SaaS. En la práctica los proveedores entregan reintentos secuenciales (no
concurrentes), pero este índice enforce la invariante de idempotencia a nivel DB
como defensa en profundidad para integridad financiera.

`WHERE external_reference IS NOT NULL`: los cobros manuales (transferencia) sin
referencia externa NO se restringen — pueden existir varios por (tenant, método).

upgrade() primero resuelve duplicados preexistentes (deja el MÁS ANTIGUO por grupo
—el primero registrado— y borra los exactos posteriores), porque CREATE UNIQUE
INDEX falla si ya hay duplicados. Se espera que afecte 0 filas (el race no ocurre
con entrega secuencial), igual que la migración análoga de cash sessions.

Revision ID: 20260618_1200_pbpidem
Revises: 20260617_2000_cashopen
Create Date: 2026-06-18 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260618_1200_pbpidem"
down_revision: Union[str, None] = "20260617_2000_cashopen"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX_NAME = "uq_platform_billing_external_ref"


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Remediar duplicados preexistentes: por cada (tenant, método, referencia)
    #    con >1 fila, conservar la más antigua (primera registrada) y borrar el
    #    resto. Sólo aplica a referencias no nulas. Se espera 0 filas afectadas.
    bind.execute(
        sa.text(
            f"""
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY tenant_id, payment_method, external_reference
                           ORDER BY paid_at ASC NULLS LAST, id ASC
                       ) AS rn
                FROM platform_billing_payments
                WHERE external_reference IS NOT NULL
            )
            DELETE FROM platform_billing_payments p
            USING ranked
            WHERE p.id = ranked.id AND ranked.rn > 1
            """
        )
    )

    # 2) Índice único parcial: un solo cobro por (tenant, método, referencia externa).
    op.create_index(
        _INDEX_NAME,
        "platform_billing_payments",
        ["tenant_id", "payment_method", "external_reference"],
        unique=True,
        postgresql_where=sa.text("external_reference IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="platform_billing_payments")
