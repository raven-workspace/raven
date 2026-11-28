import { create } from "zustand";
import { closeTab, dropTabs, parseStored, routeKey, storedForm, tabsStorageKey, visit, type EditorTab } from "../../engines/tabs";

interface EditorTabsState {
  /** Each engagement's open tabs, in memory: routes with their search and hash. Cleared on lock. */
  byEngagement: Record<string, readonly EditorTab[]>;
  /**
   * Loads an engagement's stored tabs when memory has none yet (the first visit since unlock), and says which route
   * was active when it was left, if that tab is still open.
   */
  restore: (engagementId: string) => string | null;
  /** The route came into view: its page's tab takes it, or opens at the end. */
  visit: (engagementId: string, route: string) => void;
  /** Closes the tab with `key`; when it was active (`route` is the route in view), returns the route to show next. */
  close: (engagementId: string, key: string, route: string) => string | null;
  /** Takes out the tabs of pages that are gone (a deleted host or finding). */
  drop: (engagementId: string, keys: ReadonlySet<string>) => void;
  /** A deleted engagement's tabs go, from memory and from disk. */
  forget: (engagementId: string) => void;
  reset: () => void;
}

/** The engagement's last active route per engagement, so a return to it shows what was in view (memory only). */
const lastActive = new Map<string, string>();

/** Only route ids reach disk (pathnames: no labels, searches or hashes), and a storage failure only costs the restore. */
function save(engagementId: string, tabs: readonly EditorTab[]) {
  try {
    const active = lastActive.get(engagementId);
    localStorage.setItem(tabsStorageKey(engagementId), storedForm(tabs, active ? routeKey(engagementId, active) : null));
  } catch {
    /* private mode or a full disk: the tabs still work for this session */
  }
}

function load(engagementId: string): string | null {
  try {
    return localStorage.getItem(tabsStorageKey(engagementId));
  } catch {
    return null;
  }
}

/**
 * The editor tabs of each engagement (design §2.1). The route in view is always the active tab: the workspace shell
 * reports each route with `visit`, and the tab list only shows and closes what it holds.
 */
export const useEditorTabsStore = create<EditorTabsState>()((set, get) => ({
  byEngagement: {},
  restore: (engagementId) => {
    if (get().byEngagement[engagementId]) return lastActive.get(engagementId) ?? null;
    const { tabs, active } = parseStored(engagementId, load(engagementId));
    set((s) => ({ byEngagement: { ...s.byEngagement, [engagementId]: tabs } }));
    return active;
  },
  visit: (engagementId, route) => {
    const before = get().byEngagement[engagementId] ?? [];
    const tabs = visit(engagementId, before, route);
    if (!routeKey(engagementId, route)) return;
    lastActive.set(engagementId, route);
    if (tabs !== before) set((s) => ({ byEngagement: { ...s.byEngagement, [engagementId]: tabs } }));
    save(engagementId, tabs);
  },
  close: (engagementId, key, route) => {
    const before = get().byEngagement[engagementId] ?? [];
    const { tabs, next } = closeTab(before, key, routeKey(engagementId, route));
    if (tabs === before) return null;
    set((s) => ({ byEngagement: { ...s.byEngagement, [engagementId]: tabs } }));
    save(engagementId, tabs);
    return next;
  },
  drop: (engagementId, keys) => {
    const before = get().byEngagement[engagementId] ?? [];
    const tabs = dropTabs(before, keys);
    if (tabs === before) return;
    set((s) => ({ byEngagement: { ...s.byEngagement, [engagementId]: tabs } }));
    save(engagementId, tabs);
  },
  forget: (engagementId) => {
    lastActive.delete(engagementId);
    try {
      localStorage.removeItem(tabsStorageKey(engagementId));
    } catch {
      /* nothing stored, or storage unavailable */
    }
    set((s) => {
      const byEngagement = { ...s.byEngagement };
      delete byEngagement[engagementId];
      return { byEngagement };
    });
  },
  reset: () => {
    lastActive.clear();
    set({ byEngagement: {} });
  },
}));
