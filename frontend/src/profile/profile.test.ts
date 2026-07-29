import { describe, expect, it } from "vitest";
import {
  avatarSrc,
  fullName,
  nameChanged,
  nameProblem,
  parseGoal,
} from "./profile";

describe("parseGoal", () => {
  it("бере нуль як справжнє значення, а не як порожнечу", () => {
    // Нуль означає «ціль вимкнено» — це нормальний стан за моделлю.
    expect(parseGoal("0")).toBe(0);
  });

  it("бере звичайні числа й не боїться пробілів навколо", () => {
    expect(parseGoal("30")).toBe(30);
    expect(parseGoal("  12 ")).toBe(12);
  });

  it("відкидає порожнє поле", () => {
    expect(parseGoal("")).toBeNull();
    expect(parseGoal("   ")).toBeNull();
  });

  it("відкидає все, що не ціле невідʼємне число", () => {
    expect(parseGoal("12.5")).toBeNull();
    expect(parseGoal("-3")).toBeNull();
    expect(parseGoal("багато")).toBeNull();
    expect(parseGoal("1e3")).toBeNull();
  });

  it("тримає ту саму верхню межу, що й схема бекенду", () => {
    // StudySettingsUpdateSchema: ge=0, le=1000. Інакше 422 замість підказки.
    expect(parseGoal("1000")).toBe(1000);
    expect(parseGoal("1001")).toBeNull();
  });
});

describe("nameProblem", () => {
  it("пропускає українське імʼя", () => {
    expect(nameProblem("Іван")).toBeNull();
    expect(nameProblem("Ґудзь")).toBeNull();
  });

  it("пропускає порожнє — це «стерти поле»", () => {
    expect(nameProblem("")).toBeNull();
    expect(nameProblem("   ")).toBeNull();
  });

  it("ловить латиницю до того, як її відкине сервер", () => {
    // validate_name: ^[А-Яа-яЁёІіЇїЄєҐґ]*$ — інакше користувач отримав би
    // «Ivan contains non-Ukrainian letters» англійською після «Зберегти».
    expect(nameProblem("Ivan")).not.toBeNull();
  });

  it("ловить дефіс і пробіл — бекенд їх теж не приймає", () => {
    expect(nameProblem("Анна-Марія")).not.toBeNull();
    expect(nameProblem("Іван Петрович")).not.toBeNull();
  });
});

describe("nameChanged", () => {
  it("порожнє поле проти null не є зміною", () => {
    // Профіль без імені приходить як null, а поле показує "" — інакше кнопка
    // «Зберегти» була б активна одразу після відкриття екрана.
    expect(
      nameChanged(
        { firstName: null, lastName: null },
        { firstName: "", lastName: "" },
      ),
    ).toBe(false);
  });

  it("пробіл у кінці не є зміною — сервер його не побачить", () => {
    expect(
      nameChanged(
        { firstName: "Іван", lastName: null },
        { firstName: "Іван  ", lastName: "" },
      ),
    ).toBe(false);
  });

  it("бачить справжню правку будь-якого з двох полів", () => {
    expect(
      nameChanged(
        { firstName: "Іван", lastName: null },
        { firstName: "Іван", lastName: "Хомич" },
      ),
    ).toBe(true);
  });
});

describe("avatarSrc", () => {
  it("без аватара нічого не вигадує", () => {
    expect(avatarSrc(null, "17")).toBeNull();
    expect(avatarSrc(undefined, null)).toBeNull();
  });

  it("без мітки версії лишає адресу як є — кеш браузера тут доречний", () => {
    expect(avatarSrc("https://s3/avatars/1_avatar.jpg", null)).toBe(
      "https://s3/avatars/1_avatar.jpg",
    );
  });

  it("додає мітку версії, бо ключ файлу після заміни той самий", () => {
    expect(avatarSrc("https://s3/avatars/1_avatar.jpg", "1700")).toBe(
      "https://s3/avatars/1_avatar.jpg?v=1700",
    );
  });

  it("не ламає адресу, у якій уже є параметри", () => {
    expect(avatarSrc("https://s3/a.jpg?X-Amz=1", "1700")).toBe(
      "https://s3/a.jpg?X-Amz=1&v=1700",
    );
  });
});

describe("заголовок профілю", () => {
  it("імʼя й прізвище одним рядком", () => {
    expect(fullName({ first_name: "Іван", last_name: "Хомич" })).toBe(
      "Іван Хомич",
    );
  });

  it("саме імʼя, коли прізвища немає", () => {
    expect(fullName({ first_name: "Іван", last_name: null })).toBe("Іван");
    expect(fullName({ first_name: "Іван", last_name: "  " })).toBe("Іван");
  });

  it("саме прізвище, коли імені немає", () => {
    expect(fullName({ first_name: null, last_name: "Хомич" })).toBe("Хомич");
  });

  /* Порожня шапка читалась би як недовантажений екран, а не як «імені немає». */
  it("без жодного імені лишається «Профіль»", () => {
    expect(fullName({ first_name: null, last_name: null })).toBe("Профіль");
    expect(fullName(null)).toBe("Профіль");
  });

  it("зайві пробіли не дають подвійного розділювача", () => {
    expect(fullName({ first_name: "  Іван ", last_name: " Хомич " })).toBe(
      "Іван Хомич",
    );
  });
});
