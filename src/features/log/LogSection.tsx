import { useState } from "react";
import { OrderButton } from "./OrderButton";
import { byOrder, useLogOrder } from "./useLogOrder";
import { useParams } from "react-router";
import type { LogKind } from "../../types/log";
import { EmptyState, Select, queryState } from "../../ui";
import { useHosts } from "../hosts/queries";
import { KIND_LABELS } from "./kindLabels";
import { LogDays } from "./LogDays";
import { LogEntryRow } from "./LogEntryRow";
import { useLog } from "./queries";

const KINDS: LogKind[] = ["command", "screenshot", "http", "note", "flag"];

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
  const [order, setOrder] = useLogOrder("newest");

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
      <LogDays entries={shown} row={(e) => <LogEntryRow key={e.id} entry={e} hosts={hosts} />} />
      {shown.length === 0 && log.isSuccess && <p className="m-0 text-meta text-muted">No entries match these filters.</p>}
    </section>
  );
}
