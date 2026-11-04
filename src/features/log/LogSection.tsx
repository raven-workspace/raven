import { useState } from "react";
import { useParams } from "react-router";
import type { LogKind } from "../../types/log";
import { EmptyState, labelClass } from "../../ui";
import { useHosts } from "../hosts/queries";
import { LogEntryRow } from "./LogEntryRow";
import { useLog } from "./queries";

const KINDS: LogKind[] = ["command", "screenshot", "http", "note", "flag"];
const sel = "h-7 rounded-sm border border-line-2 bg-bg px-2 text-xs text-fg-2";

export function LogSection() {
  const { id = "" } = useParams();
  const log = useLog(id);
  const hosts = useHosts(id).data ?? [];
  const [host, setHost] = useState("all");
  const [kind, setKind] = useState("all");
  const [ranOn, setRanOn] = useState("all");

  const entries = log.data ?? [];
  if (log.isSuccess && entries.length === 0) {
    return <EmptyState title="Nothing logged yet. Press L to capture." />;
  }
  const ranOns = Array.from(new Set(entries.map((e) => e.ranOn).filter((r): r is string => !!r)));
  const shown = entries
    .filter((e) => host === "all" || (host === "none" ? e.hostIds.length === 0 : e.hostIds.includes(host)))
    .filter((e) => kind === "all" || e.kind === kind)
    .filter((e) => ranOn === "all" || e.ranOn === ranOn)
    .sort((a, b) => b.at - a.at);

  return (
    <section aria-label="Log" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className={labelClass}>Host</span>
          <select aria-label="Host" className={sel} value={host} onChange={(e) => setHost(e.target.value)}>
            <option value="all">All</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
            <option value="none">No host</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className={labelClass}>Kind</span>
          <select aria-label="Kind" className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className={labelClass}>Ran on</span>
          <select aria-label="Ran on" className={sel} value={ranOn} onChange={(e) => setRanOn(e.target.value)}>
            <option value="all">All</option>
            {ranOns.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="m-0 list-none p-0 border-t border-line">
        {shown.map((e) => (
          <LogEntryRow key={e.id} entry={e} hosts={hosts} />
        ))}
      </ul>
      {shown.length === 0 && log.isSuccess && <p className="m-0 text-[13px] text-muted">No entries match these filters.</p>}
    </section>
  );
}
