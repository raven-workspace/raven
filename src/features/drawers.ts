/**
 * Arsenal, Payloads and Notes share the right edge: one shows at a time, and the last one opened wins. Each store
 * registers itself here when its module loads, so a drawer that was never loaded can't be open.
 */
export type DrawerName = "arsenal" | "payloads" | "notes";

interface DrawerStore {
  getState(): { open: boolean; close(): void };
  subscribe(listener: (s: { open: boolean }) => void): () => void;
}

const drawers = new Map<DrawerName, DrawerStore>();

/** Adds a right-edge drawer: whenever it is open, every other open one closes. */
export function registerDrawer(name: DrawerName, store: DrawerStore): void {
  drawers.set(name, store);
  store.subscribe((s) => {
    if (!s.open) return;
    for (const [other, o] of drawers) if (other !== name && o.getState().open) o.getState().close();
  });
}

/** True while any right-edge drawer other than `except` is open. */
export function anyDrawerOpen(except?: DrawerName): boolean {
  for (const [name, store] of drawers) if (name !== except && store.getState().open) return true;
  return false;
}
