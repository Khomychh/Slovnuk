/**
 * «Списки» — екран із двох половин: **Мої** і **Бібліотека**.
 *
 * До цього це були різні місця застосунку: керування власними списками лежало
 * на третьому дотику (Словник → аркуш фільтра → «Керувати списками»), а
 * Бібліотека займала п'яту вкладку. Обидва рішення були неправильні з
 * протилежних боків — своє закопане, чуже висить на видноті, — і обидва
 * скасовано (ADR-0021). Тепер вхід один: кнопка в шапці «Словника».
 *
 * Половини не симетричні за назвами навмисно: ліворуч присвійник, праворуч
 * місце. «Мої / Чужі» було б симетричніше, але тоді слово «Бібліотека» зникло б
 * з інтерфейсу, а воно стоїть у кнопках («Виставити в Бібліотеці»), у
 * підтвердженнях і в усьому, що людина про неї читає. Симетрія тут коштувала б
 * дорожче, ніж вартує.
 *
 * Бібліотека НЕ стає «моєю бібліотекою» від сусідства: вона лишається назвою
 * рівно однієї половини — тієї, де чуже. Своїх списків туди не переносять, туди
 * потрапляє їхній знімок (CONTEXT.md).
 *
 * Відкривається завжди «Мої», а не остання відвідана. Кнопка в шапці мусить
 * вести передбачувано: одна кнопка — одне місце. Це заодно єдина половина, яка
 * щось показує офлайн.
 */

import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Screen } from "../ui/parts";
import MyLists from "../vocabulary/MyLists";
import LibraryBrowse from "../library/LibraryBrowse";
import { useLists } from "../vocabulary/queries";

type Half = "mine" | "library";

export default function ListsScreen() {
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * Половина не адресується посиланням, а приходить станом навігації. Причина
   * та сама, що у фільтра словника: набраний пошук і позиція скролу не повинні
   * гинути від зміни URL. Станом сюди приходять ті, кому потрібна саме
   * Бібліотека, — стара адреса `/library` і кнопки «До Бібліотеки».
   */
  const [half, setHalf] = useState<Half>(() =>
    (location.state as { half?: Half } | null)?.half === "library"
      ? "library"
      : "mine",
  );

  const lists = useLists();
  const count = lists.data?.items.length ?? 0;

  return (
    <Screen title="Списки" back={() => navigate(-1)}>
      {/* Перемикач липне до верху області прокрутки: під ним лежать і вісім
          списків, і нескінченна витрина, а повертатись угору, щоб перемкнути
          половину, — це та сама кнопка, до якої треба догортати. */}
      <div className="halves" role="tablist" aria-label="Що показувати">
        <button
          className={half === "mine" ? "half half-on" : "half"}
          type="button"
          role="tab"
          aria-selected={half === "mine"}
          onClick={() => setHalf("mine")}
        >
          Мої
          {count > 0 ? <span className="half-count">{count}</span> : null}
        </button>
        <button
          className={half === "library" ? "half half-on" : "half"}
          type="button"
          role="tab"
          aria-selected={half === "library"}
          onClick={() => setHalf("library")}
        >
          Бібліотека
        </button>
      </div>

      {half === "mine" ? <MyLists /> : <LibraryBrowse />}
    </Screen>
  );
}
