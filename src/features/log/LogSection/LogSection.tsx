import { useState } from "react";
import { OrderButton } from "../OrderButton/OrderButton";
import { byOrder, useLogOrder } from "../useLogOrder";
import { useParams, useSearchParams } from "react-router";
import type { LogKind } from "../../../types/log";
import { EmptyState, Select, queryState } from "../../../ui/index";
import { useHosts } from "../../hosts/queries";
import { KIND_LABELS } from "../kindLabels";
import { LogDays } from "../LogDays/LogDays";
import { LogEntryRow } from "../LogEntryRow/LogEntryRow";
import { useLog } from "../queries";
import "./LogSection.scss";

const KINDS: LogKind[] = ["command", "screenshot", "http", "note", "flag"];

const sel = "log-section__select";
const filter = "log-section__filter";
const filterLabel = "log-section__filter-label";

export function LogSection() {
  const { id = "" } = useParams();
  const log = useLog(id);
  const hosts = useHosts(id).data ?? [];
  // The host filter lives in the URL (`?host=<id>`), so the workspace Explorer's host rows open that host's log.
  const [params, setParams] = useSearchParams();
  const host = params.get("host") ?? "all";
  const setHost = (v: string) =>
    setParams(
      (p) => {
        if (v === "all") p.delete("host");
        else p.set("host", v);
        return p;
      },
      { replace: true },
    );
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
    <section aria-label="Log" className="log-section">
      <div className="log-section__filters">
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
        <OrderButton className="log-section__order" order={order} onChange={setOrder} />
      </div>
      <LogDays entries={shown} row={(e) => <LogEntryRow key={e.id} entry={e} hosts={hosts} />} />
      {shown.length === 0 && log.isSuccess && <p className="log-section__none">No entries match these filters.</p>}
    </section>
  );
}
