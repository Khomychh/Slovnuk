/**
 * Редактор картки — створення і правка одним екраном.
 *
 * Приклади вводяться парою полів, а не рядком «English | переклад»: половина
 * прикладів словника має український переклад, і в текстовому варіанті кожен
 * такий приклад означав би лізти по «|» у третій рівень мобільної клавіатури.
 *
 * Перетворення стану форми в тіло запиту тут НЕ живе — воно в `card.ts` під
 * тестами. Причина в тому, що помилка там не падає, а тихо зносить значення
 * картки.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { findByWord } from "../api/vocabulary";
import { useOnline } from "../app/useOnline";
import {
  blankExample,
  blankForm,
  blankSense,
  defaultListFor,
  draftIsDirty,
  newDraft,
  toCardPayload,
  toDraft,
  POS_LABELS,
  type CardDraft,
  type PartOfSpeech,
} from "../vocabulary/card";
import { useCard, useCreateCard, useLists, useUpdateCard } from "../vocabulary/queries";
import { useSettings } from "../study/queries";

const POS_ORDER: PartOfSpeech[] = [
  "n",
  "v",
  "adj",
  "adv",
  "prep",
  "pron",
  "conj",
  "num",
  "part",
  "int",
  "phr",
] as PartOfSpeech[];

export default function CardEditScreen({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const params = useParams();
  const id = mode === "edit" ? Number(params.id) : null;

  const card = useCard(id);
  const lists = useLists();
  const settings = useSettings();
  const create = useCreateCard();
  const update = useUpdateCard();

  const ownListIds = useMemo(
    () => (lists.data?.items ?? []).map((item) => item.id),
    [lists.data],
  );

  // Активний фільтр приходить зі списку через state — щоб «додати слово», не
  // виходячи з відкритого списку, клало картку саме туди.
  const activeListId =
    (location.state as { activeListId?: number | null } | null)?.activeListId ??
    null;

  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [initial, setInitial] = useState<CardDraft | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: number; word: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft) return;
    if (mode === "create") {
      if (!lists.data || !settings.data) return;
      const start = newDraft(
        defaultListFor(
          activeListId,
          settings.data.default_list_id ?? null,
          ownListIds,
        ),
      );
      setDraft(start);
      setInitial(start);
      return;
    }
    if (card.data) {
      const start = toDraft(card.data);
      setDraft(start);
      setInitial(start);
    }
  }, [mode, card.data, lists.data, settings.data, ownListIds, activeListId, draft]);

  if (!draft || !initial) return <div className="sheet-page">Завантаження…</div>;

  const patch = (next: Partial<CardDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const dirty = draftIsDirty(initial, draft);

  const close = () => {
    if (dirty && !window.confirm("Вийти без збереження? Зміни буде втрачено.")) {
      return;
    }
    navigate(-1);
  };

  /**
   * Перевірка дубліката на виході з поля «слово».
   *
   * Один запит замість восьми, і все одно до того, як користувач набере
   * значення й приклади. 409 при збереженні лишається страховкою.
   */
  const checkDuplicate = async () => {
    setDuplicate(null);
    const word = draft.word.trim();
    if (!word || !online) return;
    if (mode === "edit" && card.data && card.data.word.trim() === word) return;

    try {
      const found = await findByWord(word);
      if (found && found.id !== id) {
        setDuplicate({ id: found.id, word: found.word });
      }
    } catch {
      // Перевірка — зручність, а не умова збереження: сервер однаково дасть 409.
    }
  };

  const save = async () => {
    setError(null);
    const payload = toCardPayload(draft);
    if (!payload.word) {
      setError("Слово не може бути порожнім.");
      return;
    }

    try {
      if (mode === "create") {
        const created = await create.mutateAsync(payload);
        navigate(`/vocabulary/cards/${created.id}`, { replace: true });
      } else {
        await update.mutateAsync({ id: id as number, payload });
        navigate(-1);
      }
    } catch (problem) {
      if (problem instanceof ApiError && problem.code === "card_exists") {
        setError(problem.message);
        return;
      }
      setError(
        problem instanceof Error ? problem.message : "Не вдалось зберегти картку",
      );
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="sheet-page">
      <div className="sheet-bar">
        <button className="sheet-back" type="button" onClick={close}>
          ‹
        </button>
        <button
          className="btn-link"
          type="button"
          disabled={!online || saving}
          title={online ? undefined : "Потрібен звʼязок"}
          onClick={save}
        >
          {saving ? "Збереження…" : "Зберегти"}
        </button>
      </div>

      <div className="field">
        <label htmlFor="word">Слово</label>
        <input
          id="word"
          value={draft.word}
          autoCapitalize="none"
          autoComplete="off"
          onChange={(event) => patch({ word: event.target.value })}
          onBlur={checkDuplicate}
        />
      </div>

      {duplicate ? (
        <div className="msg msg-error">
          «{duplicate.word}» уже у вашому словнику.{" "}
          <button
            className="btn-link"
            type="button"
            onClick={() =>
              navigate(`/vocabulary/cards/${duplicate.id}`, { replace: true })
            }
          >
            Відкрити
          </button>
        </div>
      ) : null}

      {/* --- значення --- */}
      <div className="ed-label">Значення</div>
      {draft.senses.map((sense, index) => (
        <div className="ed-sense" key={index}>
          <div className="ed-sense-top">
            <select
              value={sense.partOfSpeech ?? ""}
              onChange={(event) => {
                const next = [...draft.senses];
                next[index] = {
                  ...sense,
                  partOfSpeech: (event.target.value || null) as PartOfSpeech | null,
                };
                patch({ senses: next });
              }}
            >
              <option value="">частина мови</option>
              {POS_ORDER.map((pos) => (
                <option key={pos} value={pos}>
                  {POS_LABELS[pos]}
                </option>
              ))}
            </select>
            {draft.senses.length > 1 ? (
              <button
                className="ed-drop"
                type="button"
                aria-label="Прибрати значення"
                onClick={() =>
                  patch({ senses: draft.senses.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            ) : null}
          </div>

          <input
            placeholder="переклад"
            value={sense.translation}
            onChange={(event) => {
              const next = [...draft.senses];
              next[index] = { ...sense, translation: event.target.value };
              patch({ senses: next });
            }}
          />
          <input
            placeholder="транскрипція"
            autoCapitalize="none"
            value={sense.transcription}
            onChange={(event) => {
              const next = [...draft.senses];
              next[index] = { ...sense, transcription: event.target.value };
              patch({ senses: next });
            }}
          />

          {sense.examples.map((example, exampleIndex) => (
            <div className="ed-example" key={exampleIndex}>
              <input
                placeholder="приклад англійською"
                value={example.textEn}
                onChange={(event) => {
                  const next = [...draft.senses];
                  const examples = [...sense.examples];
                  examples[exampleIndex] = { ...example, textEn: event.target.value };
                  next[index] = { ...sense, examples };
                  patch({ senses: next });
                }}
              />
              <input
                placeholder="переклад, не обовʼязково"
                value={example.textUk}
                onChange={(event) => {
                  const next = [...draft.senses];
                  const examples = [...sense.examples];
                  examples[exampleIndex] = { ...example, textUk: event.target.value };
                  next[index] = { ...sense, examples };
                  patch({ senses: next });
                }}
              />
              <button
                className="ed-drop"
                type="button"
                aria-label="Прибрати приклад"
                onClick={() => {
                  const next = [...draft.senses];
                  next[index] = {
                    ...sense,
                    examples: sense.examples.filter((_, i) => i !== exampleIndex),
                  };
                  patch({ senses: next });
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            className="btn-link"
            type="button"
            onClick={() => {
              const next = [...draft.senses];
              next[index] = {
                ...sense,
                examples: [...sense.examples, blankExample()],
              };
              patch({ senses: next });
            }}
          >
            + приклад
          </button>
        </div>
      ))}

      <button
        className="btn-link"
        type="button"
        onClick={() => patch({ senses: [...draft.senses, blankSense()] })}
      >
        + значення
      </button>

      {/* --- форми --- */}
      <div className="ed-label">Форми</div>
      {draft.forms.map((form, index) => (
        <div className="ed-form" key={index}>
          <input
            className="ed-form-lbl"
            placeholder="мітка"
            value={form.label}
            onChange={(event) => {
              const next = [...draft.forms];
              next[index] = { ...form, label: event.target.value };
              patch({ forms: next });
            }}
          />
          <input
            placeholder="форма"
            autoCapitalize="none"
            value={form.value}
            onChange={(event) => {
              const next = [...draft.forms];
              next[index] = { ...form, value: event.target.value };
              patch({ forms: next });
            }}
          />
          <button
            className="ed-drop"
            type="button"
            aria-label="Прибрати форму"
            onClick={() => patch({ forms: draft.forms.filter((_, i) => i !== index) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn-link"
        type="button"
        onClick={() => patch({ forms: [...draft.forms, blankForm()] })}
      >
        + форма
      </button>

      {draft.forms.length > 0 ? (
        <label className="ed-check">
          <input
            type="checkbox"
            checked={draft.formsDrillEnabled}
            onChange={(event) => patch({ formsDrillEnabled: event.target.checked })}
          />
          {/* Вимкнення не видаляє доріжку і не скидає прогрес — вона просто
              зникає з черги. */}
          Тренувати форми окремою доріжкою
        </label>
      ) : null}

      {/* --- списки --- */}
      <div className="ed-label">Списки</div>
      <div className="ed-lists">
        {(lists.data?.items ?? []).map((list) => {
          const on = draft.listIds.includes(list.id);
          return (
            <button
              key={list.id}
              className={on ? "chip chip-on" : "chip"}
              type="button"
              onClick={() =>
                patch({
                  listIds: on
                    ? draft.listIds.filter((value) => value !== list.id)
                    : [...draft.listIds, list.id],
                })
              }
            >
              {list.name}
            </button>
          );
        })}
      </div>
      {draft.listIds.length === 0 ? (
        <div className="hint">Картка буде без списку — це нормально.</div>
      ) : null}

      <div className="field">
        <label htmlFor="comment">Коментар</label>
        <input
          id="comment"
          value={draft.comment}
          onChange={(event) => patch({ comment: event.target.value })}
        />
      </div>

      {error ? <div className="msg msg-error">{error}</div> : null}
    </div>
  );
}
