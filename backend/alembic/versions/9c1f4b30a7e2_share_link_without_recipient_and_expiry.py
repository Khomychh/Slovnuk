"""share link without recipient and expiry

Посилання на список зробили багаторазовим і безадресним, тож обидві колонки
перестали мати сенс:

* recipient_id — отримувачів у одного посилання може бути скільки завгодно, а
  колонка одна. Журналу «хто забрав» ми свідомо не заводимо.
* expires_at — жоден код її не встановлював і не перевіряв. Термін дії
  вирішили не робити взагалі: доступ вимикається через is_active.

Колонка, яку ніхто не читає і не пише, бреше про наміри — наступний читач
вирішив би, що адресний шер і термін дії десь реалізовані. Повернути будь-яку
з них — один ALTER.

Revision ID: 9c1f4b30a7e2
Revises: 04bea7bb47a2
Create Date: 2026-07-28 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c1f4b30a7e2'
down_revision: Union[str, Sequence[str], None] = '04bea7bb47a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('list_shares', 'recipient_id')
    op.drop_column('list_shares', 'expires_at')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'list_shares',
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'list_shares',
        sa.Column('recipient_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'list_shares_recipient_id_fkey',
        'list_shares',
        'users',
        ['recipient_id'],
        ['id'],
        ondelete='SET NULL',
    )
