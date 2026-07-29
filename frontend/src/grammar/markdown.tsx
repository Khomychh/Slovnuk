/**
 * Markdown граматичних нотаток → дерево React-елементів.
 *
 * Чому свій, а не бібліотека — в ADR-0013 (`docs/adr/`). Коротко: сюди приїжджає
 * текст, написаний іншою людиною (шер), а токени лежать у localStorage
 * (ADR-0008), тож рендерер — єдине, що стоїть між чужим текстом і сторінкою.
 *
 * Ключова властивість: функція повертає ЕЛЕМЕНТИ, а не рядок HTML. Тому
 * `dangerouslySetInnerHTML` тут не використовується взагалі, і сирий HTML не може
 * пройти навіть теоретично — React екранує текстові вузли за побудовою. Це
 * сильніше за старий PWA, який спершу екранував рядок, а потім вставляв у нього
 * свої теги: там правильність трималась на порядку двох дій, тут — на типі.
 *
 * **Не переписуйте це на рядок HTML заради зручності.** Щойно зʼявиться
 * `dangerouslySetInnerHTML`, гарантія зникає, і повернути її можна буде лише
 * санітайзером — рівно тим підходом, який ADR-0008 назвав гіршим.
 *
 * Підмножина синтаксису — та сама, що в старому PWA, бо саме проти неї написані
 * наявні нотатки. Посилань, картинок, цитат і таблиць немає навмисно:
 *
 * - Таблиць — бо `|` у цих нотатках означає розділювач «англійська | українська»
 *   («He speaks English fluently. | Він вільно говорить англійською»), і будь-який
 *   GFM-рендерер має шанс прочитати його як розмітку.
 * - Посилань — бо `[текст](javascript:…)` довелось би окремо перевіряти на схему,
 *   а в довіднику з граматики посилатись нікуди.
 */

import { Fragment, createElement, type ReactNode } from "react";

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;

/**
 * Порядок гілок несучий: `**` мусить пробуватись раніше за `*`, інакше жирний
 * текст розібрався б як порожній курсив.
 *
 * Підкреслення вимагає перед собою межу слова, щоб `snake_case_ім'я` не
 * розсипалось на курсив. Межа рахується за Unicode (`\p{L}`), а не за `\w`:
 * `\w` не знає кирилиці, тож у «слово_курсив_» межа знайшлася б посеред слова.
 */
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|(^|[^\p{L}\p{N}_])_([^_]+)_/gu;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;

  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-i${index++}`;

    if (match[1] !== undefined) {
      out.push(<code key={key}>{match[1]}</code>);
    } else if (match[2] !== undefined) {
      out.push(<strong key={key}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      out.push(<em key={key}>{match[3]}</em>);
    } else {
      // Символ, що дав межу слова, належить тексту, а не розмітці.
      if (match[4]) out.push(match[4]);
      out.push(<em key={key}>{match[5]}</em>);
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Текст нотатки в блоки.
 *
 * Рівні заголовків зсунуті на +2: `#` дає `h3`, `##` — `h4`, `###` — `h5`. Це не
 * недогляд і не лінь. У наявних нотатках `#` вжито не як заголовок розділу, а як
 * «перше речення абзацу, зроблене помітнішим», і речення ці бувають на 130
 * символів. Справжній `h1` перетворив би їх на півекрана дисплейного шрифту.
 * Крім того, `h1` на сторінці вже зайнятий заголовком самої нотатки, і другий
 * ламав би структуру документа.
 *
 * `####` і глибше заголовком не є — рівно як у старому PWA (регекс `{1,3}`).
 * Такий рядок їде звичайним абзацом разом із решітками, і це чесно: показати
 * текст як є краще, ніж мовчки його зʼїсти.
 */
export function renderMarkdown(source: string | null | undefined): ReactNode[] {
  const lines = String(source ?? "").split(/\r?\n/);
  const blocks: ReactNode[] = [];

  let para: string[] = [];
  let items: string[] = [];
  let listKind: "ul" | "ol" | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const key = `p${blocks.length}`;
    const lineNodes = para;
    para = [];
    blocks.push(
      <p key={key} className="md-p">
        {lineNodes.map((line, index) => (
          <Fragment key={index}>
            {index > 0 ? <br /> : null}
            {renderInline(line, `${key}-${index}`)}
          </Fragment>
        ))}
      </p>,
    );
  };

  const closeList = () => {
    if (listKind === null) return;
    const key = `l${blocks.length}`;
    const kind = listKind;
    const entries = items;
    items = [];
    listKind = null;
    blocks.push(
      createElement(
        kind,
        { key, className: "md-list" },
        entries.map((item, index) => (
          <li key={index}>{renderInline(item, `${key}-${index}`)}</li>
        )),
      ),
    );
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "") {
      flushPara();
      closeList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const key = `h${blocks.length}`;
      const tag = `h${(heading[1] ?? "").length + 2}`;
      blocks.push(
        createElement(
          tag,
          { key, className: "md-h" },
          renderInline(heading[2] ?? "", key),
        ),
      );
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      if (listKind !== "ul") closeList();
      listKind = "ul";
      items.push(bullet[1] ?? "");
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushPara();
      if (listKind !== "ol") closeList();
      listKind = "ol";
      items.push(ordered[1] ?? "");
      continue;
    }

    // Звичайний рядок після списку закриває його: інакше текст під переліком
    // ставав би ще одним пунктом.
    closeList();
    para.push(line);
  }

  flushPara();
  closeList();

  return blocks;
}

/** Тіло нотатки. Порожнє тіло — не помилка: нотатка може бути самим заголовком. */
export function Markdown({ source }: { source: string | null | undefined }) {
  const blocks = renderMarkdown(source);
  if (blocks.length === 0) return null;
  return <div className="md">{blocks}</div>;
}
