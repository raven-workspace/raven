import { create } from "zustand";

export const SIDEBAR_KEY = "raven.sidebar.collapsed";
/** Below this window width the sidebar starts collapsed, when nothing is stored. */
export const NARROW_BREAKPOINT = 1000;

function initialCollapsed(): boolean {
  const v = localStorage.getItem(SIDEBAR_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return window.innerWidth < NARROW_BREAKPOINT;
}

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>()((set, get) => ({
  collapsed: initialCollapsed(),
  toggle: () => {
    const collapsed = !get().collapsed;
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
}));
