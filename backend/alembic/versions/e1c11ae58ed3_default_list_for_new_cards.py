"""default list for new cards

Revision ID: e1c11ae58ed3
Revises: 9c1f4b30a7e2
Create Date: 2026-07-28 20:07:46.404642

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1c11ae58ed3'
down_revision: Union[str, Sequence[str], None] = '9c1f4b30a7e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FK_NAME = "fk_user_settings_default_list_id_word_lists"


def upgrade() -> None:
    """Upgrade schema."""
    # Список за замовчуванням для нових карток (CONTEXT.md). NULL — нормальний
    # стан: жоден не позначено, нова картка створюється без списку.
    op.add_column(
        "user_settings", sa.Column("default_list_id", sa.Integer(), nullable=True)
    )
    # SET NULL, а не CASCADE: видалення списку не повинно ні падати, ні тягти за
    # собою видалення налаштувань користувача разом із цілями та вагами FSRS.
    #
    # Констрейнт названий явно. Autogenerate лишає ім'я None, і тоді downgrade
    # падає на drop_constraint(None, ...) — тобто міграція нібито оборотна, а
    # насправді ні.
    op.create_foreign_key(
        FK_NAME,
        "user_settings",
        "word_lists",
        ["default_list_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(FK_NAME, "user_settings", type_="foreignkey")
    op.drop_column("user_settings", "default_list_id")
