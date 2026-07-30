"""library publications snapshot takes ratings reports

Бібліотека — списки, виставлені на загал. П'ять таблиць плюс одна колонка.

Ключове в цій міграції — `ondelete`, і воно не автогенеровне:

* `publications.list_id` та `publications.owner_id` — SET NULL, а не CASCADE.
  Публікація переживає і видалення списку, і видалення акаунта автора; знімок у
  неї власний, тож список лишається корисним тим, хто його знайшов, а 128 взять
  і 31 оцінка не зникають разом із прибиранням у чужому словнику
  (ADR-0020). Розбіжність із `list_shares`, де обидва CASCADE, свідома.
* `publication_takes.user_id` і `publication_ratings.user_id` — CASCADE. Тут
  навпаки: пішовши з застосунку, людина більше не має цього списку, тож
  популярність мусить зменшитись, а її оцінка — зникнути.
* `publication_cards.publication_id` — CASCADE: знімок без публікації не існує,
  і заміна знімка = видалення дітей + вставка нових.

Revision ID: 11c058e7931c
Revises: 7a3c92d18f04
Create Date: 2026-07-30 13:21:35.185940

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '11c058e7931c'
down_revision: Union[str, Sequence[str], None] = '7a3c92d18f04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Констрейнт названий явно. Autogenerate лишає тут None, і тоді downgrade падає
# на drop_constraint(None, ...) — міграція нібито оборотна, а насправді ні. На це
# вже наступали у e1c11ae58ed3.
FK_LIST_PUBLICATION = "fk_word_lists_imported_from_publication_id_publications"

# Alembic не прибирає типи ENUM за drop_table. Без цього повторний upgrade падає
# на 'type "publicationreportreasonenum" already exists'.
REPORT_REASON_ENUM = "publicationreportreasonenum"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'publications',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_listed', sa.Boolean(), nullable=False),
        sa.Column('content_updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('list_id', sa.Integer(), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('hidden_by_id', sa.Integer(), nullable=True),
        sa.Column('derived_from_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['derived_from_id'], ['publications.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['hidden_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['list_id'], ['word_lists.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        # У списку публікація щонайбільше одна. NULL у Postgres не конфліктує сам
        # із собою, тож осиротілих (list_id IS NULL після видалення списку) може
        # бути скільки завгодно — і це правильно.
        sa.UniqueConstraint('list_id', name='uq_publications_list'),
    )
    # Окремого індексу на list_id немає навмисно: uq_publications_list уже є
    # унікальним індексом на цій колонці.
    op.create_index('ix_publications_listed_fresh', 'publications', ['is_listed', 'content_updated_at'], unique=False)
    op.create_index(op.f('ix_publications_owner_id'), 'publications', ['owner_id'], unique=False)

    op.create_table(
        'publication_cards',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('publication_id', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('word', sa.String(length=100), nullable=False),
        sa.Column('word_normalized', sa.String(length=100), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        # {"senses": [...], "forms": [...]} — рівно те, що API вже віддає в
        # перегляді чужого списку. Значення й форми читаються та перезаписуються
        # лише цілою карткою, тож окремих таблиць під них немає (ADR-0019).
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(['publication_id'], ['publications.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('publication_id', 'word_normalized', name='uq_publication_cards_word'),
    )
    # Гортання сторінками: WHERE publication_id = ? ORDER BY position. Окремий
    # індекс на publication_id не потрібен — цей його покриває.
    op.create_index('ix_publication_cards_page', 'publication_cards', ['publication_id', 'position'], unique=False)

    op.create_table(
        'publication_takes',
        sa.Column('publication_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        # Час ПЕРШОГО взяття; повторне його не бумкає. Витрина його ще не
        # показує, але без нього «популярні за 30 днів» не порахувати вже ніколи.
        sa.Column('taken_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['publication_id'], ['publications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        # Складений PK: одне взяття на людину. Саме тому популярність — це
        # COUNT(*), а не COUNT(DISTINCT user_id), і читається без пасток.
        sa.PrimaryKeyConstraint('publication_id', 'user_id'),
    )

    op.create_table(
        'publication_ratings',
        sa.Column('publication_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('stars', sa.SmallInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        # Межі стоять І в базі — навмисна відмова від того, як зроблено
        # desired_retention, де їх тримає лише Pydantic-схема.
        sa.CheckConstraint('stars BETWEEN 1 AND 5', name='ck_publication_ratings_stars'),
        sa.ForeignKeyConstraint(['publication_id'], ['publications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('publication_id', 'user_id'),
    )

    op.create_table(
        'publication_reports',
        sa.Column('publication_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Enum('OBSCENE', 'SPAM', 'WRONG', 'OTHER', name=REPORT_REASON_ENUM), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['publication_id'], ['publications.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('publication_id', 'user_id'),
    )

    # Провенанс: цей список — копія публікації. Читач у колонки один — позначка
    # «росте з ‹оригінал›» на похідній публікації.
    op.add_column('word_lists', sa.Column('imported_from_publication_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        FK_LIST_PUBLICATION,
        'word_lists',
        'publications',
        ['imported_from_publication_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(FK_LIST_PUBLICATION, 'word_lists', type_='foreignkey')
    op.drop_column('word_lists', 'imported_from_publication_id')

    op.drop_table('publication_reports')
    op.drop_table('publication_ratings')
    op.drop_table('publication_takes')
    op.drop_index('ix_publication_cards_page', table_name='publication_cards')
    op.drop_table('publication_cards')
    op.drop_index(op.f('ix_publications_owner_id'), table_name='publications')
    op.drop_index('ix_publications_listed_fresh', table_name='publications')
    op.drop_table('publications')

    op.execute(f'DROP TYPE IF EXISTS {REPORT_REASON_ENUM}')
