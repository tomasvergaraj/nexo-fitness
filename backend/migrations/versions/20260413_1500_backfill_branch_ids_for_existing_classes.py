"""backfill branch ids for existing in-person and hybrid classes

Revision ID: 20260413_1500
Revises: 20260413_1400
Create Date: 2026-04-13 15:00:00
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "20260413_1500"
down_revision: Union[str, None] = "20260413_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        text(
            """
            WITH ranked_branches AS (
                SELECT
                    id,
                    tenant_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY tenant_id
                        ORDER BY
                            CASE WHEN is_active THEN 0 ELSE 1 END,
                            created_at ASC,
                            id ASC
                    ) AS rank_index
                FROM branches
            ),
            fallback_branch AS (
                SELECT tenant_id, id
                FROM ranked_branches
                WHERE rank_index = 1
            )
            UPDATE gym_classes AS gc
            SET branch_id = fb.id
            FROM fallback_branch AS fb
            WHERE gc.tenant_id = fb.tenant_id
              AND gc.branch_id IS NULL
              AND UPPER(CAST(gc.modality AS TEXT)) <> 'ONLINE'
            """
        )
    )


def downgrade() -> None:
    # Data backfill only. Reverting it safely would require restoring the previous NULL state.
    pass
