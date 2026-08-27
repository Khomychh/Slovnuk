"""combined daily goal

Сумарна денна ціль як другий СПОСІБ задати ціль (ADR-0032), а не третя ціль
поруч із двома.

Чому саме так:

* `goal_mode` зʼявляється у двох місцях. У `user_settings` — бо це преференція
  людини; у `study_days` — бо `10 / 30` і `100` не порівнюються між собою, і
  без режиму в рядку перемикання переглядало б минулі дні за правилом, якого
  тоді не існувало.
* Обидва набори чисел живуть у налаштуваннях постійно: перемикання режиму
  нічого не чистить, тож повернення до окремих цілей повертає ті самі 10/30.
* У `study_days`, навпаки, заповнена рівно та трійка, що судила день, а решта —
  NULL. Тому `new_goal` і `review_goal` стають nullable, а форму рядка тримає
  `ck_study_days_goal_shape`.
* Наявні рядки бекфіляться `SEPARATE`: міграція не має права мовчки змінити
  людині правило, за яким її судять.
* `daily_combined_goal` заводиться з 40 (10 + 30) — тим, що застосунок уже
  вважає нормальним днем. Нуль означав би «ціль вимкнено», і перемикач одразу
  давав би день, який не зараховується.
* Тимчасові `server_default` тут з тієї ж причини, що в c3f8a1d47b26: заповнити
  наявні рядки й одразу зняти, бо решта колонок `user_settings` тримає дефолти
  на боці Python.

Revision ID: b8f4d2c07a15
Revises: c3f8a1d47b26
Create Date: 2026-08-27 12:31:08.115204

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b8f4d2c07a15'
down_revision: Union[str, Sequence[str], None] = 'c3f8a1d47b26'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Alembic не прибирає типи ENUM за drop_column — без явного DROP TYPE повторний
# upgrade падає на 'type ... already exists' (на це вже наступали в 11c058e7931c).
GOAL_MODE_ENUM = "goalmodeenum"

# Тип для add_column доводиться створювати руками: усередині create_table
# SQLAlchemy робить це сама, а тут — ні.
goal_mode = postgresql.ENUM("SEPARATE", "COMBINED", name=GOAL_MODE_ENUM)

GOAL_SHAPE_CHECK = "ck_study_days_goal_shape"
GOAL_SHAPE_SQL = (
    "(goal_mode = 'SEPARATE'"
    " AND new_goal IS NOT NULL AND review_goal IS NOT NULL"
    " AND combined_goal IS NULL)"
    " OR (goal_mode = 'COMBINED'"
    " AND new_goal IS NULL AND review_goal IS NULL"
    " AND combined_goal IS NOT NULL)"
)


def upgrade() -> None:
    """Upgrade schema."""
    goal_mode.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "user_settings",
        sa.Column("goal_mode", goal_mode, nullable=False, server_default="SEPARATE"),
    )
    op.alter_column("user_settings", "goal_mode", server_default=None)
    op.add_column(
        "user_settings",
        sa.Column(
            "daily_combined_goal", sa.Integer(), nullable=False, server_default="40"
        ),
    )
    op.alter_column("user_settings", "daily_combined_goal", server_default=None)

    op.add_column(
        "study_days",
        sa.Column("goal_mode", goal_mode, nullable=False, server_default="SEPARATE"),
    )
    op.alter_column("study_days", "goal_mode", server_default=None)
    op.add_column("study_days", sa.Column("combined_goal", sa.Integer(), nullable=True))

    # Порожня колонка віднині означає «цього виміру того дня не було». Наявні
    # рядки під це правило вже підходять: усі вони SEPARATE і обидва числа мають.
    op.alter_column("study_days", "new_goal", existing_type=sa.Integer(), nullable=True)
    op.alter_column(
        "study_days", "review_goal", existing_type=sa.Integer(), nullable=True
    )

    op.create_check_constraint(GOAL_SHAPE_CHECK, "study_days", GOAL_SHAPE_SQL)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(GOAL_SHAPE_CHECK, "study_days", type_="check")

    # Сумарні дні втрачають свою ціль: у старій схемі її нема куди покласти.
    # Нулі означають «ціль вимкнено», і це чесніше, ніж вигадати числа, яких у
    # той день не існувало. Уже закриті дні від цього не змінюються — is_goal_met
    # заморожений, а перераховуються тільки незакриті.
    op.execute("UPDATE study_days SET new_goal = 0 WHERE new_goal IS NULL")
    op.execute("UPDATE study_days SET review_goal = 0 WHERE review_goal IS NULL")
    op.alter_column("study_days", "new_goal", existing_type=sa.Integer(), nullable=False)
    op.alter_column(
        "study_days", "review_goal", existing_type=sa.Integer(), nullable=False
    )

    op.drop_column("study_days", "combined_goal")
    op.drop_column("study_days", "goal_mode")

    op.drop_column("user_settings", "daily_combined_goal")
    op.drop_column("user_settings", "goal_mode")

    op.execute(f"DROP TYPE IF EXISTS {GOAL_MODE_ENUM}")
