/**
 * Scroll `scroller` (and only it) so `row` is fully visible below `topInset` px of sticky header.
 * Element.scrollIntoView also scrolls every overflow:hidden ancestor (the resizable panels), which shifts the whole page layout.
 */
export function revealRow(scroller: HTMLElement, row: Element, topInset = 0) {
  const box = scroller.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const top = r.top - (box.top + topInset);
  const bottom = r.bottom - (box.top + scroller.clientHeight);
  if (top < 0) scroller.scrollTop += top;
  else if (bottom > 0) scroller.scrollTop += Math.min(bottom, top);
}
