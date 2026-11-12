import { DotsThree } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cx } from "../../lib/cx";
import { TAB_MARK } from "../../ui/shadcn/tabs";
import { TabMarker } from "../../ui/TabMarker";

/** One tab of the report's tab row (§10.1): Front matter, a target, Closing, an appendix or (later) a page. */
export interface TabItem {
  id: string;
  label: string;
  /** The small text under the label: `ready`, `N to do` (amber), `not started`, or `detail` for tabs without checks. */
  state: "ready" | "todo" | "not-started" | "none";
  /** Failing checks, for `todo`. */
  todo?: number;
  /** A tab without checks says what it holds ("lnx02, 2 items"). */
  detail?: string;
  /** Targets: ⌥←/⌥→ change the grading order. */
  reorderable?: boolean;
  /** An owner-written page: it has a ⋯ menu (Rename, Delete). */
  page?: boolean;
}

const TAB = '[role="tab"]';

const tabById = (root: HTMLElement | null, id: string) => [...(root?.querySelectorAll<HTMLElement>(TAB) ?? [])].find((t) => t.dataset.id === id);

/** Moves focus to the tab `delta` steps from `from` (or from the selected tab), wrapping at the ends. */
export function focusReportTab(root: HTMLElement | null, delta: number, from?: Element | null) {
  if (!root) return;
  const tabs = [...root.querySelectorAll<HTMLElement>(TAB)];
  if (tabs.length === 0) return;
  const start = from && tabs.includes(from as HTMLElement) ? tabs.indexOf(from as HTMLElement) : tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
  const at = ((start === -1 ? 0 : start) + delta + tabs.length) % tabs.length;
  tabs[at].focus();
}

/**
 * ←/→ (and Home/End) move focus along a tablist; ↵ or Space opens the focused tab. Opening is never automatic: a tab
 * opens a page and flushes the one before, so arrowing past tabs shouldn't. Returns whether it took the key.
 */
function walkTabs(e: KeyboardEvent<HTMLElement>, onOpen: (id: string) => void): boolean {
  const tab = (e.target as HTMLElement).closest<HTMLElement>(TAB);
  if (!tab || e.metaKey || e.ctrlKey || e.altKey) return false;
  const root = e.currentTarget;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") focusReportTab(root, e.key === "ArrowRight" ? 1 : -1, tab);
  else if (e.key === "Home" || e.key === "End") {
    const tabs = [...root.querySelectorAll<HTMLElement>(TAB)];
    tabs[e.key === "Home" ? 0 : tabs.length - 1]?.focus();
  } else if (e.key === "Enter" || e.key === " ") onOpen(tab.dataset.id!);
  else return false;
  e.preventDefault();
  return true;
}

const STATE_TEXT: Record<Exclude<TabItem["state"], "none">, string> = { ready: "ready", todo: "to do", "not-started": "not started" };

const ITEM =
  "grid h-7 items-center rounded-sm border-0 bg-transparent px-2 text-left text-body text-fg-2 outline-none hover:bg-surface-hi hover:text-fg focus-visible:bg-surface-hi focus-visible:text-fg";

/** ↑↓ walk a menu's items, wrapping. */
function walkItems(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}

/** A small menu of text items in a popover: its own portal, so the scrolling tab row never clips it. */
function MenuPopover({ trigger, label, items }: { trigger: ReactNode; label: string; items: { label: string; run(): void; destructive?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          role="menu"
          aria-label={label}
          onKeyDown={walkItems}
          className="z-50 grid min-w-40 gap-1 rounded-md border border-line-strong bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,.6)]"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={cx(ITEM, it.destructive && "hover:text-warn focus-visible:text-warn")}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Tab({
  tab,
  selected,
  onOpen,
  onTodo,
}: {
  tab: TabItem;
  selected: boolean;
  onOpen(): void;
  onTodo?(): void;
}) {
  const stateText = tab.state === "none" ? (tab.detail ?? "") : tab.state === "todo" ? `${tab.todo ?? 0} ${STATE_TEXT.todo}` : STATE_TEXT[tab.state];
  return (
    <button
      type="button"
      role="tab"
      data-id={tab.id}
      aria-selected={selected}
      // Roving tabindex: Tab enters the row at the open tab; the arrows move from there.
      tabIndex={selected ? 0 : -1}
      onClick={onOpen}
      className={cx(
        "grid cursor-default content-end whitespace-nowrap rounded-sm border-0 bg-transparent px-3 py-1 text-left",
        selected ? "text-fg" : "text-muted-2 hover:bg-surface hover:text-fg",
      )}
    >
      <span data-tab-label className="text-body">
        {tab.label}
      </span>
      <span
        data-tab-state
        // `N to do` opens the tab and its To do panel; the rest of the tab only opens it.
        onClick={
          tab.state === "todo" && onTodo
            ? (e) => {
                e.stopPropagation();
                onOpen();
                onTodo();
              }
            : undefined
        }
        className={cx(
          "text-label font-normal",
          tab.state === "ready" ? "text-accent" : tab.state === "todo" ? "text-warn hover:underline" : selected ? "text-muted-2" : "text-faint",
        )}
      >
        {stateText || " "}
      </span>
    </button>
  );
}

/**
 * The report's tab row under the status strip (§10.1, mock A): Front matter, the targets in grading order, Closing and
 * the appendices, then + Page. It is a roving-tabindex tablist (←/→ move, ↵ opens, ⌥←/⌥→ reorder a target) that
 * scrolls sideways when it overflows, keeping the open tab in view; the export slot sits outside the scroller, so it
 * never scrolls away.
 */
export function ReportTabs({
  tabs,
  openId,
  onOpen,
  onReorder,
  onTodo,
  onAddPage,
  onPageMenu,
  exportSlot,
  listRef,
}: {
  tabs: TabItem[];
  openId: string;
  onOpen(id: string): void;
  onReorder(id: string, delta: -1 | 1): void;
  /** A tab's `N to do` was clicked: open its To do panel (the tab itself opens through `onOpen`). */
  onTodo?(id: string): void;
  /** Offered as + Page only when given (pages arrive with the pages round). */
  onAddPage?(placement: "appendix" | "body"): void;
  onPageMenu?(id: string, action: "rename" | "delete"): void;
  exportSlot: ReactNode;
  listRef?: Ref<HTMLDivElement>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // A reordered tab keeps focus: the row re-renders with it elsewhere, and a moved node can lose focus in WebKit.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = tabById(scroller.current, id);
    if (el && document.activeElement !== el) el.focus();
  });
  // The open tab stays in view as it changes (and as tabs come and go).
  useEffect(() => {
    tabById(scroller.current, openId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openId, tabs.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (walkTabs(e, onOpen)) return;
    if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const tab = (e.target as HTMLElement).closest<HTMLElement>(TAB);
    const item = tab && tabs.find((t) => t.id === tab.dataset.id);
    if (!item?.reorderable) return;
    e.preventDefault();
    e.stopPropagation();
    refocus.current = item.id;
    onReorder(item.id, e.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-line">
      <div ref={scroller} className="min-w-0 overflow-x-auto overflow-y-hidden">
        <div className="grid grid-flow-col auto-cols-max items-center justify-start gap-2 py-1 pl-4 pr-4">
          <div ref={listRef} role="tablist" aria-label="Report pages" onKeyDown={onKeyDown} className="relative isolate grid grid-flow-col auto-cols-max items-stretch gap-1">
            <TabMarker className={TAB_MARK} />
            {tabs.map((t) =>
              t.page && onPageMenu ? (
                <div key={t.id} role="presentation" className="grid grid-cols-[auto_auto] items-center">
                  <Tab tab={t} selected={t.id === openId} onOpen={() => onOpen(t.id)} onTodo={onTodo && (() => onTodo(t.id))} />
                  <MenuPopover
                    label={`${t.label} actions`}
                    trigger={
                      <button type="button" aria-label={`${t.label} actions`} className="inline-grid size-7 cursor-default place-items-center rounded-sm border-0 bg-transparent text-muted-2 hover:bg-surface-hi hover:text-fg">
                        <DotsThree size={16} weight="bold" aria-hidden />
                      </button>
                    }
                    items={[
                      { label: "Rename", run: () => onPageMenu(t.id, "rename") },
                      { label: "Delete", run: () => onPageMenu(t.id, "delete"), destructive: true },
                    ]}
                  />
                </div>
              ) : (
                <Tab key={t.id} tab={t} selected={t.id === openId} onOpen={() => onOpen(t.id)} onTodo={onTodo && (() => onTodo(t.id))} />
              ),
            )}
          </div>
          {onAddPage && (
            <MenuPopover
              label="Add a page"
              trigger={
                <button type="button" className="h-7 cursor-default rounded-sm border-0 bg-transparent px-2 text-body text-accent hover:bg-surface-hi">
                  + Page
                </button>
              }
              items={[
                { label: "Appendix page", run: () => onAddPage("appendix") },
                { label: "Free page", run: () => onAddPage("body") },
              ]}
            />
          )}
        </div>
      </div>
      {exportSlot != null && exportSlot !== false && <div className="grid grid-flow-col items-center gap-2 pl-2 pr-4">{exportSlot}</div>}
    </div>
  );
}

/**
 * The segmented row at the top of Front matter and Closing (§10.1): one tab per part, each part its own stored section
 * and editor. The same keys as the tab row: ←/→ move, ↵ opens.
 */
export function PartTabs({ label, parts, openId, onOpen }: { label: string; parts: { id: string; label: string }[]; openId: string; onOpen(id: string): void }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => walkTabs(e, onOpen)}
      className="relative isolate grid grid-flow-col auto-cols-max items-center justify-start gap-1"
    >
      <TabMarker className={TAB_MARK} />
      {parts.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          data-id={p.id}
          aria-selected={p.id === openId}
          tabIndex={p.id === openId ? 0 : -1}
          onClick={() => onOpen(p.id)}
          className={cx(
            "h-7 cursor-default whitespace-nowrap rounded-sm border-0 bg-transparent px-2 text-body",
            p.id === openId ? "text-fg" : "text-muted-2 hover:bg-surface hover:text-fg",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
