/**
 * Редактор картки поверх навчання.
 *
 * Рама, а не другий редактор: усередині той самий `CardEditScreen`. Сенс саме
 * в рамі — навчання лишається змонтованим під аркушем, і разом із ним лишаються
 * зерно сесії, розкритість картки й місце в черзі. Перехід на маршрут
 * розмонтував би `StudyScreen`, а `beginSession` при поверненні взяв би нове
 * зерно: та сама картка при напрямку «змішано» повернулась би іншим боком.
 *
 * Буфер черги тримає КОПІЮ картки й не оновлюється сам (`mergeIncoming`
 * навмисно пропускає доріжки, які вже в ньому лежать). Тому збережений вміст
 * доводиться вкладати туди руками — інакше виправлена помилка проступила б аж
 * тоді, коли доріжка вдруге приїде з сервера.
 */

import CardEditScreen from "../screens/CardEditScreen";
import { cardDeleted, cardEdited } from "../study/store";

export default function CardEditSheet({
  cardId,
  onClose,
  onSaved,
  onDeleted,
}: {
  cardId: number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  return (
    // Затемнення тут не закриває аркуш дотиком, на відміну від аркушів вибору:
    // під ним лежить набраний текст, і випадковий дотик повз поле коштував би
    // роботи. Вийти можна шевроном — там питають про незбережене.
    <div className="sheet-scrim">
      <div
        className="sheet sheet-tall"
        role="dialog"
        aria-modal="true"
        aria-label="Виправити картку"
      >
        <CardEditScreen
          mode="edit"
          cardId={cardId}
          onClose={onClose}
          onSaved={(saved) => {
            void cardEdited(saved);
            onSaved();
          }}
          onDeleted={(id) => {
            void cardDeleted(id);
            onDeleted();
          }}
        />
      </div>
    </div>
  );
}
