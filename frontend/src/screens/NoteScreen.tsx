/**
 * Перегляд нотатки.
 *
 * Запиту не коштує: `GrammarNoteSchema` віддається з тілом одразу — полегшеної
 * схеми «для списку» бекенд не має навмисно, тож нотатка вже лежить у кеші
 * `useNotes`. Тому перегляд відкривається миттєво й працює офлайн.
 *
 * Видалення нічого за собою не тягне: нотатки не беруть участі в повтореннях,
 * тож історії, яку можна втратити, тут немає (пор. ADR-0003 і діалог видалення
 * картки, який про таку втрату попереджає).
 */

import { useNavigate, useParams } from "react-router-dom";
import { useOnline } from "../app/useOnline";
import { Markdown } from "../grammar/markdown";
import { useDeleteNote, useNotes } from "../grammar/queries";
import { PencilIcon } from "../ui/parts";

export default function NoteScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  const params = useParams();
  const id = Number(params.id);

  const notes = useNotes();
  const remove = useDeleteNote();

  const note = notes.data?.find((item) => item.id === id);

  if (notes.isPending) return <div className="sheet-page">Завантаження…</div>;

  if (!note) {
    return (
      <div className="sheet-page">
        <div className="hint">Нотатку не знайдено.</div>
        <button className="btn-quiet" type="button" onClick={() => navigate(-1)}>
          Назад
        </button>
      </div>
    );
  }

  const onDelete = async () => {
    if (!window.confirm(`Видалити «${note.title}»? Нотатка зникне з довідника.`)) {
      return;
    }
    await remove.mutateAsync(note.id);
    navigate("/grammar", { replace: true });
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
        <button
          className="icon-btn"
          type="button"
          aria-label="Редагувати"
          disabled={!online}
          title={online ? "Редагувати" : "Потрібен звʼязок"}
          onClick={() => navigate(`/grammar/notes/${note.id}/edit`)}
        >
          <PencilIcon />
        </button>
      </div>

      <div className="sheet-scroll">
        <h1 className="note-title">{note.title}</h1>

        {note.category_name ? (
          <div className="v-lists-line">{note.category_name}</div>
        ) : (
          <div className="v-lists-line v-lists-none">Без розділу</div>
        )}

        {note.body_markdown?.trim() ? (
          <Markdown source={note.body_markdown} />
        ) : (
          <div className="hint">Тіло порожнє — тут поки лише назва.</div>
        )}
      </div>

      <div className="sheet-foot">
        <button
          className="btn-quiet"
          type="button"
          disabled={!online || remove.isPending}
          title={online ? undefined : "Потрібен звʼязок"}
          onClick={onDelete}
        >
          Видалити нотатку
        </button>
      </div>
    </div>
  );
}
