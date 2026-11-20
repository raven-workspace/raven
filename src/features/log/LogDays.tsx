import type { ReactNode } from "react";
import type { LogEntry } from "../../types/log";
import { labelClass } from "../../ui";
import "./LogDays.scss";

const DAY = 86_400_000;
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** "Today", "Yesterday", then "Mon, Nov 9" (with the year when it isn't this year). */
function dayLabel(ms: number, now = Date.now()): string {
  if (dayKey(ms) === dayKey(now)) return "Today";
  if (dayKey(ms) === dayKey(now - DAY)) return "Yesterday";
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Consecutive entries of one local day, in the list's order. */
function byDay(entries: LogEntry[]): { key: string; label: string; entries: LogEntry[] }[] {
  const days: { key: string; label: string; entries: LogEntry[] }[] = [];
  for (const e of entries) {
    const key = dayKey(e.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.entries.push(e);
    else days.push({ key, label: dayLabel(e.at), entries: [e] });
  }
  return days;
}

/**
 * Log rows under a heading per day, in the order given. Rows show only the time, so two 07:27s on different days
 * never look alike. Used by the engagement log and a host's Log tab.
 */
export function LogDays({ entries, row }: { entries: LogEntry[]; row: (e: LogEntry) => ReactNode }) {
  return (
    <>
      {byDay(entries).map((day) => (
        <section key={day.key} aria-label={day.label} className="log-day">
          <h3 className={`${labelClass} log-day__heading`}>{day.label}</h3>
          <ul className="log-day__list">{day.entries.map(row)}</ul>
        </section>
      ))}
    </>
  );
}
