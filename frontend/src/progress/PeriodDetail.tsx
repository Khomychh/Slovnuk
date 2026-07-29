/**
 * Панель обраного періоду — те, що розкриває плитка.
 *
 * Обсяг тут другорядний навмисно. Головним числом його свідомо не взяли: обсяг
 * за рік росте сам від того, що ти не кидаєш, і однаково великий у того, хто
 * вчиться щодня, і в того, хто раз на місяць добиває все за раз. Тому нагорі
 * стоять закриті дні, а обсяг живе тут, де його читають уже з питанням
 * «а скільки саме роботи за цим числом».
 *
 * Знаменників у панелі немає: ані «з N днів», ані відсотків (ADR-0018).
 *
 * «Повторено» — це доріжки, а не картки: картка з формою дає дві доріжки, і
 * знати переклад та памʼятати форму — різні вміння. Слово «доріжка»
 * користувачу не показується ніде, тож рядок підписаний так само, як на
 * «Сьогодні», — просто повтореннями.
 */

import type { CSSProperties } from "react";
import { plural } from "../ui/plural";
import type { PeriodVolume, VolumeBar } from "../study/period";
import type { Period } from "./periods";
import Spark from "./Spark";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="pd-row">
      <span className="pd-lbl">{label}</span>
      <span className="pd-val">{value}</span>
    </div>
  );
}

export default function PeriodDetail({
  period,
  slot,
  volume,
  streak,
  bars,
}: {
  period: Period;
  /** Номер плитки, 0…3 — під нею стає дзьоб панелі. */
  slot: number;
  volume: PeriodVolume;
  streak: number;
  bars: VolumeBar[];
}) {
  // Каст потрібен, бо CSSProperties не знає власних властивостей. Значення йде
  // саме сюди, а не в клас: номер стовпчика — дані, а не оформлення.
  const beak = { "--pick": slot } as CSSProperties;

  // Порожній період не показує чотири нулі: рядки «Середнє 0 на день» і
  // «Серія 0 днів» читаються як поганий результат, а не як відсутність даних.
  if (volume.activeDays === 0) {
    return (
      <div className="pd pd-beak" style={beak}>
        <div className="pd-head">{period.title}</div>
        <p className="pd-empty">Тут ще нічого не було.</p>
      </div>
    );
  }

  return (
    <div className="pd pd-beak" style={beak}>
      <div className="pd-head">{period.title}</div>

      <Row label="Повторено" value={String(volume.reviews)} />
      <Row
        label="Додано"
        value={`${volume.newCards} ${plural(volume.newCards, "слово", "слова", "слів")}`}
      />
      <Row
        label="Найдовша серія"
        value={
          streak > 0
            ? `${streak} ${plural(streak, "день", "дні", "днів")} поспіль`
            : "поки не склалась"
        }
      />
      <Row label="Середнє" value={`${volume.perActiveDay} на день`} />

      <Spark bars={bars} />
    </div>
  );
}
