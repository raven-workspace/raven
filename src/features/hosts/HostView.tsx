import { useCallback, useEffect, useRef, useState } from "react";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { useLocation, useNavigate } from "react-router";
import { isDialogOpen, isFreeKey, isTypingTarget, useKeydown } from "../../lib/keys";
import { Button, EmptyState, HintLine, LoadingState, queryState, type Hint } from "../../ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/shadcn/tabs";
import type { Finding } from "../../types/findings";
import { FindingSplit } from "../findings/FindingSplit";
import { HostFindings } from "../findings/HostFindings";
import { useLog } from "../log/queries";
import { LogDays } from "../log/LogDays";
import { LogEntryRow } from "../log/LogEntryRow";
import { OrderButton } from "../log/OrderButton";
import { byOrder, usePersistedOrder } from "../log/usePersistedOrder";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
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

const HINTS: Hint[] = [
  { keys: "J", label: "next step", priority: 1 },
  { keys: "H", label: "stuck", priority: 2 },
  { keys: "F", label: "finding", priority: 3 },
  { keys: "L", label: "capture", priority: 2 },
  { keys: "⌥1–3", label: "tabs", priority: 4 },
];

/** The Arsenal or Payloads drawer is open over this page: its keys win (they are not role=dialog). Notes is left out: H and F still work over it, and J below checks it too. */
const drawerOpen = () => useArsenalStore.getState().open || usePayloadsStore.getState().open;

/** The first To do or Doing step on screen, in checklist order: its expand button gets focus and the row scrolls into view. */
function focusFirstOpenStep(): boolean {
  const row = document.querySelector<HTMLElement>('li[data-goal-id][data-status="todo"], li[data-goal-id][data-status="in_progress"]');
  const target = row?.querySelector<HTMLElement>("button");
  if (!row || !target) return false;
  target.focus();
  row.scrollIntoView({ block: "nearest" });
  return true;
}

/** Two columns from this width of the host page (the `@min-[760px]/host` container query); stacked below it. */
const TWO_COLUMNS_PX = 760;

/**
 * The element's width, once measured; undefined until then (and in tests, which have no layout). Measured as the ref
 * attaches, during the commit, so the first paint already knows it: the fact groups never paint open and then fold.
 */
function useWidth() {
  const [width, setWidth] = useState<number>();
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const set = (w: number) => { if (w > 0) setWidth(w); };
    set(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
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
  useEffect(() => usePayloadsStore.subscribe((s) => { if (s.open) setStuckOpen(false); }), []);
  const toggleStuck = () => {
    // The stuck view replaces the split; the finding draft stays.
    if (split) {
      setSplit(null);
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
      usePayloadsStore.getState().close();
      setStuckOpen(true);
      return;
    }
    if (!stuckOpen) {
      useNotesStore.getState().close();
      useArsenalStore.getState().close();
      usePayloadsStore.getState().close();
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
    if (!isFreeKey(e) || drawerOpen()) return;
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
  // J: a jump asked for (`n` counts the presses); it runs after the render that shows the Next tab, and widens to the
  // full checklist when the current stage has nothing open.
  const [jump, setJump] = useState(0);
  const widened = useRef(false);
  const [jumpNote, setJumpNote] = useState<string>();
  useKeydown((e) => {
    if (!isFreeKey(e) || drawerOpen() || useNotesStore.getState().open || (e.key !== "j" && e.key !== "J") || split || stuckOpen) return;
    e.preventDefault();
    // The Next tab's checklist is not on screen yet (loading): nothing to jump to, and no false "all done".
    if (tab === "next" && !document.querySelector("[data-checklist-ready]")) {
      setJumpNote("Checklist loading");
      return;
    }
    widened.current = false;
    setJumpNote(undefined);
    setTab("next");
    setFocusGoal(undefined);
    setJump((n) => n + 1);
  });
  useEffect(() => {
    if (jump === 0 || tab !== "next") return;
    // State changes go through a microtask: this effect reacts to the render, it does not feed another one back.
    if (!document.querySelector("[data-checklist-ready]")) {
      queueMicrotask(() => {
        setJump(0);
        setJumpNote("Checklist loading");
      });
    } else if (focusFirstOpenStep()) {
      queueMicrotask(() => setJump(0));
    } else if (!fullChecklist) {
      widened.current = true;
      queueMicrotask(() => setFullChecklist(true));
    } else {
      const restore = widened.current;
      widened.current = false;
      queueMicrotask(() => {
        setJump(0);
        if (restore) setFullChecklist(false);
        setJumpNote("Every step is done");
      });
    }
  }, [jump, tab, fullChecklist]);
  useEffect(() => {
    if (!jumpNote) return;
    const t = setTimeout(() => setJumpNote(undefined), 4000);
    return () => clearTimeout(t);
  }, [jumpNote]);
  const [rootRef, width] = useWidth();
  const stacked = width !== undefined && width < TWO_COLUMNS_PX;
  const selectTab = (id: TabId) => {
    setTab(id);
    setFocusGoal(undefined);
  };
  const openInLog = (id: string) => {
    setOpenEntry(id);
    setTab("log");
  };
  const host = hosts.data?.find((h) => h.id === hostId);

  const hostsState = queryState([hosts], "this host");
  if (hostsState || !hosts.data) return hostsState;
  if (!host) {
    return (
      <EmptyState
        title="Host not found"
        body="It may have been deleted."
        action={<Button onClick={() => void navigate(`/e/${engagementId}`)}>Back to the board</Button>}
      />
    );
  }
  const entries = (log.data ?? []).filter((e) => e.hostIds.includes(hostId)).sort(byOrder(order));

  const facts = <FactsColumn engagementId={engagementId} host={host} variant={stacked ? "stacked" : "column"} onOpenEntry={openInLog} />;

  return (
    <div ref={rootRef} data-hint-surface data-host-layout={width === undefined ? undefined : stacked ? "stacked" : "columns"} className="@container/host grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
      {/* No hint row: it cost a full line of log and facts. The keys are on their buttons' tooltips and in the `?` list. */}
      <HostHeader
        host={host}
        onStuck={toggleStuck}
        shortcuts={<HintLine hints={split ? HINTS.filter((h) => h.keys !== "J" && h.keys !== "⌥1–3") : HINTS} max={0} ariaLabel="Host shortcuts" />}
      />
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
          <Tabs
            value={tab}
            onValueChange={(v) => selectTab(v as TabId)}
            className="min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <TabsList aria-label="Host work">
                {TABS.map((t, i) => (
                  <TabsTrigger key={t.id} value={t.id} title={`${t.label} (⌥${i + 1})`} onClick={() => selectTab(t.id)}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tab === "log" && <OrderButton order={order} onChange={setOrder} />}
              {tab === "next" && (
                <div className="grid grid-flow-col items-center gap-3">
                  {jumpNote && <span role="status" className="text-meta text-muted">{jumpNote}</span>}
                  <FullChecklistToggle full={fullChecklist} onChange={setFullChecklist} />
                </div>
              )}
            </div>
            <TabsContent value={tab} aria-label={TABS.find((t) => t.id === tab)!.label} className={`border-t border-line ${SCROLL_PANE}`}>
              {tab === "log" ? (
                !log.data ? (
                  queryState([log], "the log") ?? <LoadingState label="the log" />
                ) : entries.length === 0 ? (
                  <p className="text-meta text-muted">Nothing logged on this host yet. Press L to capture.</p>
                ) : (
                  <div className="grid gap-3">
                    <LogDays entries={entries} row={(e) => <LogEntryRow key={e.id} entry={e} hosts={hosts.data} currentHostId={hostId} defaultOpen={e.id === openEntry} />} />
                  </div>
                )
              ) : tab === "next" ? (
                <NextTab engagementId={engagementId} host={host} full={fullChecklist} onShowFull={() => setFullChecklist(true)} focusGoal={focusGoal} onOpenEntry={openInLog} />
              ) : (
                <HostFindings engagementId={engagementId} host={host} onOpenEntry={openInLog} onOpenFinding={openFinding} />
              )}
            </TabsContent>
          </Tabs>
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
