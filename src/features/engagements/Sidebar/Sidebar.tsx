import {
  Key,
  ListBullets,
  ListChecks,
  FileText,
  Flag,
  Plus,
  Kanban,
  ShareNetwork,
  SidebarSimple,
  type Icon,
} from "@phosphor-icons/react";
import { useId, useState } from "react";
import { NavLink, useMatch } from "react-router";
import { cx } from "../../../lib/cx";
import { shortHostName } from "../../../lib/hostName";
import { IconButton, Tooltip } from "../../../ui/index";
import { TabMarker } from "../../../ui/TabMarker";
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
} from "../../../ui/shadcn/sidebar";
import { isDialogOpen, useKeydown } from "../../../lib/keys";
import type { Host } from "../../../types/host";
import { HostDialog } from "../../hosts/HostDialog/HostDialog";
import { HostGlyph } from "../../hosts/HostGlyph/HostGlyph";
import { useHosts } from "../../hosts/queries";
import { ThreadDot } from "../../notes/ThreadDot/ThreadDot";
import { useThreadCounts } from "../../notes/useThreadCounts";
import { SECTIONS, sectionPath, type SectionId } from "../sections/sections";
import { useSidebarStore } from "../useSidebarStore";
import "./Sidebar.scss";

const SECTION_ICONS: Record<SectionId, Icon> = {
  board: Kanban,
  log: ListBullets,
  credentials: Key,
  findings: Flag,
  network: ShareNetwork,
  checklist: ListChecks,
  report: FileText,
};

const LAST_OCTET = /(\d{1,3})$/;

/**
 * The current section or host is lit by one marker for the whole sidebar (surface and accent bar) that slides from
 * item to item, sections and hosts alike; the links themselves draw no active background, even on hover.
 */
const ACTIVE_MARK = "engagement-sidebar__marker";
const FOLLOW_ACTIVE = { selected: '[data-sidebar="menu-button"][data-active="true"]', items: '[data-sidebar="menu-button"]', attributes: ["data-active"] };

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
            <span className="engagement-sidebar__key">{n}</span>
          </>
        }
      >
        <SidebarMenuButton
          asChild
          isActive={active}
          className={cx("engagement-sidebar__link", !collapsed && "engagement-sidebar__section-row")}
        >
          <NavLink to={to} end aria-label={collapsed ? label : undefined}>
            <SectionIcon aria-hidden />
            {!collapsed && (
              <>
                <span>{label}</span>
                <span aria-hidden className="engagement-sidebar__count">
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
          <span className="engagement-sidebar__host-tip">
            {h.name && <span>{h.name}</span>}
            {h.ip && <span className="engagement-sidebar__host-tip-ip">{h.ip}</span>}
          </span>
        }
      >
        <SidebarMenuButton
          asChild
          size="lg"
          isActive={active}
          className={cx("engagement-sidebar__link", collapsed ? "engagement-sidebar__host-row--rail" : "engagement-sidebar__host-row")}
        >
          <NavLink to={to} title={collapsed ? undefined : h.name}>
            <HostGlyph column={h.boardColumn} />
            {collapsed ? (
              <>
                {/* The link's name: the host name, or its IP when it has none (the tooltip is not a name). */}
                <span className="engagement-sidebar__sr-only">{h.name || h.ip}</span>
                <span aria-hidden className="engagement-sidebar__rail-name">
                  {railName(h.name, h.ip)}
                </span>
                {/* Pinned to the glyph's corner so the rail's 56px column keeps its layout. */}
                {threads > 0 && (
                  <span className="engagement-sidebar__rail-dot">
                    <ThreadDot count={threads} />
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="engagement-sidebar__host-text">
                  <span className="engagement-sidebar__host-name">{shortHostName(h.name)}</span>
                  {h.ip && <span className="engagement-sidebar__host-ip">{h.ip}</span>}
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
  // Both menus centre their items on the rail, so section boxes and host glyphs share one centre line.
  const rail = (block: string) => cx(block, collapsed && `${block}--rail`);

  return (
    <>
      <SidebarProvider open={!collapsed}>
        <ShadSidebar>
          <nav aria-label="Engagement" className="engagement-sidebar__nav">
            <SidebarHeader className={rail("engagement-sidebar__header")}>
              <h2 className={cx("engagement-sidebar__heading", collapsed && "engagement-sidebar__sr-only")}>Engagement</h2>
              <IconButton
                icon={SidebarSimple}
                label={label}
                shortcut="⌘B"
                aria-expanded={!collapsed}
                onClick={toggle}
              />
            </SidebarHeader>
            <SidebarContent className="engagement-sidebar__content">
              <TabMarker className={ACTIVE_MARK} follow={FOLLOW_ACTIVE} />
              {collapsed && <SidebarSeparator className="engagement-sidebar__rule engagement-sidebar__rule--first" />}
              <SidebarGroup className={rail("engagement-sidebar__group")}>
                <SidebarMenu className={rail("engagement-sidebar__menu")}>
                  {SECTIONS.map((s, i) => (
                    <SectionItem key={s.id} engagementId={engagementId} id={s.id} label={s.label} n={i + 1} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
              {collapsed && <SidebarSeparator className="engagement-sidebar__rule engagement-sidebar__rule--between" />}
              <SidebarGroup className={rail("engagement-sidebar__group")}>
                {collapsed ? (
                  // Collapsed, the heading is for screen readers only: a plain sr-only heading, since the group label's
                  // own height and padding would outlast sr-only and leave a clipped sliver.
                  <h2 id={hostsId} className="engagement-sidebar__sr-only">Hosts</h2>
                ) : (
                  <SidebarGroupLabel asChild className="engagement-sidebar__group-label">
                    <h2 id={hostsId}>Hosts</h2>
                  </SidebarGroupLabel>
                )}
                {hosts.isSuccess && list.length === 0 && !collapsed && (
                  <p aria-labelledby={hostsId} className="engagement-sidebar__empty">
                    No hosts yet
                  </p>
                )}
                <SidebarMenu className={rail("engagement-sidebar__menu")}>
                  {list.map((h) => (
                    <HostItem key={h.id} engagementId={engagementId} host={h} threads={threads.get(h.id) ?? 0} collapsed={collapsed} />
                  ))}
                </SidebarMenu>
                <div className={cx("engagement-sidebar__add", !collapsed && "engagement-sidebar__add--expanded")}>
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
