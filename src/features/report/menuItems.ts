import type { KeyboardEvent } from "react";
import "./menuItems.scss";

/** The report's small popover menus (tab menus, the block handle's ⋯ menu): the popover's own class. */
export const MENU = "report-menu";
/** A text item in one of them. */
export const MENU_ITEM = "report-menu__item";
/** A destructive item (Delete): amber on hover and keyboard focus. */
export const MENU_ITEM_DESTRUCTIVE = "report-menu__item report-menu__item--destructive";

/** ↑↓ walk a menu's items, wrapping. */
export function walkMenuItems(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}
