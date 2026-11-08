import type { Engagement, EngagementKind } from "../../types/engagement";
import type { Progress } from "../../types/log";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const DEFAULT_TIMEBOX_MINUTES = 23 * 60 + 45;

export const KIND_LABEL: Record<EngagementKind, string> = {
  "exam-sim": "exam sim",
  lab: "lab",
  client: "client",
};

/** "23h 45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/** Remaining time of a timebox: "14h 10m left", "Time's up" or "Not started". */
export function timeLeft(timeboxStart: number | null, timeboxMinutes: number, now: number): string {
  if (timeboxStart === null || now < timeboxStart) return "Not started";
  const remaining = timeboxStart + timeboxMinutes * MIN - now;
  if (remaining <= 0) return "Time's up";
  const h = Math.floor(remaining / HOUR);
  const m = Math.floor((remaining % HOUR) / MIN);
  return `${h}h ${m}m left`;
}

/** Fraction of the timebox used, 0–1 (0 before it starts). */
export function timeboxElapsed(timeboxStart: number | null, timeboxMinutes: number, now: number): number {
  if (timeboxStart === null || now <= timeboxStart || timeboxMinutes <= 0) return 0;
  return Math.min(1, (now - timeboxStart) / (timeboxMinutes * MIN));
}

/** An exam sim with a timebox shows time remaining instead of dates. */
export function hasTimebox(e: Pick<Engagement, "kind" | "timeboxMinutes">): e is typeof e & { timeboxMinutes: number } {
  return e.kind === "exam-sim" && e.timeboxMinutes !== null;
}

export function shortDate(ms: number, withYear: boolean): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/** "Nov 10 – Nov 14"; the year appears only when it isn't this year. */
export function dateRange(startsAt: number | null, endsAt: number | null, now: number = Date.now()): string {
  const thisYear = new Date(now).getFullYear();
  const off = (ms: number) => new Date(ms).getFullYear() !== thisYear;
  if (startsAt !== null && endsAt !== null) {
    const withYear = off(startsAt) || off(endsAt);
    return `${shortDate(startsAt, withYear)} – ${shortDate(endsAt, withYear)}`;
  }
  if (startsAt !== null) return `From ${shortDate(startsAt, off(startsAt))}`;
  if (endsAt !== null) return `Until ${shortDate(endsAt, off(endsAt))}`;
  return "No dates";
}

/** "just now", "12m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ms);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 30 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return shortDate(ms, new Date(ms).getFullYear() !== new Date(now).getFullYear());
}

export const EMPTY_PROGRESS: Progress = { hostsTotal: 0, hostsRooted: 0, flagsFound: 0, flagsTotal: 0 };

/** Scope as "10.20.0.0/22" or "10.20.0.0/22 +2"; null when empty. */
export function scopeSummary(cidrs: string[]): string | null {
  if (cidrs.length === 0) return null;
  return cidrs.length === 1 ? cidrs[0]! : `${cidrs[0]} +${cidrs.length - 1}`;
}

// ---- form <-> Unix ms, in local time ----

const pad = (n: number) => String(n).padStart(2, "0");

/** Unix ms → `<input type="date">` value ("2026-11-10"), local time. */
export function toDateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<input type="date">` value → Unix ms at local midnight; "" → null. */
export function fromDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Unix ms → `<input type="datetime-local">` value ("2026-11-10T09:30"), local time. */
export function toDateTimeInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${toDateInput(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local">` value → Unix ms, local time; "" → null. */
export function fromDateTimeInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** Scope textarea → list: one entry per line, trimmed, blanks dropped. */
export function parseScope(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}
