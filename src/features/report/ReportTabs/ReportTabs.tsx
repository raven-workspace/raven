import { DotsThree } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cx } from "../../../lib/cx";
import { TAB_MARK } from "../../../ui/shadcn/tabs";
import { IconButton } from "../../../ui/IconButton";
import { TabMarker } from "../../../ui/TabMarker";
import { MENU, MENU_ITEM, MENU_ITEM_DESTRUCTIVE, walkMenuItems } from "../menuItems/menuItems";
import "./ReportTabs.scss";

/** One tab of the report's tab row (§10.1): Front matter, a target, Closing, an appendix or an owner-written page. */
export interface TabItem {
  id: string;
  label: string;
  /** The small text under the label: `ready`, `N to do` (amber), `not started`, or `detail` for tabs without checks. */
  state: "ready" | "todo" | "not-started" | "none";
  /** Failing checks, for `todo`. */
  todo?: number;
  /** A tab without checks says what it holds ("lnx02, 2 items"). */
  detail?: string;
  /** Targets and pages: ⌥←/⌥→ change their order. */
  reorderable?: boolean;
  /** An owner-written page: Rename and Delete in the Page actions menu, F2 and Delete on the focused tab. */
  page?: boolean;
  /** A page's own title, which Rename edits (the label may add its letter: "Appendix C"). */
  title?: string;
}

const TAB = '[role="tab"]';

/** A tab's element id, which the page region (`role="tabpanel"`) names in `aria-labelledby`. */
export const reportTabDomId = (id: string) => `report-tab-${id}`;

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

/** A menu item; `movesFocus` items put focus somewhere themselves (an input, a dialog), so it doesn't go back to the
 *  trigger. `run` gets the trigger, for a dialog to hand focus back to. */
type MenuItem = { label: string; run(trigger: HTMLElement | null): void; destructive?: boolean; movesFocus?: boolean };

/** A small menu of text items in a popover: its own portal, so the scrolling tab row never clips it. */
function MenuPopover({ trigger, label, items }: { trigger: ReactNode; label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const focusMoved = useRef(false);
  // The button that opened the menu (a click doesn't focus a button in WebKit, so it is kept from the click).
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild onClick={(e) => (opener.current = e.currentTarget)}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          role="menu"
          aria-label={label}
          onKeyDown={walkMenuItems}
          onCloseAutoFocus={(e) => {
            if (focusMoved.current) e.preventDefault();
            focusMoved.current = false;
          }}
          className={MENU}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.destructive ? MENU_ITEM_DESTRUCTIVE : MENU_ITEM}
              onClick={() => {
                focusMoved.current = !!it.movesFocus;
                setOpen(false);
                it.run(opener.current);
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
  panelId,
  renaming,
  onOpen,
  onTodo,
}: {
  tab: TabItem;
  selected: boolean;
  /** The page region the tab controls. */
  panelId?: string;
  /** Its title is being edited over it: it keeps its place in the row, hidden. */
  renaming?: boolean;
  onOpen(): void;
  onTodo?(): void;
}) {
  const stateText = tab.state === "none" ? (tab.detail ?? "") : tab.state === "todo" ? `${tab.todo ?? 0} ${STATE_TEXT.todo}` : STATE_TEXT[tab.state];
  return (
    <button
      type="button"
      role="tab"
      id={reportTabDomId(tab.id)}
      data-id={tab.id}
      // The name says where the tab stands too ("1 lnx02, 3 to do"), which the state's own text only shows.
      aria-label={stateText ? `${tab.label}, ${stateText}` : tab.label}
      aria-selected={selected}
      aria-controls={panelId}
      aria-hidden={renaming || undefined}
      data-renaming={renaming || undefined}
      // Roving tabindex: Tab enters the row at the open tab; the arrows move from there.
      tabIndex={selected ? 0 : -1}
      onClick={onOpen}
      className="report-tab"
    >
      <span data-tab-label className="report-tab__label">
        {tab.label}
      </span>
      <span
        data-tab-state
        // `N to do` opens the tab and its To do panel; the rest of the tab only opens it. A mouse shortcut: from the
        // keyboard, the strip's To do opens the panel.
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
          "report-tab__state",
          tab.state === "ready" ? "report-tab__state--ready" : tab.state === "todo" ? "report-tab__state--todo" : selected && "report-tab__state--selected",
        )}
      >
        {stateText || " "}
      </span>
    </button>
  );
}

/** A page's title, edited in place of its tab: ↵ keeps it, Esc (or an empty title) leaves the old one. */
function RenameInput({ initial, style, onDone }: { initial: string; style?: CSSProperties; onDone(title: string | null, byKey: boolean): void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (title: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(title?.trim() ? title.trim() : null, byKey);
  };
  return (
    <input
      aria-label="Page title"
      autoFocus
      value={value}
      maxLength={200}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value, false)}
      onKeyDown={(e) => {
        // The tab row's own keys (arrows, ↵, F2) never reach it while typing.
        e.stopPropagation();
        if (e.key === "Enter") finish(value, true);
        else if (e.key === "Escape") finish(null, true);
      }}
      style={style}
      className="report-tabs__rename"
    />
  );
}

/**
 * The report's tab row under the status strip (§10.1, mock A): Front matter, the targets in grading order, Closing and
 * the appendices, then + Page. It is a roving-tabindex tablist (←/→ move, ↵ opens, ⌥←/⌥→ reorder a target or a page) that
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
  onRenamePage,
  onDeletePage,
  exportSlot,
  listRef,
  panelId,
}: {
  tabs: TabItem[];
  openId: string;
  /** The page region's id (`role="tabpanel"`): every tab controls it. */
  panelId?: string;
  onOpen(id: string): void;
  onReorder(id: string, delta: -1 | 1): void;
  /** A tab's `N to do` was clicked: open its To do panel (the tab itself opens through `onOpen`). */
  onTodo?(id: string): void;
  /** Offered as + Page only when given. */
  onAddPage?(placement: "appendix" | "body"): void;
  /** A page's new title (trimmed, never empty). */
  onRenamePage?(id: string, title: string): void;
  /** Delete was asked for a page, from `from` (Page actions or the tab): the caller confirms, then gives focus back. */
  onDeletePage?(id: string, from: HTMLElement | null): void;
  exportSlot: ReactNode;
  listRef?: Ref<HTMLDivElement>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // The page whose title is being edited in place of its tab.
  const [renaming, setRenaming] = useState<string | null>(null);
  const openPage = tabs.find((t) => t.id === openId && t.page);
  const renamed = renaming ? tabs.find((t) => t.id === renaming) : undefined;
  // A reordered tab keeps focus: the row re-renders with it elsewhere, and a moved node can lose focus in WebKit.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    const el = tabById(scroller.current, id);
    if (el && document.activeElement !== el) el.focus();
  });
  // The title field sits over the tab it renames, outside the tablist (which holds only tabs): as wide as the tab, which
  // keeps its place in the row (at least 12rem, from its stylesheet), so the row doesn't move when renaming starts.
  const row = useRef<HTMLDivElement>(null);
  const [renameBox, setRenameBox] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    const el = renaming ? tabById(scroller.current, renaming) : undefined;
    const at = row.current?.getBoundingClientRect();
    if (!el || !at) {
      setRenameBox(undefined);
      return;
    }
    const box = el.getBoundingClientRect();
    setRenameBox({ left: box.left - at.left, top: box.top - at.top, width: box.width, height: box.height });
  }, [renaming, tabs]);
  // The open tab stays in view as it changes (and as tabs come and go).
  useEffect(() => {
    tabById(scroller.current, openId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openId, tabs.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (walkTabs(e, onOpen)) return;
    // A focused page tab: F2 renames, Delete (or ⌫) asks to delete.
    const focused = (e.target as HTMLElement).closest<HTMLElement>(TAB);
    const page = focused && tabs.find((t) => t.id === focused.dataset.id && t.page);
    if (page && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === "F2" && onRenamePage) {
        e.preventDefault();
        setRenaming(page.id);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && onDeletePage) {
        e.preventDefault();
        onDeletePage(page.id, focused);
        return;
      }
    }
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
    <div className="report-tabs">
      <div ref={scroller} className="report-tabs__scroller">
        <div ref={row} className="report-tabs__row">
          <div ref={listRef} role="tablist" aria-label="Report pages" onKeyDown={onKeyDown} className="report-tabs__list">
            <TabMarker className={TAB_MARK} />
            {tabs.map((t) => (
              <Tab
                key={t.id}
                tab={t}
                selected={t.id === openId}
                panelId={panelId}
                renaming={t.id === renaming}
                onOpen={() => onOpen(t.id)}
                onTodo={onTodo && (() => onTodo(t.id))}
              />
            ))}
          </div>
          {renamed && (
            <RenameInput
              key={renamed.id}
              initial={renamed.title ?? renamed.label}
              style={renameBox}
              onDone={(title, byKey) => {
                setRenaming(null);
                if (title !== null && title !== renamed.title) onRenamePage?.(renamed.id, title);
                // ↵ or Esc: focus goes back to the tab once it is back in the row (a click elsewhere keeps its focus).
                if (byKey) refocus.current = renamed.id;
              }}
            />
          )}
          {/* The open page's actions sit outside the tablist, which owns only tabs (F2 and Delete work on the tab itself). */}
          {openPage && (onRenamePage || onDeletePage) && (
            <MenuPopover
              label="Page actions"
              // No F2 on its tooltip: F2 renames from a focused tab, not from here.
              trigger={<IconButton icon={DotsThree} label="Page actions" />}
              items={[
                ...(onRenamePage ? [{ label: "Rename", run: () => setRenaming(openPage.id), movesFocus: true }] : []),
                ...(onDeletePage ? [{ label: "Delete", run: (from: HTMLElement | null) => onDeletePage(openPage.id, from), destructive: true, movesFocus: true }] : []),
              ]}
            />
          )}
          {onAddPage && (
            <MenuPopover
              label="Add a page"
              trigger={
                <button type="button" className="report-tabs__add">
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
      {exportSlot != null && exportSlot !== false && <div className="report-tabs__export">{exportSlot}</div>}
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
      className="part-tabs"
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
          className="part-tabs__tab"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
