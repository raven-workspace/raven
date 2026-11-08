import {
  Key,
  ListBullets,
  ListChecks,
  FileText,
  Flag,
  Plus,
  Kanban,
  SidebarSimple,
  type Icon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { NavLink, useMatch } from "react-router";
import { cx } from "../../lib/cx";
import { shortHostName } from "../../lib/hostName";
import { IconButton, Tooltip } from "../../ui";
import {
  Sidebar as ShadSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "../../ui/shadcn/sidebar";
import { isDialogOpen, useKeydown } from "../../lib/keys";
import type { Host } from "../../types/host";
import { HostDialog } from "../hosts/HostDialog";
import { HostGlyph } from "../hosts/HostGlyph";
import { useHosts } from "../hosts/queries";
import { ThreadDot } from "../notes/ThreadDot";
import { useThreadCounts } from "../notes/useThreadCounts";
import { SECTIONS, sectionPath, type SectionId } from "./sections";
import { useSidebarStore } from "./useSidebarStore";

const SECTION_ICONS: Record<SectionId, Icon> = {
  board: Kanban,
  log: ListBullets,
  credentials: Key,
  findings: Flag,
  checklist: ListChecks,
  report: FileText,
};

const heading = "m-0 text-label text-faint";
/** Both menus centre their items in the rail, so section boxes and host glyphs share one centre line. */
const menu = "gap-1 group-data-[collapsible=icon]:items-center";

const LAST_OCTET = /(\d{1,3})$/;

/** Rail label: the first 4 characters of the name without trailing - _ . ("web-" is "web"), or the last octet when that leaves under 2 characters. */
export function railName(name: string, ip: string | null): string {
  const n = name.trim().slice(0, 4).replace(/[-_.]+$/, "");
  if (n.length >= 2) return n;
  return ip?.match(LAST_OCTET)?.[1] ?? (n || "?");
}

function SectionItem({ engagementId, id, label, n, collapsed }: {
  engagementId: string; id: SectionId; label: string; n: number; collapsed: boolean;
}) {
  const to = sectionPath(engagementId, id);
  const active = useMatch({ path: to, end: true }) !== null;
  const SectionIcon = SECTION_ICONS[id];
  return (
    <SidebarMenuItem>
      {/* The key number lives in the rail tooltip ("Board" then "1"); the tooltip shows only when collapsed. */}
      <Tooltip
        side="right"
        disabled={!collapsed}
        content={
          <>
            <span>{label}</span>
            <span className="ml-2 font-mono text-muted">{n}</span>
          </>
        }
      >
        <SidebarMenuButton
          asChild
          isActive={active}
          className={cx("cursor-default", !collapsed && "grid h-[30px] grid-cols-[16px_minmax(0,1fr)_auto] px-2")}
        >
          <NavLink to={to} end aria-label={collapsed ? label : undefined}>
            <SectionIcon aria-hidden />
            {!collapsed && (
              <>
                <span>{label}</span>
                <span aria-hidden className="font-mono text-meta text-faint">
                  {n}
                </span>
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </Tooltip>
    </SidebarMenuItem>
  );
}

function HostItem({ engagementId, host: h, threads, collapsed }: {
  engagementId: string; host: Host; threads: number; collapsed: boolean;
}) {
  const to = `/e/${engagementId}/h/${h.id}`;
  const active = useMatch(to) !== null;
  return (
    <SidebarMenuItem>
      {/* Collapsed, the rail shows a short name: the full name and IP are in the tooltip, which keyboard focus opens too. */}
      <Tooltip
        side="right"
        disabled={!collapsed}
        content={
          <span className="grid">
            {h.name && <span>{h.name}</span>}
            {h.ip && <span className="font-mono text-code">{h.ip}</span>}
          </span>
        }
      >
        <SidebarMenuButton
          asChild
          size="lg"
          isActive={active}
          className={cx(
            "cursor-default",
            collapsed
              ? "grid grid-cols-[minmax(0,1fr)] justify-items-center gap-1"
              : "grid grid-cols-[16px_minmax(0,1fr)_auto] gap-2 px-2",
          )}
        >
          <NavLink to={to} title={collapsed ? undefined : h.name}>
            <HostGlyph column={h.boardColumn} />
            {collapsed ? (
              <>
                {/* The link's name: the host name, or its IP when it has none (the tooltip is not a name). */}
                <span className="sr-only">{h.name || h.ip}</span>
                <span aria-hidden className="font-mono text-meta">
                  {railName(h.name, h.ip)}
                </span>
              </>
            ) : (
              <>
                <span className="grid min-w-0 grid-cols-1">
                  <span className="truncate">{shortHostName(h.name)}</span>
                  {h.ip && <span className="truncate font-mono text-meta text-faint">{h.ip}</span>}
                </span>
                <ThreadDot count={threads} />
              </>
            )}
          </NavLink>
        </SidebarMenuButton>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/**
 * The engagement sidebar on shadcn's Sidebar (collapsible="icon"): 240px expanded, a 56px rail
 * collapsed (DESIGN.md Navigation). Collapsed state is persisted by useSidebarStore; ⌘B toggles.
 */
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
  const group = collapsed ? "px-1 py-0" : "px-3 py-0";

  return (
    <>
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(open) => open === collapsed && toggle()}
        className="relative h-full min-h-0 w-auto"
      >
        {/* In the shell's grid column, not fixed to the window: the gap div sizes the column, the panel fills it. */}
        <ShadSidebar collapsible="icon" className="absolute h-full border-sidebar-border">
          <nav aria-label="Engagement" className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
            <SidebarHeader
              className={cx(
                "grid items-center gap-0 pt-4 pb-2",
                collapsed ? "grid-cols-[28px] justify-center px-1" : "grid-cols-[minmax(0,1fr)_28px] px-3",
              )}
            >
              <h2 className={cx(heading, collapsed ? "sr-only" : "px-2")}>Engagement</h2>
              <IconButton
                icon={SidebarSimple}
                label={label}
                shortcut="⌘B"
                aria-expanded={!collapsed}
                onClick={toggle}
              />
            </SidebarHeader>
            <SidebarContent className="overflow-x-hidden pb-4 group-data-[collapsible=icon]:overflow-y-auto">
              {collapsed && <SidebarSeparator className="mx-auto mb-2 data-horizontal:w-6" />}
              <SidebarGroup className={group}>
                <SidebarMenu className={menu}>
                  {SECTIONS.map((s, i) => (
                    <SectionItem key={s.id} engagementId={engagementId} id={s.id} label={s.label} n={i + 1} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              {collapsed && <SidebarSeparator className="mx-auto my-2 data-horizontal:w-6" />}
              <SidebarGroup className={group}>
                {collapsed ? (
                  // Collapsed, the heading is for screen readers only: a plain sr-only heading, since the group label's
                  // own height and padding would outlast sr-only and leave a clipped sliver.
                  <h2 id={hostsId} className="sr-only">Hosts</h2>
                ) : (
                  <SidebarGroupLabel asChild className={cx(heading, "mt-4 h-auto px-2 pb-2")}>
                    <h2 id={hostsId}>Hosts</h2>
                  </SidebarGroupLabel>
                )}
                {hosts.isSuccess && list.length === 0 && !collapsed && (
                  <p aria-labelledby={hostsId} className="m-0 px-2 text-meta text-faint">
                    No hosts yet
                  </p>
                )}
                <SidebarMenu className={menu}>
                  {list.map((h) => (
                    <HostItem key={h.id} engagementId={engagementId} host={h} threads={threads.get(h.id) ?? 0} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
                <div className={cx("mt-1 grid", collapsed ? "justify-items-center" : "grid-cols-[16px] justify-items-center px-2")}>
                  <IconButton icon={Plus} label="Add host" onClick={() => setAdding(true)} />
                </div>
              </SidebarGroup>
            </SidebarContent>
          </nav>
        </ShadSidebar>
      </SidebarProvider>
      <HostDialog open={adding} onOpenChange={setAdding} engagementId={engagementId} />
    </>
  );
}
