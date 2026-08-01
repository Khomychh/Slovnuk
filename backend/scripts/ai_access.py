"""
Видача та зняття доступу до ШІ.

Доступ до ШІ — привілей, виданий адміністратором конкретній людині (ADR-0026).
Адмінки поки немає, тож видається він звідси; коли адмінка з'явиться, вона
робитиме те саме з тими самими колонками.

Запуск — з хоста, як seed_test_data.py (див. README, розділ 4): venv бекенда вже
має всі залежності, а .env лежить у корені репозиторію. До серверної бази —
через SSH-тунель, бо Postgres слухає 127.0.0.1.

    cd backend
    python -m scripts.ai_access list
    python -m scripts.ai_access grant --email me@x.com --note "автор"
    python -m scripts.ai_access grant --email friend@x.com --by me@x.com
    python -m scripts.ai_access revoke --email friend@x.com
    python -m scripts.ai_access transcription --email me@x.com --value us

`transcription` формально до доступу не належить — це преференція з
user_settings, і вона є в кожної людини, зокрема без ШІ. Тому окрема
підкоманда, а не прапорець при `grant`: інакше поставити транскрипцію тому, кому
ШІ не видано, було б неможливо. Заводити другий файл заради одного поля — гірше,
ніж тримати його тут.

Зняття доступу видаляє рядок, а не гасить прапорець. Усе, що варто пам'ятати про
витрати, лежить в ai_requests і видалення доступу його не чіпає (ADR-0028).
"""

import argparse
import asyncio
import sys

from sqlalchemy import delete, select

from app.database.database import async_session_maker
from app.database.models import (
    AiAccessModel,
    TranscriptionVarietyEnum,
    UserModel,
    UserSettingsModel,
)
from app.cruds import ai as ai_crud


async def _user_id_by_email(session, email: str) -> int | None:
    stmt = select(UserModel.id).where(UserModel.email == email.strip().lower())
    return (await session.execute(stmt)).scalar_one_or_none()


async def _cmd_list(session) -> int:
    stmt = (
        select(AiAccessModel, UserModel.email)
        .join(UserModel, UserModel.id == AiAccessModel.user_id)
        .order_by(AiAccessModel.granted_at)
    )
    rows = (await session.execute(stmt)).all()
    if not rows:
        print("Доступу до ШІ не має ніхто.")
        return 0

    print(f"Доступ до ШІ мають {len(rows)}:\n")
    for access, email in rows:
        granted_by = None
        if access.granted_by_user_id:
            granted_by = (
                await session.execute(
                    select(UserModel.email).where(
                        UserModel.id == access.granted_by_user_id
                    )
                )
            ).scalar_one_or_none()

        variety = (
            await session.execute(
                select(UserSettingsModel.transcription_variety).where(
                    UserSettingsModel.user_id == access.user_id
                )
            )
        ).scalar_one_or_none()

        total, filled = await ai_crud.usage_by_user(session, access.user_id)

        print(f"  {email}")
        print(f"    видано:       {access.granted_at:%Y-%m-%d %H:%M} UTC")
        if granted_by:
            print(f"    видав:        {granted_by}")
        if access.note:
            print(f"    навіщо:       {access.note}")
        print(f"    транскрипція: {variety.value if variety else '—'}")
        # Два числа, бо вони про різне: перше — про витрати (невдалі звернення
        # теж коштували вхідних токенів), друге — про користь.
        print(f"    звернень:     {total} (заповнено слів: {filled})")
        print()
    return 0


async def _cmd_grant(session, email: str, by_email: str | None, note: str | None) -> int:
    user_id = await _user_id_by_email(session, email)
    if user_id is None:
        print(f"Користувача {email} немає.", file=sys.stderr)
        return 1

    if await ai_crud.has_ai_access(session, user_id):
        print(f"{email} уже має доступ до ШІ.")
        return 0

    granted_by_id = None
    if by_email:
        granted_by_id = await _user_id_by_email(session, by_email)
        if granted_by_id is None:
            print(f"Того, хто видає ({by_email}), немає.", file=sys.stderr)
            return 1

    session.add(
        AiAccessModel(user_id=user_id, granted_by_user_id=granted_by_id, note=note)
    )
    await session.commit()
    print(f"{email} тепер має доступ до ШІ.")
    return 0


async def _cmd_revoke(session, email: str) -> int:
    user_id = await _user_id_by_email(session, email)
    if user_id is None:
        print(f"Користувача {email} немає.", file=sys.stderr)
        return 1

    result = await session.execute(
        delete(AiAccessModel).where(AiAccessModel.user_id == user_id)
    )
    await session.commit()
    if result.rowcount:
        # Журнал лишається: витрати не скасовуються зняттям доступу, і після
        # повернення доступу вже заповнені слова заповненими й лишаться.
        print(f"{email} більше не має доступу до ШІ. Журнал звернень лишився.")
    else:
        print(f"{email} доступу й не мав.")
    return 0


async def _cmd_transcription(session, email: str, value: str) -> int:
    user_id = await _user_id_by_email(session, email)
    if user_id is None:
        print(f"Користувача {email} немає.", file=sys.stderr)
        return 1

    settings = (
        await session.execute(
            select(UserSettingsModel).where(UserSettingsModel.user_id == user_id)
        )
    ).scalar_one_or_none()
    if settings is None:
        print(f"У {email} немає налаштувань — акаунт зламаний.", file=sys.stderr)
        return 1

    settings.transcription_variety = TranscriptionVarietyEnum(value)
    await session.commit()
    # Заднім числом не діє — сказати про це варто вголос, інакше людина чекає,
    # що старі картки перепишуться.
    print(
        f"{email}: транскрипція тепер {value}. "
        f"Діє на нові пропозиції; наявні картки лишаються як були."
    )
    return 0


async def run(args: argparse.Namespace) -> int:
    async with async_session_maker() as session:
        if args.command == "list":
            return await _cmd_list(session)
        if args.command == "grant":
            return await _cmd_grant(session, args.email, args.by, args.note)
        if args.command == "revoke":
            return await _cmd_revoke(session, args.email)
        if args.command == "transcription":
            return await _cmd_transcription(session, args.email, args.value)
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="Хто має доступ до ШІ і скільки витратив.")

    grant = sub.add_parser("grant", help="Видати доступ до ШІ.")
    grant.add_argument("--email", required=True)
    grant.add_argument("--by", help="Пошта того, хто видає. Лишається в журналі видачі.")
    grant.add_argument("--note", help="Навіщо видано — щоб через рік було зрозуміло.")

    revoke = sub.add_parser("revoke", help="Зняти доступ до ШІ.")
    revoke.add_argument("--email", required=True)

    transcription = sub.add_parser(
        "transcription",
        help="Британська чи американська транскрипція (преференція, не ШІ-доступ).",
    )
    transcription.add_argument("--email", required=True)
    transcription.add_argument(
        "--value", required=True, choices=[v.value for v in TranscriptionVarietyEnum]
    )

    args = parser.parse_args()
    sys.exit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
