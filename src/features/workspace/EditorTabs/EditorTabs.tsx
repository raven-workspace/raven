import { X } from "@phosphor-icons/react";
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { boardRoute, pageOf, routeKey, type EditorTab, type TabPage } from "../../../engines/tabs";
import { isDialogOpen, useKeydown } from "../../../lib/keys";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";
import { IconButton } from "../../../ui/index";
import { TabMarker } from "../../../ui/TabMarker";
import { useEngagement } from "../../engagements/queries";
import { SECTIONS } from "../../engagements/sections/sections";
import { useFindings } from "../../findings/queries";
import { useHosts } from "../../hosts/queries";
import { useEditorTabsStore } from "../useEditorTabsStore";
import "./EditorTabs.scss";

const NO_TABS: readonly EditorTab[] = [];

/** The editor area's id: each tab controls it. */
export const EDITOR_PANEL_ID = "editor-panel";
export const tabId = (key: string) => `editor-tab-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The marker follows the whole tab (label and close button), not only the tab role inside it. */
const FOLLOW = { selected: '.editor-tabs__tab[data-selected="true"]', items: ".editor-tabs__tab", attributes: ["data-selected"] };

const REFERENCE_LABELS = { arsenal: "Arsenal", manual: "Manual", payloads: "Payloads" } as const;

/**
 * Each tab's label, read from the vault (never from storage): the host's name, "Notes: " and the host's name (or the
 * engagement's), the finding's title, the section's name. Until the vault answers, the kind of page stands in.
 */
function useLabels(engagementId: string) {
  const engagement = useEngagement(engagementId).data;
  const hosts = useHosts(engagementId);
  const findings = useFindings(engagementId);
  const hostName = (id: string) => hosts.data?.find((h) => h.id === id)?.name;
  const label = (page: TabPage | null): string => {
    if (!page) return "Page";
    switch (page.kind) {
      case "section":
        return SECTIONS.find((s) => s.id === page.section)?.label ?? "Board";
      case "host":
        return hostName(page.hostId) ?? "Host";
      case "notes": {
        const name = page.hostId ? hostName(page.hostId) : engagement?.name;
        return name ? `Notes: ${name}` : "Notes";
      }
      case "finding":
        return findings.data?.find((f) => f.id === page.findingId)?.title ?? "Finding";
      case "reference":
        return REFERENCE_LABELS[page.page];
      case "log-entry":
        return "New log entry";
    }
  };
  return { label, hosts, findings };
}

/**
 * The editor tabs (design §2.1): one tab per open page, the selected one marked with the accent underline that glides
 * 180ms. Selecting a tab shows its page at the route it was last on; the close button or ⌘W closes it. The tab list is
 * the routes the owner opened; the route in view is always its selected tab.
 */
export function EditorTabs({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = `${location.pathname}${location.search}${location.hash}`;
  const activeKey = routeKey(engagementId, route);
  const tabs = useEditorTabsStore((s) => s.byEngagement[engagementId]) ?? NO_TABS;
  const { label, hosts, findings } = useLabels(engagementId);

  // A host or finding deleted (or gone with a restore) closes its tab. Only from a settled list, so a page just
  // created isn't dropped before the list has it, and never the tab in view: its own page says it's gone.
  const hostsSettled = hosts.isSuccess && !hosts.isFetching ? hosts.data : null;
  const findingsSettled = findings.isSuccess && !findings.isFetching ? findings.data : null;
  useEffect(() => {
    const gone = new Set<string>();
    for (const t of tabs) {
      if (t.key === activeKey) continue;
      const page = pageOf(engagementId, t.route);
      const hostId = page?.kind === "host" || page?.kind === "notes" ? page.hostId : null;
      if (hostId && hostsSettled && !hostsSettled.some((h) => h.id === hostId)) gone.add(t.key);
      if (page?.kind === "finding" && findingsSettled && !findingsSettled.some((f) => f.id === page.findingId)) gone.add(t.key);
    }
    useEditorTabsStore.getState().drop(engagementId, gone);
  }, [tabs, activeKey, engagementId, hostsSettled, findingsSettled]);

  const close = (key: string) => {
    const next = useEditorTabsStore.getState().close(engagementId, key, route);
    // With no tab left, the board opens as the only one.
    if (key === activeKey) void navigate(next ?? boardRoute(engagementId));
  };

  // ⌘W closes the tab in view, from anywhere in the engagement but a dialog.
  useKeydown((e) => {
    if (!matches(SHORTCUTS.closeTab, e) || e.defaultPrevented || isDialogOpen() || !activeKey) return;
    e.preventDefault();
    close(activeKey);
  });

  // Arrows move between tabs and show each (the tabs pattern with automatic activation); Home and End go to the ends.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !(e.target as HTMLElement).matches('[role="tab"]')) return;
    const at = tabs.findIndex((t) => t.key === activeKey);
    const to =
      e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const tab = tabs[Math.max(0, Math.min(tabs.length - 1, to))];
    if (!tab) return;
    void navigate(tab.route);
    requestAnimationFrame(() => document.getElementById(tabId(tab.key))?.focus());
  };

  return (
    <div role="tablist" aria-label="Open editors" className="editor-tabs" onKeyDown={onKeyDown}>
      <TabMarker className="editor-tabs__marker" follow={FOLLOW} />
      {tabs.map((t) => {
        const on = t.key === activeKey;
        const name = label(pageOf(engagementId, t.route));
        return (
          <div key={t.key} data-selected={on ? "true" : "false"} className="editor-tabs__tab">
            <button
              type="button"
              role="tab"
              id={tabId(t.key)}
              aria-selected={on}
              aria-controls={EDITOR_PANEL_ID}
              tabIndex={on ? 0 : -1}
              title={name}
              onClick={() => on || void navigate(t.route)}
              className="editor-tabs__label"
            >
              {name}
            </button>
            {/* ⌘W is the key; the button stays out of the Tab order so the list is one stop. */}
            <IconButton icon={X} label="Close tab" shortcut={SHORTCUTS.closeTab} tabIndex={-1} onClick={() => close(t.key)} />
          </div>
        );
      })}
    </div>
  );
}
