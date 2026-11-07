import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { isFreeKey, useKeydown } from "../../lib/keys";
import { EmptyState } from "../../ui";
import { NowPanel } from "../checklist/NowPanel";
import { HostChecklist } from "../checklist/HostChecklist";
import { HostCredentials } from "../credentials/HostCredentials";
import { HostFindings } from "../findings/HostFindings";
import { useLog } from "../log/queries";
import { LogEntryRow } from "../log/LogEntryRow";
import { OrderButton } from "../log/OrderButton";
import { byOrder, usePersistedOrder } from "../log/usePersistedOrder";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useNotesStore } from "../notes/useNotesStore";
import { StuckView } from "../stuck/StuckView";
import { HostHeader } from "./HostHeader";
import { ServicesColumn } from "./ServicesColumn";
import { useHosts } from "./queries";

const TABS = [
  { id: "log", label: "Log" },
  { id: "checklist", label: "Checklist" },
  { id: "credentials", label: "Credentials" },
  { id: "findings", label: "Findings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function HostView({ engagementId, hostId }: { engagementId: string; hostId: string }) {
  const hosts = useHosts(engagementId);
  const log = useLog(engagementId);
  const location = useLocation();
  const navigate = useNavigate();
  // A Stuck check line arrives with the goal to open; the state is cleared below so back/forward does not repeat it.
  const arrivedGoal = (location.state as { goalId?: string } | null)?.goalId;
  const [tab, setTab] = useState<TabId>(arrivedGoal ? "checklist" : "log");
  const [order, setOrder] = usePersistedOrder("raven.log.order", "oldest", "raven.story.order");
  const [openEntry, setOpenEntry] = useState<string>();
  const [focusGoal, setFocusGoal] = useState<{ id: string; n: number } | undefined>(arrivedGoal ? { id: arrivedGoal, n: 1 } : undefined);
  useEffect(() => {
    if (arrivedGoal) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedGoal, location.pathname, navigate]);
  const [stuckOpen, setStuckOpen] = useState(false);
  const [stuckHost, setStuckHost] = useState(hostId);
  if (stuckHost !== hostId) {
    setStuckHost(hostId);
    setStuckOpen(false);
  }
  // The stuck view and the notes panel share the right edge: opening one closes the other.
  // The Arsenal drawer shares that edge too.
  useEffect(() => useNotesStore.subscribe((s) => { if (s.open) setStuckOpen(false); }), []);
  useEffect(() => useArsenalStore.subscribe((s) => { if (s.open) setStuckOpen(false); }), []);
  const toggleStuck = () => {
    if (!stuckOpen) {
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
    }
    setStuckOpen(!stuckOpen);
  };
  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "h" && e.key !== "H")) return;
    e.preventDefault();
    toggleStuck();
  });
  const openInLog = (id: string) => {
    setOpenEntry(id);
    setTab("log");
  };
  const host = hosts.data?.find((h) => h.id === hostId);

  if (hosts.isError) return <EmptyState title="Couldn't load this host" body={hosts.error.message} />;
  if (!hosts.data) return null;
  if (!host) {
    return (
      <EmptyState
        title="Host not found"
        body="It may have been deleted."
        action={<Link to={`/e/${engagementId}`} className="text-[13px] text-fg-2 hover:text-fg">Back to the board</Link>}
      />
    );
  }
  const entries = (log.data ?? []).filter((e) => e.hostIds.includes(hostId)).sort(byOrder(order));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <HostHeader host={host} onStuck={toggleStuck} />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] gap-6">
        <div className="flex min-h-0 flex-col gap-6 overflow-y-auto pr-1">
          <ServicesColumn engagementId={engagementId} hostId={hostId} entries={entries} />
          <NowPanel
            engagementId={engagementId}
            host={host}
            onOpenGoal={(id) => {
              setTab("checklist");
              setFocusGoal((f) => ({ id, n: (f?.n ?? 0) + 1 }));
            }}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div role="tablist" className="inline-flex gap-0.5 gap-x-2 min-w-3/4 rounded-[var(--radius)] p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setFocusGoal(undefined);
                  }}
                  className={`h-7 cursor-default rounded-[var(--radius-sm)] px-3 text-[13px] uppercase ${
                    tab === t.id ? "bg-surface-hi text-fg shadow-[inset_0_-2px_0_var(--color-accent)] font-semibold" : "text-muted hover:text-fg"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "log" && <OrderButton order={order} onChange={setOrder} />}
          </div>
          <div role="tabpanel" className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-line pl-1 pr-3 pt-1 [scrollbar-gutter:stable]">
            {tab === "log" ? (
              log.isError ? (
                <p role="alert" className="text-xs text-warn">Couldn't load the log: {log.error.message}</p>
              ) : entries.length === 0 && log.data ? (
                <p className="text-[13px] text-muted">Nothing logged on this host yet. Press L to capture.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {entries.map((e) => <LogEntryRow key={e.id} entry={e} hosts={hosts.data} currentHostId={hostId} defaultOpen={e.id === openEntry} />)}
                </ul>
              )
            ) : tab === "checklist" ? (
              <HostChecklist
                engagementId={engagementId}
                host={host}
                focusGoal={focusGoal}
                onOpenEntry={openInLog}
              />
            ) : tab === "credentials" ? (
              <HostCredentials engagementId={engagementId} host={host} onOpenEntry={openInLog} />
            ) : (
              <HostFindings engagementId={engagementId} host={host} onOpenEntry={openInLog} />
            )}
          </div>
        </div>
      </div>
      <StuckView
        engagementId={engagementId}
        host={host}
        open={stuckOpen}
        onClose={() => setStuckOpen(false)}
        onOpenGoal={(id) => {
          setTab("checklist");
          setFocusGoal((f) => ({ id, n: (f?.n ?? 0) + 1 }));
          setStuckOpen(false);
        }}
      />
    </div>
  );
}
