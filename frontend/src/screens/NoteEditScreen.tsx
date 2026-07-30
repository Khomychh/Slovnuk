/**
 * Редактор нотатки.
 *
 * Три поля: назва, розділ, тіло. Розділ задається НАЗВОЮ — бекенд заводить його
 * сам, тож окремого запиту «створити розділ» немає й не треба.
 *
 * Підказки розділів — чипи, а не випадаючий список, з тих самих причин, що й
 * мітки форм у редакторі картки: список під полем відкривається туди, де стоїть
 * клавіатура, плюс класична гонка «тап по пункту гасить фокус раніше за клік».
 * Чипи видно, лише поки поле порожнє; режиму «вибір проти вводу» не існує.
 *
 * Перемикач «Текст / Перегляд» стоїть тут, бо підмножина Markdown у нас своя
 * (див. `grammar/markdown.tsx`), і єдиний чесний спосіб дізнатись, що вийде, —
 * побачити. Альтернатива — зберегти, вийти, глянути, повернутись: чотири тапи
 * щоразу, коли не впевнений у синтаксисі.
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { BackIcon, SaveButton } from "../ui/parts";
import ConfirmSheet from "../ui/ConfirmSheet";
import { plural } from "../ui/plural";
import { Markdown } from "../grammar/markdown";
import {
  blankDraft,
  categoryProblem,
  categorySuggestions,
  draftIsDirty,
  titleProblem,
  toDraft,
  toNotePayload,
  type NoteDraft,
} from "../grammar/note";
import {
  useCategories,
  useCreateNote,
  useNotes,
  useUpdateNote,
} from "../grammar/queries";

export default function NoteEditScreen({ mode }: { mode: "create" | "edit" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const params = useParams();
  const id = mode === "edit" ? Number(params.id) : null;

  const notes = useNotes();
  const categories = useCategories();
  const create = useCreateNote();
  const update = useUpdateNote();

  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [initial, setInitial] = useState<NoteDraft | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  /** Розділ, відкритий у списку, підставляється новій нотатці. */
  const presetCategory =
    (location.state as { category?: string } | null)?.category ?? "";

  useEffect(() => {
    if (draft) return;

    if (mode === "create") {
      const start = blankDraft(presetCategory);
      setDraft(start);
      setInitial(start);
      return;
    }

    const note = notes.data?.find((item) => item.id === id);
    if (note) {
      const start = toDraft(note);
      setDraft(start);
      setInitial(start);
    }
  }, [mode, notes.data, id, presetCategory, draft]);

  if (!draft || !initial)
    return <div className="sheet-page">Завантаження…</div>;

  const patch = (next: Partial<NoteDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const dirty = draftIsDirty(initial, draft);

  const close = () => {
    if (dirty) {
      setAsking(true);
      return;
    }
    navigate(-1);
  };

  const save = async () => {
    setError(null);

    // Порожню назву ловимо ДО відправки: `RequiredText` на бекенді дав би 422 з
    // англомовним текстом валідації.
    const problem =
      titleProblem(draft.title) ?? categoryProblem(draft.category);
    if (problem) {
      setError(problem);
      return;
    }

    const payload = toNotePayload(draft);

    try {
      if (mode === "create") {
        const created = await create.mutateAsync(payload);
        navigate(`/grammar/notes/${created.id}`, { replace: true });
      } else {
        await update.mutateAsync({ id: id as number, payload });
        navigate(-1);
      }
    } catch (problemFromServer) {
      setError(
        problemFromServer instanceof Error
          ? problemFromServer.message
          : "Не вдалось зберегти нотатку",
      );
    }
  };

  const saving = create.isPending || update.isPending;
  const hints = categorySuggestions(
    categories.data?.items ?? [],
    draft.category,
  );

  return (
    <div className="sheet-frame">
      {/* Прибита з тієї ж причини, що й у редакторі картки: тіло правила —
          `textarea` на 14 рядків, і «Зберегти» лишалось десь вище. */}
      <div className="sheet-head sheet-bar">
        <button
          className="icon-btn icon-btn-bare"
          type="button"
          aria-label="Назад"
          onClick={close}
        >
          <BackIcon />
        </button>
        <SaveButton
          onClick={save}
          disabled={!online || saving}
          state={saving ? "saving" : "idle"}
          title={online ? undefined : "Потрібен звʼязок"}
        />
      </div>

      <div className="sheet-scroll">
        <div className="field ed-word-field">
          <label htmlFor="note-title">Назва</label>
          <input
            id="note-title"
            className="ed-word"
            value={draft.title}
            placeholder="Say | Tell"
            onChange={(event) => patch({ title: event.target.value })}
          />
        </div>

        <div className="ed-label">Розділ</div>
        <input
          className="ed-cat"
          value={draft.category}
          placeholder="без розділу"
          onChange={(event) => patch({ category: event.target.value })}
        />
        {/* Підказок ніколи не більше шести, і вони звужуються під набране —
          розділів може стати багато, а суцільний рядок чипів на пів екрана
          гірший за їх відсутність. Правило добору — в `categorySuggestions`. */}
        {hints.names.length > 0 ? (
          <div className="ed-chips">
            {hints.names.map((name) => (
              <button
                key={name}
                className="chip chip-sm"
                type="button"
                onClick={() => patch({ category: name })}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}

        {/* Решта не зникла — про неї треба сказати, інакше шістка виглядає як
          «інших розділів немає». */}
        {hints.hidden > 0 ? (
          <div className="hint">
            Ще {hints.hidden}{" "}
            {plural(hints.hidden, "розділ", "розділи", "розділів")} — почніть
            набирати назву.
          </div>
        ) : null}

        <div className="ed-label ed-label-row">
          <span>Правило</span>
          <span className="ed-tabs">
            <button
              className={preview ? "ed-tab" : "ed-tab ed-tab-on"}
              type="button"
              onClick={() => setPreview(false)}
            >
              Текст
            </button>
            <button
              className={preview ? "ed-tab ed-tab-on" : "ed-tab"}
              type="button"
              onClick={() => setPreview(true)}
            >
              Перегляд
            </button>
          </span>
        </div>

        {preview ? (
          <div className="ed-preview">
            {draft.body.trim() ? (
              <Markdown source={draft.body} />
            ) : (
              <div className="hint">Тіло порожнє.</div>
            )}
          </div>
        ) : (
          <textarea
            className="ed-body"
            rows={14}
            value={draft.body}
            placeholder={
              "Правило звичайним текстом.\n\n- пункт списку\n**жирний**  *курсив*\n# помітніший рядок"
            }
            onChange={(event) => patch({ body: event.target.value })}
          />
        )}

        {error ? <div className="msg msg-error">{error}</div> : null}

        {!online ? <div className="hint">Зміни потребують звʼязку.</div> : null}
      </div>

      {asking ? (
        <ConfirmSheet
          title="Вийти без збереження?"
          note="Усе, що набрано на цьому екрані, зникне."
          confirmLabel="Вийти"
          onConfirm={() => navigate(-1)}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </div>
  );
}
