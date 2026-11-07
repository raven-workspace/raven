import { useEffect, useState } from "react";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { Link, useLocation, useNavigate } from "react-router";
import { isDialogOpen, isFreeKey, isTypingTarget, useKeydown } from "../../lib/keys";
import { EmptyState } from "../../ui";
import type { Finding } from "../../types/findings";
import { FindingSplit } from "../findings/FindingSplit";
import { HostFindings } from "../findings/HostFindings";
import { useLog } from "../log/queries";
import { LogEntryRow } from "../log/LogEntryRow";
import { OrderButton } from "../log/OrderButton";
import { byOrder, usePersistedOrder } from "../log/usePersistedOrder";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useNotesStore } from "../notes/useNotesStore";
import { StuckView } from "../stuck/StuckView";
import { FactsColumn } from "./facts/FactsColumn";
import { HostHeader } from "./HostHeader";
import { FullChecklistToggle, NextTab } from "./NextTab";
import { useHosts } from "./queries";

const TABS = [
  { id: "next", label: "Next", code: "Digit1" },
  { id: "log", label: "Log", code: "Digit2" },
  { id: "findings", label: "Findings", code: "Digit3" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Two columns from this width of the host page (the `@min-[760px]/host` container query); stacked below it. */
const TWO_COLUMNS_PX = 760;

/** The element's width, once measured; undefined until then (and in tests, which have no layout). */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

export function HostView({ engagementId, hostId }: { engagementId: string; hostId: string }) {
  const hosts = useHosts(engagementId);
  const log = useLog(engagementId);
  const location = useLocation();
  const navigate = useNavigate();
  // A Stuck check line arrives with the goal to open; the state is cleared below so back/forward does not repeat it.
  const arrivedGoal = (location.state as { goalId?: string } | null)?.goalId;
  const [tab, setTab] = useState<TabId>("next");
  const [order, setOrder] = usePersistedOrder("raven.log.order", "oldest", "raven.story.order");
  const [openEntry, setOpenEntry] = useState<string>();
  const [focusGoal, setFocusGoal] = useState<{ id: string; n: number } | undefined>(arrivedGoal ? { id: arrivedGoal, n: 1 } : undefined);
  // A goal asked for (a Stuck check line) opens in the full checklist.
  const [fullChecklist, setFullChecklist] = useState(arrivedGoal !== undefined);
  useEffect(() => {
    if (arrivedGoal) void navigate(location.pathname, { replace: true, state: null });
  }, [arrivedGoal, location.pathname, navigate]);
  const [stuckOpen, setStuckOpen] = useState(false);
  // Adding or editing a finding splits the page; its draft is kept in memory when the split closes.
  const [split, setSplit] = useState<Finding | "new" | null>(null);
  const [stuckHost, setStuckHost] = useState(hostId);
  if (stuckHost !== hostId) {
    setStuckHost(hostId);
    setStuckOpen(false);
    setSplit(null);
  }
  // The stuck view and the notes panel share the right edge: opening one closes the other.
  // The Arsenal drawer shares that edge too.
  useEffect(() => useNotesStore.subscribe((s) => { if (s.open) setStuckOpen(false); }), []);
  useEffect(() => useArsenalStore.subscribe((s) => { if (s.open) setStuckOpen(false); }), []);
  const toggleStuck = () => {
    // The stuck view replaces the split; the finding draft stays.
    if (split) {
      setSplit(null);
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
      setStuckOpen(true);
      return;
    }
    if (!stuckOpen) {
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
    }
    setStuckOpen(!stuckOpen);
  };
  const openFinding = (f: Finding | "new") => {
    // The split shows the host's notes itself, and takes the page's right side.
    useNotesStore.getState().close();
    setStuckOpen(false);
    setSplit(f);
  };
  useKeydown((e) => {
    if (!isFreeKey(e)) return;
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      toggleStuck();
    } else if ((e.key === "f" || e.key === "F") && !split) {
      // F: add a finding on this host.
      e.preventDefault();
      openFinding("new");
    }
  });
  // ⌥1–3 pick the tabs. Matched by physical key: on a Mac, ⌥1 types "¡".
  useKeydown((e) => {
    if (split || !e.altKey || e.metaKey || e.ctrlKey || e.defaultPrevented || isTypingTarget(e.target) || isDialogOpen()) return;
    const t = TABS.find((x) => x.code === e.code);
    if (!t) return;
    e.preventDefault();
    setTab(t.id);
    setFocusGoal(undefined);
  });
  const [rootRef, width] = useWidth();
  const stacked = width !== undefined && width < TWO_COLUMNS_PX;
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

  const facts = <FactsColumn engagementId={engagementId} host={host} variant={stacked ? "stacked" : "column"} onOpenEntry={openInLog} />;

  return (
    <div ref={rootRef} className="@container/host grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
      <HostHeader host={host} onStuck={toggleStuck} />
      {split ? (
        <FindingSplit
          key={split === "new" ? "new" : split.id}
          eid={engagementId}
          hostId={hostId}
          edit={split}
          onClose={() => setSplit(null)}
        />
      ) : (
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 @min-[760px]/host:grid-cols-[minmax(16rem,1fr)_minmax(0,1.4fr)] @min-[760px]/host:grid-rows-1 @min-[760px]/host:gap-6">
          <div className={`max-h-[40vh] ${SCROLL_PANE} @min-[760px]/host:max-h-none`}>{facts}</div>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div role="tablist" aria-label="Host work" className="flex gap-2">
                {TABS.map((t, i) => (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={tab === t.id}
                    title={`${t.label} (⌥${i + 1})`}
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
              {tab === "next" && <FullChecklistToggle full={fullChecklist} onChange={setFullChecklist} />}
            </div>
            <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label} className={`mt-3 flex-1 border-t border-line ${SCROLL_PANE}`}>
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
              ) : tab === "next" ? (
                <NextTab engagementId={engagementId} host={host} full={fullChecklist} focusGoal={focusGoal} onOpenEntry={openInLog} />
              ) : (
                <HostFindings engagementId={engagementId} host={host} onOpenEntry={openInLog} onOpenFinding={openFinding} />
              )}
            </div>
          </div>
        </div>
      )}
      <StuckView
        engagementId={engagementId}
        host={host}
        open={stuckOpen}
        onClose={() => setStuckOpen(false)}
        onOpenGoal={(id) => {
          setTab("next");
          setFullChecklist(true);
          setFocusGoal((f) => ({ id, n: (f?.n ?? 0) + 1 }));
          setStuckOpen(false);
        }}
      />
    </div>
  );
}
