import {
  Key,
  ListBullets,
  ListChecks,
  FileText,
  Flag,
  Plus,
  SquaresFour,
  SidebarSimple,
  type Icon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { NavLink } from "react-router";
import { cx } from "../../lib/cx";
import { shortHostName } from "../../lib/hostName";
import { IconButton } from "../../ui";
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
  "grid h-[30px] cursor-default items-center rounded-sm text-left text-body no-underline transition-colors duration-100";
const rowState = (on: boolean) =>
  on ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted-2 hover:bg-surface hover:text-fg";
const heading = "m-0 text-label text-faint";

const LAST_OCTET = /(\d{1,3})$/;

/** Rail label: the first 4 characters of the name, or the last octet when there is no name. */
function railName(name: string, ip: string | null): string {
  const n = name.trim();
  if (n) return n.slice(0, 4);
  return ip?.match(LAST_OCTET)?.[1] ?? "?";
}

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
        "grid min-h-0 grid-cols-1 content-start gap-px overflow-y-auto overflow-x-hidden border-r border-line py-3.5",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-12 px-1.5" : "w-[200px] px-3",
      )}
    >
      <div className={cx("mb-1.5 grid items-center", collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[minmax(0,1fr)_28px] pl-2")}>
        <h2 className={cx(heading, collapsed && "sr-only")}>Engagement</h2>
        <IconButton
          icon={SidebarSimple}
          label={label}
          shortcut="⌘B"
          aria-expanded={!collapsed}
          onClick={toggle}
        />
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
            className={({ isActive }) =>
              cx(
                row,
                collapsed ? "grid-cols-[16px] justify-center" : "grid-cols-[16px_minmax(0,1fr)_auto] gap-2 px-2",
                rowState(isActive),
              )
            }
          >
            <SectionIcon size={16} weight="light" aria-hidden />
            {!collapsed && (
              <>
                <span className="truncate">{s.label}</span>
                <span aria-hidden className="font-mono text-meta text-faint">
                  {i + 1}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
      <div className={cx("mt-5 mb-1.5 grid items-center", collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[minmax(0,1fr)_28px] pl-2")}>
        <h2 id={hostsId} className={cx(heading, collapsed && "sr-only")}>
          Hosts
        </h2>
        <IconButton icon={Plus} label="Add host" onClick={() => setAdding(true)} />
      </div>
      {hosts.isSuccess && list.length === 0 && !collapsed && (
        <p aria-labelledby={hostsId} className="m-0 px-2 text-meta text-faint">
          No hosts yet
        </p>
      )}
      {list.map((h) => {
        const dot = <ThreadDot count={threads.get(h.id) ?? 0} />;
        return (
          <NavLink
            key={h.id}
            to={`/e/${engagementId}/h/${h.id}`}
            title={collapsed ? [h.name, h.ip].filter(Boolean).join("\n") : h.name}
            className={({ isActive }) =>
              cx(
                "grid cursor-default items-center rounded-sm text-left text-body no-underline transition-colors duration-100",
                collapsed
                  ? "min-h-[44px] grid-cols-[minmax(0,1fr)] justify-items-center gap-0.5 px-0 py-1"
                  : "min-h-[44px] grid-cols-[16px_minmax(0,1fr)_auto] gap-2 px-2 py-1",
                rowState(isActive),
              )
            }
          >
            <HostGlyph column={h.boardColumn} />
            {collapsed ? (
              <>
                <span className="sr-only">{h.name}</span>
                <span aria-hidden className="max-w-full truncate font-mono text-meta">
                  {railName(h.name, h.ip)}
                </span>
              </>
            ) : (
              <>
                <span className="grid min-w-0 grid-cols-1">
                  <span className="truncate">{shortHostName(h.name)}</span>
                  {h.ip && <span className="truncate font-mono text-meta text-faint">{h.ip}</span>}
                </span>
                {dot}
              </>
            )}
          </NavLink>
        );
      })}
      <HostDialog open={adding} onOpenChange={setAdding} engagementId={engagementId} />
    </nav>
  );
}
