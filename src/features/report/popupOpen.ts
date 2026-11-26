/** Whether a menu, a list or a Radix popover is open: Esc closes that first. ProseKit keeps its closed menus and
 *  lists in the DOM, marked closed. A tooltip (a popper wrapper holding `role="tooltip"`) is no popup: Esc goes on to
 *  what is behind it while one shows. */
export const popupOpen = () =>
  document.querySelector(':is([role="menu"], [role="listbox"]):not([data-state="closed"], [hidden])') !== null ||
  [...document.querySelectorAll("[data-radix-popper-content-wrapper]")].some((w) => w.querySelector('[role="tooltip"]') === null);
