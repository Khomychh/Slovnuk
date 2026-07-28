/** Дрібні спільні шматки інтерфейсу. Нічого розумного тут немає навмисно. */

import type { ReactNode } from "react";

export function Screen({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      {title ? <h1 className="h-title">{title}</h1> : null}
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
