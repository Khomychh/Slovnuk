/**
 * Тести рендерера.
 *
 * Перевіряється розмітка, а не React-дерево: `renderToStaticMarkup` дає рядок
 * HTML, тобто рівно те, що побачить браузер. Це навмисно — головне твердження
 * блоку («сирий HTML не проходить») можна довести тільки на кінцевому HTML.
 * jsdom для цього не потрібен, тож і не додається.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "./markdown";

function html(source: string | null | undefined): string {
  return renderToStaticMarkup(<>{renderMarkdown(source)}</>);
}

describe("безпека", () => {
  /**
   * Це найважливіший тест блоку: на ньому тримається ADR-0008.
   *
   * Токени лежать у localStorage саме тому, що чужий Markdown рендериться без
   * сирого HTML. Якщо цей тест колись почервоніє, під питанням не рендерер, а
   * рішення зберігати токени так, як вони зберігаються.
   */
  it("теги в тілі лишаються видимим текстом", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("обробники подій не стають атрибутами", () => {
    const out = html('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=\"");
    expect(out).toContain("&lt;img");
  });

  it("HTML усередині розмітки теж екранується", () => {
    const out = html("- **<b>жирний</b>**");
    expect(out).toContain("<strong>");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;b&gt;жирний&lt;/b&gt;");
  });

  it("посилання не підтримуються — javascript: лишається текстом", () => {
    const out = html("[тиць](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).toContain("[тиць](javascript:alert(1))");
  });
});

describe("заголовки", () => {
  it("рівні зсунуто на +2", () => {
    expect(html("# Раз")).toContain("<h3");
    expect(html("## Два")).toContain("<h4");
    expect(html("### Три")).toContain("<h5");
  });

  it("h1 і h2 не зʼявляються ніколи — вони належать самій сторінці", () => {
    const out = html("# Раз\n\n## Два\n\n### Три");
    expect(out).not.toContain("<h1");
    expect(out).not.toContain("<h2");
  });

  it("#### заголовком не є і показується як є", () => {
    const out = html("#### Чотири");
    expect(out).not.toContain("<h6");
    expect(out).toContain("#### Чотири");
  });

  it("решітка без пробілу — не заголовок", () => {
    expect(html("#хештег")).toContain("#хештег");
    expect(html("#хештег")).not.toContain("<h3");
  });

  it("довге речення під # лишається одним заголовком", () => {
    // Справжній рядок із нотатки «Speak | Talk» — 130 символів під однією
    // решіткою. Саме через нього рівні й зсунуто.
    const line =
      "# Speak — більш офіційне. Його використовують, коли йдеться про знання мов, офіційні промови або коли розмова серйозна чи одностороння";
    const out = html(line);
    expect(out).toContain("<h3");
    expect(out).toContain("Speak — більш офіційне.");
  });
});

describe("списки", () => {
  it("дефіс і зірочка дають той самий ul", () => {
    expect(html("- раз\n- два")).toBe(html("* раз\n* два"));
  });

  it("сусідні пункти йдуть в один список", () => {
    const out = html("- раз\n- два\n- три");
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li>/g)).toHaveLength(3);
  });

  it("порожній рядок закриває список", () => {
    const out = html("- раз\n\n- два");
    expect(out.match(/<ul/g)).toHaveLength(2);
  });

  it("звичайний рядок після списку закриває його, а не стає пунктом", () => {
    const out = html("- раз\nхвіст");
    expect(out.match(/<li>/g)).toHaveLength(1);
    expect(out).toContain("<p");
    expect(out).toContain("хвіст");
  });

  it("нумерований список — ol", () => {
    const out = html("1. раз\n2. два");
    expect(out).toContain("<ol");
    expect(out.match(/<li>/g)).toHaveLength(2);
  });

  it("перехід ul → ol починає новий список", () => {
    const out = html("- раз\n1. два");
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
  });
});

describe("рядкова розмітка", () => {
  it("жирний розбирається раніше за курсив", () => {
    const out = html("**жирний**");
    expect(out).toContain("<strong>жирний</strong>");
    expect(out).not.toContain("<em>");
  });

  it("курсив", () => {
    expect(html("*курсив*")).toContain("<em>курсив</em>");
  });

  it("код", () => {
    expect(html("`код`")).toContain("<code>код</code>");
  });

  it("підкреслення після межі слова — курсив", () => {
    expect(html("текст _курсив_ далі")).toContain("<em>курсив</em>");
  });

  it("підкреслення всередині слова курсивом не стає", () => {
    // \w не знає кирилиці, тому наївна перевірка межі зробила б курсив тут.
    const out = html("змінна назва_поле_далі");
    expect(out).not.toContain("<em>");
    expect(out).toContain("назва_поле_далі");
  });

  it("розмітка працює всередині пункту списку", () => {
    const out = html("- Made of *(made of wood — з дерева)*");
    expect(out).toContain("<li>");
    expect(out).toContain("<em>(made of wood — з дерева)</em>");
  });
});

describe("вертикальна риска", () => {
  /**
   * У наявних нотатках `|` — розділювач «англійська | українська», а не
   * розмітка. Саме тому таблиць у рендерері немає взагалі: GFM-рендерер має
   * шанс прочитати такий рядок як таблицю, і виправляти це довелось би в даних.
   */
  it("лишається текстом у рядку зі списку", () => {
    const out = html("- He speaks English fluently. | Він вільно говорить англійською.");
    expect(out).not.toContain("<table");
    expect(out).toContain("| Він вільно говорить англійською.");
  });

  it("два рядки з рискою не стають таблицею", () => {
    const out = html(
      "He left Odesa for Rome. | Він поїхав з Одеси до Рима.\nMe mother left for London. | Моя мама поїхала до Лондона.",
    );
    expect(out).not.toContain("<table");
    expect(out).toContain("<br/>");
  });
});

describe("абзаци", () => {
  it("сусідні рядки — один абзац із розривом", () => {
    const out = html("перший\nдругий");
    expect(out.match(/<p/g)).toHaveLength(1);
    expect(out).toContain("<br/>");
  });

  it("порожній рядок ділить абзаци", () => {
    const out = html("перший\n\nдругий");
    expect(out.match(/<p/g)).toHaveLength(2);
  });

  it("порожнє тіло не дає жодного блоку", () => {
    expect(renderMarkdown("")).toHaveLength(0);
    expect(renderMarkdown(null)).toHaveLength(0);
    expect(renderMarkdown(undefined)).toHaveLength(0);
    expect(renderMarkdown("   \n\n  ")).toHaveLength(0);
  });
});

describe("справжні нотатки", () => {
  it("«Made of | Made from» рендериться цілком", () => {
    const out = html(
      [
        "Коли ми говоримо про матеріали, з яких виготовлена річ, прийменник залежить від того, чи змінився матеріал візуально.",
        "- Made of використовується, якщо початковий матеріал усе ще видно *(made of wood — з дерева)*",
        "- Made from використовується, якщо матеріал повністю змінив свою форму чи стан у процесі виробництва *(paper is made from wood — папір роблять із деревини)*",
      ].join("\n"),
    );
    expect(out.match(/<p/g)).toHaveLength(1);
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out.match(/<em>/g)).toHaveLength(2);
  });

  it("«To go | to come» — два абзаци з жирним", () => {
    const out = html(
      "При вживанні дієслова **to go** дія спрямована від нас.\n\nПри вживанні дієслова **to come** дія спрямована до нас.",
    );
    expect(out.match(/<p/g)).toHaveLength(2);
    expect(out).toContain("<strong>to go</strong>");
    expect(out).toContain("<strong>to come</strong>");
  });
});
