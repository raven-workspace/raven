import {
  Key,
  ListBullets,
  ListChecks,
  FileText,
  Flag,
  SquaresFour,
  SidebarSimple,
  type Icon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { NavLink } from "react-router";
import { cx } from "../../lib/cx";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen, useKeydown } from "../../lib/keys";
import { HostDialog } from "../hosts/HostDialog";
import { HostGlyph } from "../hosts/HostGlyph";
import { useHosts } from "../hosts/queries";
import { ThreadDot } from "../notes/ThreadDot";
import { useThreadCounts } from "../notes/useThreadCounts";
import { SECTIONS, sectionPath, type SectionId } from "./sections";
import { useSidebarStore } from "./useSidebarStore";

const SECTION_ICONS: Record<SectionId, Icon> = {
  board: SquaresFour,
  log: ListBullets,
  credentials: Key,
  findings: Flag,
  checklist: ListChecks,
  report: FileText,
};

const row =
  "flex h-[30px] cursor-default items-center justify-between rounded-sm px-2 text-left text-[13px] no-underline transition-colors duration-100";
const rowState = (on: boolean) =>
  on ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted-2 hover:bg-surface hover:text-fg";
const heading = "m-0 text-[10.5px] font-semibold uppercase tracking-label text-faint";

export function Sidebar({ engagementId }: { engagementId: string }) {
  const hostsId = useId();
  const hosts = useHosts(engagementId);
  const [adding, setAdding] = useState(false);
  const threads = useThreadCounts(engagementId).byHost;
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const list = hosts.data ?? [];

  // ⌘B is a meta chord, so `isFreeKey` (which refuses meta) does not apply; a dialog still wins.
  useKeydown((e) => {
    if (e.key.toLowerCase() !== "b" || !e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isDialogOpen()) return;
    e.preventDefault();
    toggle();
  });

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <nav
      aria-label="Engagement"
      className={cx(
        "flex min-h-0 flex-col gap-px overflow-y-auto overflow-x-hidden border-r border-line py-3.5",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-12 px-1.5" : "w-[200px] px-3",
      )}
    >
      <div className={cx("mb-1.5 grid items-center", collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[minmax(0,1fr)_auto] px-2")}>
        <h2 className={cx(heading, collapsed && "sr-only")}>Engagement</h2>
        <button
          type="button"
          aria-label={label}
          title={`${label} (⌘B)`}
          aria-expanded={!collapsed}
          onClick={toggle}
          className="grid size-6 cursor-default place-items-center rounded-sm text-muted-2 hover:bg-surface hover:text-fg"
        >
          <SidebarSimple size={16} weight="light" aria-hidden />
        </button>
      </div>
      {SECTIONS.map((s, i) => {
        const SectionIcon = SECTION_ICONS[s.id];
        return (
          <NavLink
            key={s.id}
            to={sectionPath(engagementId, s.id)}
            end
            title={collapsed ? `${s.label} (${i + 1})` : undefined}
            aria-label={collapsed ? s.label : undefined}
            className={({ isActive }) => cx(row, collapsed && "justify-center px-0", rowState(isActive))}
          >
            {collapsed ? (
              <span className="grid grid-cols-[auto_auto] items-end gap-0.5">
                <SectionIcon size={16} weight="light" aria-hidden />
                <span aria-hidden className="font-mono text-[9px] text-faint">
                  {i + 1}
                </span>
              </span>
            ) : (
              <>
                <span className="truncate">{s.label}</span>
                <span aria-hidden className="font-mono text-[10.5px] text-faint">
                  {i + 1}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
      <h2 id={hostsId} className={cx(heading, "mt-5 mb-1.5 px-2", collapsed && "sr-only")}>
        Hosts
      </h2>
      {hosts.isSuccess && list.length === 0 && !collapsed && (
        <p aria-labelledby={hostsId} className="m-0 px-2 text-xs text-faint">
          No hosts yet
        </p>
      )}
      {list.map((h) => {
        const dot = <ThreadDot count={threads.get(h.id) ?? 0} />;
        return (
          <NavLink
            key={h.id}
            to={`/e/${engagementId}/h/${h.id}`}
            title={h.name}
            className={({ isActive }) =>
              cx(
                "grid cursor-default items-center gap-2 rounded-sm text-left text-[13px] no-underline transition-colors duration-100",
                collapsed ? "h-[30px] grid-cols-1 justify-items-center px-0" : "min-h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] px-2 py-1",
                rowState(isActive),
              )
            }
          >
            <HostGlyph column={h.boardColumn} />
            {collapsed ? (
              <span className="sr-only">{h.name}</span>
            ) : (
              <>
                <span className="grid min-w-0 grid-cols-1">
                  <span className="truncate">{shortHostName(h.name)}</span>
                  {h.ip && <span className="font-mono text-[10.5px] text-faint">{h.ip}</span>}
                </span>
                {dot}
              </>
            )}
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label={collapsed ? "Add host" : undefined}
        title={collapsed ? "Add host" : undefined}
        className={cx(row, "justify-start text-faint hover:bg-surface hover:text-fg", collapsed && "justify-center px-0")}
      >
        {collapsed ? "+" : "+ Add host"}
      </button>
      <HostDialog open={adding} onOpenChange={setAdding} engagementId={engagementId} />
    </nav>
  );
}
