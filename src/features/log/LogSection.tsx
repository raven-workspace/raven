import { useState } from "react";
import { useParams } from "react-router";
import type { LogKind } from "../../types/log";
import { Button, EmptyState, Select, labelClass } from "../../ui";
import { useHosts } from "../hosts/queries";
import { LogEntryRow } from "./LogEntryRow";
import { useLog } from "./queries";

const KINDS: LogKind[] = ["command", "screenshot", "http", "note", "flag"];
const sel = "h-7 w-auto text-xs";

export function LogSection() {
  const { id = "" } = useParams();
  const log = useLog(id);
  const hosts = useHosts(id).data ?? [];
  const [host, setHost] = useState("all");
  const [kind, setKind] = useState("all");
  const [ranOn, setRanOn] = useState("all");

  const entries = log.data ?? [];
  if (log.isError) {
    return (
      <EmptyState
        title="Couldn't load the log"
        body={log.error.message}
        action={<Button onClick={() => void log.refetch()}>Try again</Button>}
      />
    );
  }
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
    .sort((a, b) => b.at - a.at);

  return (
    <section aria-label="Log" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={labelClass}>Host</span>
          <Select aria-label="Host" className={sel} value={hostSel} onValueChange={setHost} options={[{ value: "all", label: "All" }, ...hosts.map((h) => ({ value: h.id, label: h.name })), { value: "none", label: "No host" }]} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={labelClass}>Kind</span>
          <Select aria-label="Kind" className={sel} value={kind} onValueChange={setKind} options={[{ value: "all", label: "All" }, ...KINDS.map((k) => ({ value: k, label: k }))]} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={labelClass}>Ran on</span>
          <Select aria-label="Ran on" className={sel} value={ranOnSel} onValueChange={setRanOn} options={[{ value: "all", label: "All" }, ...ranOns.map((r) => ({ value: r, label: r }))]} />
        </div>
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
