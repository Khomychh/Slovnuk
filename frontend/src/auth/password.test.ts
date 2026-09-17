import { describe, expect, it } from "vitest";
import { emailLooksWrong, normalizeEmail, passwordProblem } from "./password";

/*
 * Це дзеркало серверного `validate_password_strength`. Тести тримають саме
 * дзеркальність: якщо локальна перевірка стане мʼякшою, сервер відхилятиме
 * пароль, який застосунок щойно назвав добрим, і винним виглядатиме застосунок.
 */

describe("правила пароля", () => {
  it("добрий пароль проходить", () => {
    expect(passwordProblem("Slovnuk1!")).toBeNull();
  });

  it("короткий — перша скарга саме про довжину", () => {
    // Порядок перевірок той самий, що на сервері: інакше перша скарга локально
    // й перша скарга з сервера різнились би на тому самому паролі.
    expect(passwordProblem("Ab1!")).toBe("Пароль має містити щонайменше 8 символів.");
  });

  it("без великої літери", () => {
    expect(passwordProblem("slovnuk1!")).toContain("велику латинську");
  });

  it("без малої літери", () => {
    expect(passwordProblem("SLOVNUK1!")).toContain("малу латинську");
  });

  it("без цифри", () => {
    expect(passwordProblem("Slovnuky!")).toContain("цифру");
  });

  it("спеціальний символ не потрібен", () => {
    expect(passwordProblem("Slovnuk12")).toBeNull();
  });

  it("український великий не вважається великою літерою", () => {
    // Головна пастка для українськомовного користувача: бекенд перевіряє саме
    // [A-Z]. «Пароль1!» виглядає як пароль із великої літери, а сервер його
    // відхиляє — і локальна перевірка мусить сказати те саме, а не «добре».
    expect(passwordProblem("Пароль1!")).toContain("велику латинську");
  });

  it("українські літери дозволені, якщо латинські обох регістрів теж є", () => {
    // Кирилиця не заборонена — просто не зараховується у вимогу про регістр.
    // Тут велика «A» і мала «b» латинські, тож пароль проходить.
    expect(passwordProblem("Пароль1!Ab")).toBeNull();
  });
});

describe("пошта", () => {
  it("пробіли по краях зрізаються", () => {
    expect(normalizeEmail("  email@example.com  ")).toBe("email@example.com");
  });

  it("порожня — очевидно не пошта", () => {
    expect(emailLooksWrong("   ")).toBe(true);
  });

  it("без @", () => {
    expect(emailLooksWrong("userexample.com")).toBe(true);
  });

  it("без точки в домені", () => {
    expect(emailLooksWrong("user@example")).toBe(true);
  });

  it("@ на початку", () => {
    expect(emailLooksWrong("@example.com")).toBe(true);
  });

  it("звичайна адреса проходить", () => {
    expect(emailLooksWrong("first.last@gmail.com")).toBe(false);
  });

  it("плюс-адресація проходить", () => {
    // Перевірка навмисно груба: сувору робить бекенд, і відхиляти тут те, що
    // сервер приймає, — гірше, ніж пропустити зайве.
    expect(emailLooksWrong("user+slovnuk@gmail.com")).toBe(false);
  });
});
