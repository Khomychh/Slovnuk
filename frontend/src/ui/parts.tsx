/** Дрібні спільні шматки інтерфейсу. Нічого розумного тут немає навмисно. */

import type { ReactNode } from "react";

export function Screen({
  eyebrow,
  title,
  aside,
  children,
}: {
  eyebrow?: string;
  title?: string;
  /** Правий верхній кут шапки — там живе аватар профілю на «Сьогодні». */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      {eyebrow || title || aside ? (
        <div className="screen-head">
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            {title ? <h1 className="h-title">{title}</h1> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Field({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={input.id}>{label}</label>
      <input {...input} />
    </div>
  );
}

export function Message({
  kind = "info",
  children,
}: {
  kind?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={kind === "error" ? "msg msg-error" : "msg"}
      role={kind === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}
