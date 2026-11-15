/**
 * A frozen picture of the app for the lock's reverse sweep to close over. The live app (and its data) is gone the
 * moment Raven locks; this inert DOM copy is what shows through the closing ring, for well under a second.
 */
export interface FrozenCopy {
  el: HTMLElement;
  /** Call once the copy is in the document: a clone starts scrolled to the top, so carry the scroll positions over. */
  restoreScroll: () => void;
}

export function freezeCopy(source: HTMLElement): FrozenCopy {
  const el = source.cloneNode(true) as HTMLElement;
  const from = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const to = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const scrolled: [HTMLElement, number, number][] = [];
  from.forEach((f, i) => {
    const t = to[i];
    if (t && (f.scrollTop || f.scrollLeft)) scrolled.push([t, f.scrollTop, f.scrollLeft]);
  });
  // No duplicate ids or focus targets next to the unlock form.
  for (const t of to) {
    t.removeAttribute("id");
    t.removeAttribute("autofocus");
  }
  el.setAttribute("inert", "");
  el.setAttribute("aria-hidden", "true");
  return {
    el,
    restoreScroll: () => {
      for (const [t, top, left] of scrolled) {
        t.scrollTop = top;
        t.scrollLeft = left;
      }
    },
  };
}
