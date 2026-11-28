/**
 * Editor tabs (design §2.1, docs/specs/terminal.md §8): the open pages of one engagement as a list of routes. The
 * active tab is the URL route; the list only remembers which pages are open and the route each was last on. A page is
 * open in at most one tab, so every route maps to a page key, and opening a page that has a tab focuses that tab.
 */

/** The reference pages that open as tabs inside an engagement and as full pages from the Dashboard. */
export type ReferencePage = "arsenal" | "manual" | "payloads";

/** The page a route shows. Its kind and id are all a tab needs: the label is read from the vault. */
export type TabPage =
  | { kind: "section"; section: string }
  | { kind: "host"; hostId: string }
  | { kind: "notes"; hostId: string | null }
  | { kind: "finding"; findingId: string }
  | { kind: "reference"; page: ReferencePage }
  | { kind: "log-entry" };

/** One open editor tab: its page's key, and the route it was last on (search and hash included, in memory only). */
export interface EditorTab {
  key: string;
  route: string;
}

const REFERENCES: readonly ReferencePage[] = ["arsenal", "manual", "payloads"];

/** The route's pathname: no search or hash. */
export function pathOf(route: string): string {
  const cut = route.search(/[?#]/);
  return cut === -1 ? route : route.slice(0, cut);
}

/** The engagement's own route for the board, its home page. */
export const boardRoute = (engagementId: string) => `/e/${engagementId}`;

/** The log entry tab's route ("New log entry", design §2.5): one per engagement, so one tab. */
export const logEntryRoute = (engagementId: string) => `/e/${engagementId}/log-entry`;

/** The log entry tab's page key. */
export const LOG_ENTRY_KEY = "log-entry";

/**
 * The page a route inside the engagement shows, or null for a route that is no page of it (another engagement's, or
 * one Raven doesn't know). An unknown section is the board, as `SectionRoute` shows it.
 */
export function pageOf(engagementId: string, route: string): TabPage | null {
  const base = boardRoute(engagementId);
  const path = pathOf(route).replace(/\/+$/, "");
  if (path === base) return { kind: "section", section: "board" };
  if (!path.startsWith(`${base}/`)) return null;
  const parts = path.slice(base.length + 1).split("/").map(decodePart);
  if (parts.some((p) => p === null || p === "")) return null;
  const [head, id, ...rest] = parts as string[];
  if (head === "s" && id && rest.length === 0) return { kind: "section", section: id };
  if (head === "h" && id && rest.length === 0) return { kind: "host", hostId: id };
  if (head === "f" && id && rest.length === 0) return { kind: "finding", findingId: id };
  if (head === "notes" && rest.length === 0) return { kind: "notes", hostId: id ?? null };
  if (head === "log-entry" && id === undefined) return { kind: "log-entry" };
  if (head && (REFERENCES as readonly string[]).includes(head)) {
    // The Manual keeps the note being read in its route (`manual/:noteId`); the others have no id.
    if (head === "manual" ? rest.length === 0 : id === undefined) return { kind: "reference", page: head as ReferencePage };
  }
  return null;
}

function decodePart(p: string): string | null {
  try {
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}

/** One key per page: two routes with the same key show the same page, so they share a tab. */
export function pageKey(page: TabPage): string {
  switch (page.kind) {
    case "section":
      return `s:${page.section}`;
    case "host":
      return `h:${page.hostId}`;
    case "notes":
      return page.hostId ? `notes:${page.hostId}` : "notes";
    case "finding":
      return `f:${page.findingId}`;
    case "reference":
      return page.page;
    case "log-entry":
      return LOG_ENTRY_KEY;
  }
}

/** The page key of a route, or null when it is no page of the engagement. */
export function routeKey(engagementId: string, route: string): string | null {
  const page = pageOf(engagementId, route);
  return page ? pageKey(page) : null;
}

/**
 * The host a route's page is about, which makes it Target (GLOSSARY): a host's page or a host's notes. Every other page
 * (a section, a finding, the engagement's notes, a reference page) has no host, so Target stays where it was.
 */
export function hostOfRoute(engagementId: string, route: string): string | null {
  const page = pageOf(engagementId, route);
  if (page?.kind === "host") return page.hostId;
  if (page?.kind === "notes") return page.hostId;
  return null;
}

/**
 * The tabs after `route` comes into view: its page's tab takes the route (focusing it), or a new tab opens at the end.
 * A route that is no page of the engagement leaves the list as it is.
 */
export function visit(engagementId: string, tabs: readonly EditorTab[], route: string): readonly EditorTab[] {
  const key = routeKey(engagementId, route);
  if (!key) return tabs;
  const at = tabs.findIndex((t) => t.key === key);
  if (at === -1) return [...tabs, { key, route }];
  if (tabs[at]!.route === route) return tabs;
  return tabs.map((t, i) => (i === at ? { key, route } : t));
}

/**
 * Closes the tab with `key`. When it was the active tab, `next` is the route to show: the tab to its right, else the
 * one to its left, else null (no tab is left: the caller shows the board, which opens again as the only tab).
 */
export function closeTab(
  tabs: readonly EditorTab[],
  key: string,
  activeKey: string | null,
): { tabs: readonly EditorTab[]; next: string | null } {
  const at = tabs.findIndex((t) => t.key === key);
  if (at === -1) return { tabs, next: null };
  const left = tabs.filter((_, i) => i !== at);
  if (key !== activeKey) return { tabs: left, next: null };
  const neighbour = tabs[at + 1] ?? tabs[at - 1];
  return { tabs: left, next: neighbour?.route ?? null };
}

/** The tabs with the given keys taken out (pages that no longer exist), order kept. */
export function dropTabs(tabs: readonly EditorTab[], gone: ReadonlySet<string>): readonly EditorTab[] {
  return gone.size === 0 || !tabs.some((t) => gone.has(t.key)) ? tabs : tabs.filter((t) => !gone.has(t.key));
}

/* What goes to disk */

/** What localStorage holds for one engagement: route ids only (pathnames), never a label, a search or a hash. */
interface StoredTabs {
  v: 1;
  tabs: string[];
  active: string | null;
}

/** The localStorage key for one engagement's open tabs. */
export const tabsStorageKey = (engagementId: string) => `raven.tabs.${engagementId}`;

/** The stored form: each tab's pathname, and the active one's. Search and hash stay in memory (they can hold typed text). */
export function storedForm(tabs: readonly EditorTab[], activeKey: string | null): string {
  const active = tabs.find((t) => t.key === activeKey);
  const out: StoredTabs = { v: 1, tabs: tabs.map((t) => pathOf(t.route)), active: active ? pathOf(active.route) : null };
  return JSON.stringify(out);
}

/**
 * Reads one engagement's stored tabs back. Anything that isn't a route of this engagement's pages is dropped, and so
 * is a second route to a page already listed; a value that doesn't parse gives no tabs.
 */
export function parseStored(engagementId: string, raw: string | null): { tabs: readonly EditorTab[]; active: string | null } {
  const none = { tabs: [], active: null };
  if (!raw) return none;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return none;
  }
  if (typeof data !== "object" || data === null) return none;
  const { tabs: list, active } = data as Partial<StoredTabs>;
  if (!Array.isArray(list)) return none;
  let tabs: readonly EditorTab[] = [];
  for (const r of list) if (typeof r === "string") tabs = visit(engagementId, tabs, pathOf(r));
  const activeRoute = typeof active === "string" ? pathOf(active) : null;
  const activeKey = activeRoute ? routeKey(engagementId, activeRoute) : null;
  const shown = tabs.find((t) => t.key === activeKey);
  return { tabs, active: shown?.route ?? null };
}
