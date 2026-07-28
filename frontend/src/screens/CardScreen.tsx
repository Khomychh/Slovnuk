/**
 * Перегляд картки.
 *
 * Читається як текст, а не як поля вводу: головний сценарій тут — «знайшов
 * слово, хочу побачити, що я про нього записав», а приклади в `textarea`
 * читаються погано.
 *
 * Запиту цей екран не коштує: `CardSchema` не має полегшеного варіанта, тож
 * картка вже цілком лежить у кеші сторінки списку.
 */

import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { POS_LABELS, deletionLosesHistory } from "../vocabulary/card";
import { useCard, useDeleteCard, useLists } from "../vocabulary/queries";

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
    <div className="sheet-page">
      <div className="sheet-bar">
        <button className="sheet-back" type="button" onClick={() => navigate(-1)}>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
            <path d="M14.5 6.5l3 3" />
          </svg>
        </button>
      </div>

      <h1 className="card-word">{item.word}</h1>

      {names.length > 0 ? (
        <div className="v-lists-line">{names.join(" · ")}</div>
      ) : (
        <div className="v-lists-line v-lists-none">Без списку</div>
      )}

      <div className="card-senses">
        {item.senses.map((sense) => (
          <div className="card-sense" key={sense.id}>
            <div className="card-sense-head">
              {sense.translation ? (
                <span className="card-tr">{sense.translation}</span>
              ) : null}
              {sense.part_of_speech ? (
                <span className="card-pos">
                  {POS_LABELS[sense.part_of_speech] ?? sense.part_of_speech}
                </span>
              ) : null}
            </div>
            {/* Без дужок: у даних транскрипція вже зі своїми роздільниками —
                «/ɡoʊ/». Обгортка давала б «[/ɡoʊ/]». */}
            {sense.transcription ? (
              <div className="card-ipa">{sense.transcription}</div>
            ) : null}
            {sense.examples.map((example) => (
              <div className="card-ex" key={example.id}>
                <div>{example.text_en}</div>
                {example.text_uk ? (
                  <div className="card-ex-uk">{example.text_uk}</div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      {item.forms.length > 0 ? (
        <div className="card-forms">
          <div className="card-label">
            Форми{item.forms_drill_enabled ? "" : " · тренування вимкнено"}
          </div>
          {item.forms.map((form) => (
            <div className="card-form" key={form.id}>
              {form.label ? <span className="card-form-lbl">{form.label}</span> : null}
              <span>{form.value}</span>
              {form.transcription ? (
                <span className="card-ipa">{form.transcription}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {item.comment ? (
        <div className="card-comment">
          <div className="card-label">Коментар</div>
          {item.comment}
        </div>
      ) : null}

      <button
        className="btn-quiet card-delete"
        type="button"
        disabled={!online || remove.isPending}
        title={online ? undefined : "Потрібен звʼязок"}
        onClick={onDelete}
      >
        Видалити слово
      </button>
    </div>
  );
}
