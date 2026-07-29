/**
 * Перегляд картки.
 *
 * Малюється тією самою панеллю, що й розкрита картка навчання, і тим самим
 * кодом (`CardFace`). Причина не декоративна: слово, яке ти щодня бачиш на
 * картці, у словнику мусить виглядати тим самим словом, а не витягом із бази.
 * Перевороту тут немає — шукати відповідь нема потреби, ти сам її й записав.
 *
 * Сяйво над панеллю — температура доріжки перекладу (ADR-0016). У навчанні воно
 * зʼявляється лише після перевороту, тут горить одразу: правило одне — колір
 * приходить разом із відповіддю, а тут відповідь видно завжди.
 *
 * Запиту цей екран не коштує: `CardSchema` не має полегшеного варіанта, тож
 * картка вже цілком лежить у кеші сторінки списку — разом зі `stability`.
 */

import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { deletionLosesHistory, distinctTranscriptions } from "../vocabulary/card";
import { CardBody, Headword, headwordClass } from "../vocabulary/CardFace";
import { useCard, useDeleteCard, useLists } from "../vocabulary/queries";
import { cardTemperature } from "../study/temperature";
import { PencilIcon } from "../ui/parts";

export default function CardScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const id = Number(params.id);

  const card = useCard(Number.isFinite(id) ? id : null);
  const lists = useLists();
  const remove = useDeleteCard();

  if (card.isPending) {
    return <div className="sheet-page">Завантаження…</div>;
  }
  if (!card.data) {
    return (
      <div className="sheet-page">
        <div className="hint">Картку не знайдено.</div>
        <button className="btn-quiet" type="button" onClick={() => navigate(-1)}>
          Назад
        </button>
      </div>
    );
  }

  const item = card.data;
  const names = (lists.data?.items ?? [])
    .filter((list) => item.list_ids.includes(list.id))
    .map((list) => list.name);
  const transcriptions = distinctTranscriptions(item);

  const onDelete = async () => {
    // Діалог мусить називати справжній наслідок. Стан доріжок уже в payload,
    // тож окремий запит за кількістю відповідей не потрібен (ADR-0003).
    const message = deletionLosesHistory(item)
      ? `Видалити «${item.word}»? Разом зі словом зникне історія повторень — відновити її буде нічим.`
      : `Видалити «${item.word}»? Слово зникне зі словника.`;
    if (!window.confirm(message)) return;

    await remove.mutateAsync(item.id);
    navigate("/vocabulary", { replace: true });
  };

  return (
    <div className="sheet-frame">
      <div className="sheet-head sheet-bar">
        <button
          className="sheet-back"
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Назад"
        >
          ‹
        </button>
        {/* Олівець замість слова «Редагувати»: рядок під шапкою вартий слова
            лише тоді, коли дію без нього не впізнати. */}
        <button
          className="icon-btn"
          type="button"
          aria-label="Редагувати"
          disabled={!online}
          title={online ? "Редагувати" : "Потрібен звʼязок"}
          onClick={() => navigate(`/vocabulary/cards/${item.id}/edit`)}
        >
          <PencilIcon />
        </button>
      </div>

      <div className="sheet-scroll">
        {/* Списки стоять НАД панеллю, а не в ній: у навчанні їх немає, і панель
            мусить лишатись описом слова, а не його місця в словнику. */}
        {names.length > 0 ? (
          <div className="v-lists-line">{names.join(" · ")}</div>
        ) : (
          <div className="v-lists-line v-lists-none">Без списку</div>
        )}

        <div
          className="card-panel"
          style={{ "--temp": cardTemperature(item.tracks) } as React.CSSProperties}
        >
          <div className="front">
            <Headword word={item.word} className={headwordClass(item.word)} />
            {/* Спільний рядок транскрипції — коли вона в картці одна. Коли їх
                кілька, кожна стоїть біля свого значення; так само, як у
                навчанні. */}
            {transcriptions.length === 1 ? (
              <div className="ipa">{transcriptions[0]}</div>
            ) : null}
          </div>

          <div className="back back-still">
            <CardBody
              card={item}
              formsNote={item.forms_drill_enabled ? undefined : "тренування вимкнено"}
            />
          </div>
        </div>
      </div>

      {/* Видалення прибите, але тихе: до нього не треба догортати, і водночас
          воно не претендує на роль головної дії екрана. */}
      <div className="sheet-foot">
        <button
          className="btn-quiet"
          type="button"
          disabled={!online || remove.isPending}
          title={online ? undefined : "Потрібен звʼязок"}
          onClick={onDelete}
        >
          Видалити слово
        </button>
      </div>
    </div>
  );
}
