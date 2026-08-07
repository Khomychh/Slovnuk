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
 *
 * Видалення тут немає, і це навмисно. Екран перегляду читають — «Видалити
 * слово» на всю ширину внизу було найпомітнішою дією екрана, на якому дій
 * узагалі не мало бути. Тепер сюди ведуть тільки очі й олівець, а видалення
 * живе в редакторі, за тим самим олівцем.
 *
 * Списків, до яких належить картка, тут немає. Вони й так відомі: у словник
 * заходять через вибраний список, його назва стоїть у шапці екрана списку, і
 * повторювати її над карткою означало відповідати на питання, якого ніхто не
 * ставив. Місце картки в словнику видно й правлять у редакторі.
 */

import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { distinctTranscriptions } from "../vocabulary/card";
import { CardBody, Headword, headwordClass } from "../vocabulary/CardFace";
import { useCard } from "../vocabulary/queries";
import { cardTemperature } from "../study/temperature";
import { PencilIcon } from "../ui/parts";

export default function CardScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const id = Number(params.id);

  const card = useCard(Number.isFinite(id) ? id : null);

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
  const transcriptions = distinctTranscriptions(item);

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
      </div>

      {/* `card-mid` центрує картку по вертикалі, поки вона в екран уміщається, і
          віддає їй прокрутку, щойно перестала. Це те саме правило, що в
          навчанні: слово в словнику мусить стояти там само, де стояло на
          картці, — інакше два екрани показують ту саму річ по-різному. */}
      <div className="sheet-scroll card-mid">
        <div
          className="card-panel"
          style={{ "--temp": cardTemperature(item.tracks) } as React.CSSProperties}
        >
          {/* Олівець у куті панелі — той самий, що в навчанні, і на тому ж
              місці: правка є дією над КАРТКОЮ, а не над екраном, і рука не
              повинна вчити для неї друге місце. Офлайн його немає зовсім, а не
              вимкненим: так поводиться цей олівець у навчанні (ADR-0024), і
              різна поведінка однакової кнопки читалась би як несправність. */}
          {online ? (
            <button
              className="card-edit"
              type="button"
              aria-label="Редагувати"
              onClick={() => navigate(`/vocabulary/cards/${item.id}/edit`)}
            >
              <PencilIcon />
            </button>
          ) : null}

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
    </div>
  );
}
