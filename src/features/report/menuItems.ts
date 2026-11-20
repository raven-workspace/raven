import type { KeyboardEvent } from "react";

/** A text item in the report's small popover menus (tab menus, the block handle's ⋯ menu). */
export const MENU_ITEM =
  "grid h-7 items-center rounded-sm border-0 bg-transparent px-2 text-left text-body text-fg-2 outline-none hover:bg-surface-hi hover:text-fg focus-visible:bg-surface-hi focus-visible:text-fg";

/** ↑↓ walk a menu's items, wrapping. */
export function walkMenuItems(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}
