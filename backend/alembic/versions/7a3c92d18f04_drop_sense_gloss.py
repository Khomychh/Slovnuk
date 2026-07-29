"""drop word_senses.gloss

Уточнення знесено разом із поняттям (ADR-0012 не про це, але рішення того ж
дня). Підстава — дані: у 608 картках експорту старого PWA поле заповнене в 7
значеннях із 721, і пʼять із семи — випадкові натискання («m», «t», «them»).
Два змістовні (`US`/`UK` на парі apartment/flat) власник вирішив не переносити.

Колонка знімається до бойового імпорту, тож жодного рядка даних це не коштує.
Пошук по уточненню з `get_cards` теж прибрано.

Revision ID: 7a3c92d18f04
Revises: e1c11ae58ed3
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7a3c92d18f04"
down_revision: Union[str, Sequence[str], None] = "e1c11ae58ed3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("word_senses", "gloss")


def downgrade() -> None:
    # Повертається порожньою: вміст колонки не зберігався ніде, і відтворити
    # його нема з чого. Це чесніше, ніж вигадати дефолт.
    op.add_column(
        "word_senses",
        sa.Column("gloss", sa.String(length=255), nullable=True),
    )
