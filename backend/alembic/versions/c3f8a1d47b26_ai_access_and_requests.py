"""ai access and requests

Заповнення картки з ШІ: два нові таблиці плюс одна колонка.

Чому саме так:

* `ai_access` — окрема таблиця з `user_id` первинним ключем, а не ще одне
  значення в `user_groups`. Доступ до ШІ — привілей, а не роль (ADR-0026):
  група одна на людину й відповідає на питання «хто ти в системі», тож
  адміністратор із доступом і адміністратор без нього мають бути однаково
  можливі. PK на `user_id` робить «одна видача на людину» гарантією типу даних.
* `ai_access.granted_by_user_id` — SET NULL, а не CASCADE. Адміністратор, який
  видав доступ, може піти з застосунку; виданий ним доступ від цього не
  скасовується. Розбіжність із `user_id` (CASCADE) свідома: там суб'єкт
  привілею, тут лише підпис під ним.
* `ai_requests` — журнал звернень, він же запобіжник «раз на слово» (ADR-0028).
  CASCADE на `user_id`, як усе інше в акаунті; ціна відома — витрати зниклого
  акаунта зникають разом із ним.
* `ix_ai_requests_user_word` складений, і окремого індексу на `user_id` немає:
  складений починається з тієї ж колонки, тож другий був би копією.
* `user_settings.transcription_variety` — преференція людини, а не властивість
  доступу до ШІ: зняли доступ і повернули — вибір лишився. Додається з
  тимчасовим server_default, щоб наявні рядки заповнились; далі default
  знімається, бо решта колонок `user_settings` теж тримає дефолти на боці Python.

Revision ID: c3f8a1d47b26
Revises: 11c058e7931c
Create Date: 2026-08-01 10:14:02.317845

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c3f8a1d47b26'
down_revision: Union[str, Sequence[str], None] = '11c058e7931c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Alembic не прибирає типи ENUM ані за drop_table, ані за drop_column. Без
# явного DROP TYPE повторний upgrade падає на 'type ... already exists' — на це
# вже наступали в 11c058e7931c.
TRANSCRIPTION_VARIETY_ENUM = "transcriptionvarietyenum"
AI_REQUEST_OUTCOME_ENUM = "airequestoutcomeenum"

# Тип для add_column доводиться створювати руками: усередині create_table
# SQLAlchemy робить це сама, а тут — ні.
transcription_variety = postgresql.ENUM("GB", "US", name=TRANSCRIPTION_VARIETY_ENUM)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'ai_access',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('granted_by_user_id', sa.Integer(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['granted_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )

    op.create_table(
        'ai_requests',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('word', sa.String(length=100), nullable=False),
        sa.Column('word_normalized', sa.String(length=100), nullable=False),
        sa.Column('model', sa.String(length=64), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column(
            'outcome',
            sa.Enum('PROPOSAL', 'REFUSAL', 'ERROR', name=AI_REQUEST_OUTCOME_ENUM),
            nullable=False,
        ),
        sa.Column('error_code', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ai_requests_user_word', 'ai_requests', ['user_id', 'word_normalized'], unique=False)

    transcription_variety.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'user_settings',
        sa.Column('transcription_variety', transcription_variety, nullable=False, server_default='GB'),
    )
    op.alter_column('user_settings', 'transcription_variety', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user_settings', 'transcription_variety')
    op.execute(f'DROP TYPE IF EXISTS {TRANSCRIPTION_VARIETY_ENUM}')

    op.drop_index('ix_ai_requests_user_word', table_name='ai_requests')
    op.drop_table('ai_requests')
    op.execute(f'DROP TYPE IF EXISTS {AI_REQUEST_OUTCOME_ENUM}')

    op.drop_table('ai_access')
