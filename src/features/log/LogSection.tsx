import { useState } from "react";
import { OrderButton } from "./OrderButton";
import { byOrder, usePersistedOrder } from "./usePersistedOrder";
import { useParams } from "react-router";
import type { LogKind } from "../../types/log";
import { EmptyState, Select, labelClass, queryState } from "../../ui";
import type { LogEntry } from "../../types/log";
import { useHosts } from "../hosts/queries";
import { KIND_LABELS } from "./kindLabels";
import { LogEntryRow } from "./LogEntryRow";
import { useLog } from "./queries";

const KINDS: LogKind[] = ["command", "screenshot", "http", "note", "flag"];

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
const sel = "h-7 w-auto";
const filter = "grid grid-cols-[auto_auto] items-center gap-2";
const filterLabel = "whitespace-nowrap text-meta text-muted-2";

export function LogSection() {
  const { id = "" } = useParams();
  const log = useLog(id);
  const hosts = useHosts(id).data ?? [];
  const [host, setHost] = useState("all");
  const [kind, setKind] = useState("all");
  const [ranOn, setRanOn] = useState("all");
  const [order, setOrder] = usePersistedOrder("raven.log.order", "newest");

  const entries = log.data ?? [];
  const state = queryState([log], "the log");
  if (state) return state;
  if (log.isSuccess && entries.length === 0) {
    return <EmptyState title="Nothing logged yet. Press L to capture." />;
  }
  const ranOns = Array.from(new Set(entries.map((e) => e.ranOn).filter((r): r is string => !!r)));
  // A selection that no longer exists in the data falls back to All.
  const hostSel = host === "all" || host === "none" || hosts.some((h) => h.id === host) ? host : "all";
  const ranOnSel = ranOn === "all" || ranOns.includes(ranOn) ? ranOn : "all";
  const shown = entries
    .filter((e) => hostSel === "all" || (hostSel === "none" ? e.hostIds.length === 0 : e.hostIds.includes(hostSel)))
    .filter((e) => kind === "all" || e.kind === kind)
    .filter((e) => ranOnSel === "all" || e.ranOn === ranOnSel)
    .sort(byOrder(order));

  return (
    <section aria-label="Log" className="grid gap-3">
      <div className="grid grid-cols-[repeat(3,auto)_minmax(0,1fr)] items-center justify-start gap-3">
        <div className={filter}>
          <span className={filterLabel}>Host</span>
          <Select aria-label="Host" className={sel} value={hostSel} onValueChange={setHost} options={[{ value: "all", label: "All" }, ...hosts.map((h) => ({ value: h.id, label: h.name })), { value: "none", label: "No host" }]} />
        </div>
        <div className={filter}>
          <span className={filterLabel}>Kind</span>
          <Select aria-label="Kind" className={sel} value={kind} onValueChange={setKind} options={[{ value: "all", label: "All" }, ...KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))]} />
        </div>
        <div className={filter}>
          <span className={filterLabel}>Ran on</span>
          <Select aria-label="Ran on" className={sel} value={ranOnSel} onValueChange={setRanOn} options={[{ value: "all", label: "All" }, ...ranOns.map((r) => ({ value: r, label: r }))]} />
        </div>
        <OrderButton className="justify-self-end" order={order} onChange={setOrder} />
      </div>
      {/* Rows show only the time, so each day gets a heading: two 07:27s on different days never look alike. */}
      {byDay(shown).map((day) => (
        <section key={day.key} aria-label={day.label} className="grid gap-1">
          <h3 className={`${labelClass} m-0 pt-2`}>{day.label}</h3>
          <ul className="m-0 list-none p-0 border-t border-line">
            {day.entries.map((e) => (
              <LogEntryRow key={e.id} entry={e} hosts={hosts} />
            ))}
          </ul>
        </section>
      ))}
      {shown.length === 0 && log.isSuccess && <p className="m-0 text-meta text-muted">No entries match these filters.</p>}
    </section>
  );
}
