"""Правила пропозиції, які не залежать від того, хто саме відповідав."""

from app.schemas.ai import AiProposalSchema


# Позначка авторства коментаря. Це домовленість, а не мітка: щойно людина
# натисне «Зберегти», у базі лежатиме звичайний текст, і система вже не знатиме,
# що він прийшов від машини. Окрема колонка comment_source заради префікса не
# варта міграції — а сам префікс потрібен, щоб через рік було видно, чия це
# фраза.
AI_COMMENT_PREFIX = "ШІ: "


def mark_ai_comment(proposal: AiProposalSchema) -> AiProposalSchema:
    """
    Підписати коментар пропозиції.

    Робиться на бекенді, а не на фронтенді: роут має віддавати рядок, готовий
    лягти в поле, інакше контракт роута залежав би від коду, якого ще немає.

    Порожнього коментаря це не торкається — у більшості слів пастки немає, і
    `None` там правильна відповідь, а не пропуск.
    """
    if not proposal.comment:
        return proposal
    comment = proposal.comment.strip()
    if comment.startswith(AI_COMMENT_PREFIX):
        return proposal
    return proposal.model_copy(update={"comment": f"{AI_COMMENT_PREFIX}{comment}"})
