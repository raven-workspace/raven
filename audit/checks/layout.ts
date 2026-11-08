import type { RawIssue } from "../types";

/**
 * In-page layout checks. Passed to `page.evaluate`, so it must stay a single
 * self-contained function: no imports, no outer-scope references.
 */
export function collectLayoutIssues(): RawIssue[] {
  const TOL = 1;
  const issues: RawIssue[] = [];
  const INTERACTIVE =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"]';

  const style = (el: Element) => getComputedStyle(el);

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = style(el);
    // Screen-reader-only text (sr-only) is never seen: recognised by its pattern, not its size, so a box that collapsed
    // to 1px around real text is still judged.
    if (s.position === "absolute" && (s.clipPath === "inset(50%)" || /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(s.clip))) return false;
    return s.visibility !== "hidden" && parseFloat(s.opacity) > 0;
  };

  const implicitRole = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") ?? "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "button" || t === "submit") return "button";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return null;
  };

  const describe = (el: Element): string => {
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;
    const role = implicitRole(el);
    if (role) {
      const name =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (name && name.length <= 40) return `role=${role}[name="${name.replace(/"/g, '\\"')}"]`;
    }
    const chain: Element[] = [];
    for (let cur: Element | null = el; cur && chain.length < 4 && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
      chain.unshift(cur);
    }
    const parts = chain.map((c) => c.tagName.toLowerCase() + Array.from(c.classList).map((k) => "." + CSS.escape(k)).join(""));
    // Make the path unique: add :nth-of-type from the element upward until it is.
    for (let i = chain.length - 1; i >= 0 && document.querySelectorAll(parts.join(" > ")).length > 1; i--) {
      const sameTag = Array.from(chain[i].parentElement?.children ?? []).filter((x) => x.tagName === chain[i].tagName);
      if (sameTag.length > 1) parts[i] += `:nth-of-type(${sameTag.indexOf(chain[i]) + 1})`;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  };

  const add = (check: RawIssue["check"], el: Element | null, detail: string, selector?: string) => {
    issues.push({ check, selector: selector ?? (el ? describe(el) : "html"), detail });
  };

  /** An element (or an ancestor) opts out of one check with `data-audit-allow="<check> …"`; collectOptOuts lists them. */
  const allowed = (el: Element, check: RawIssue["check"]): boolean => {
    for (let a = el.closest("[data-audit-allow]"); a; a = a.parentElement?.closest("[data-audit-allow]") ?? null) {
      if ((a.getAttribute("data-audit-allow") ?? "").split(/\s+/).includes(check)) return true;
    }
    return false;
  };

  const hasOwnText = (el: Element): boolean =>
    Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");

  const ownText = (el: Element): string =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join(" ")
      .trim();

  // page-overflow
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + TOL) {
    add("page-overflow", null, `scrollWidth ${de.scrollWidth} > innerWidth ${window.innerWidth}`, "html");
  }

  const all = Array.from(document.body.querySelectorAll("*")).filter(isVisible);

  for (const el of all) {
    const s = style(el);
    const tag = el.tagName.toLowerCase();
    const allowTruncate = allowed(el, "truncated");
    const hasTitle = el.hasAttribute("title");
    let reportedTruncated = false;

    // truncated
    if (!allowTruncate && !hasTitle) {
      if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + TOL) {
        add("truncated", el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth} (ellipsis)`);
        reportedTruncated = true;
      } else {
        const clamp = s.getPropertyValue("-webkit-line-clamp");
        if (clamp && clamp !== "none" && el.scrollHeight > el.clientHeight + TOL) {
          add("truncated", el, `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} (line-clamp ${clamp})`);
          reportedTruncated = true;
        }
      }
    }

    // overflow. A popup (a listbox, menu, dialog or tooltip, absolutely placed) may reach past its anchor when nothing
    // clips it: that alone is not overflow. Anything else hanging out, or any popup cut off by a clipping box, is.
    const POPUP = '[role="listbox"], [role="menu"], [role="dialog"], [role="tooltip"], [data-radix-popper-content-wrapper]';
    const popupOnly = (): boolean => {
      if (s.overflowX !== "visible") return false;
      const right = el.getBoundingClientRect().left + el.clientLeft + el.clientWidth + TOL;
      let popup = false;
      const walk = (node: Element): boolean => {
        for (const child of Array.from(node.children)) {
          const cs = style(child);
          const r = child.getBoundingClientRect();
          if ((cs.position === "absolute" || cs.position === "fixed") && child.matches(POPUP)) {
            if (r.right > right) popup = true;
            continue;
          }
          if (r.width > 0 && r.right > right) return false;
          if (!walk(child)) return false;
        }
        return true;
      };
      return walk(el) && popup;
    };
    if (
      el.clientWidth > 0 &&
      (s.overflowX === "visible" || s.overflowX === "hidden") &&
      s.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + TOL &&
      !allowed(el, "overflow") &&
      !popupOnly()
    ) {
      add("overflow", el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    }

    // clipped (a line clamp is truncation on purpose: the truncated check judges it, titled or not)
    const clamp = s.getPropertyValue("-webkit-line-clamp");
    if (
      !reportedTruncated &&
      !(clamp && clamp !== "none") &&
      s.overflowY === "hidden" &&
      hasOwnText(el) &&
      el.scrollHeight > el.clientHeight + TOL &&
      !allowed(el, "clipped")
    ) {
      add("clipped", el, `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);
    }

    // squeezed
    const text = ownText(el);
    if (text.split(/\s+/).filter(Boolean).length >= 3) {
      const r = el.getBoundingClientRect();
      const fs = parseFloat(s.fontSize);
      const lh = s.lineHeight === "normal" ? fs * 1.2 : parseFloat(s.lineHeight);
      if (r.width < 80 && lh > 0 && r.height >= 3 * lh && !allowed(el, "squeezed")) {
        add("squeezed", el, `width ${Math.round(r.width)} < 80, height ${Math.round(r.height)} >= 3 x line-height ${Math.round(lh)}`);
      }
    }

    // oversized-control
    if (tag === "button" && el.parentElement) {
      const label = (el.textContent ?? "").trim();
      const pw = el.parentElement.getBoundingClientRect().width;
      const bw = el.getBoundingClientRect().width;
      if (label.length > 0 && label.length <= 12 && pw >= 400 && bw > pw * 0.4) {
        add("oversized-control", el, `button "${label}" width ${Math.round(bw)} > 40% of parent ${Math.round(pw)}`);
      }
    }

    // images
    if (el instanceof HTMLImageElement && el.naturalWidth > 0 && el.naturalHeight > 0) {
      const rw = el.clientWidth || el.getBoundingClientRect().width;
      const rh = el.clientHeight || el.getBoundingClientRect().height;
      const nat = el.naturalWidth / el.naturalHeight;
      const ren = rw / rh;
      if (Math.abs(ren - nat) / nat > 0.02) {
        const detail = `natural ${el.naturalWidth}×${el.naturalHeight} (${nat.toFixed(2)}) rendered ${Math.round(rw)}×${Math.round(rh)} (${ren.toFixed(2)})`;
        if (s.objectFit === "fill" || s.objectFit === "scale-down" || s.objectFit === "contain") add("image-distorted", el, detail);
        else if (s.objectFit === "cover") add("image-cropped", el, detail);
      }
    }
  }

  // offscreen
  const interactive = Array.from(document.body.querySelectorAll(INTERACTIVE)).filter(isVisible);
  for (const el of interactive) {
    if (allowed(el, "offscreen")) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -TOL || r.right > window.innerWidth + TOL) {
      add("offscreen", el, `rect ${Math.round(r.left)}..${Math.round(r.right)} outside viewport 0..${window.innerWidth}`);
      continue;
    }
    let anc = el.parentElement;
    while (anc && anc !== document.body && anc !== document.documentElement) {
      const ox = style(anc).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
        const ar = anc.getBoundingClientRect();
        if (r.left < ar.left - TOL || r.right > ar.right + TOL) {
          add("offscreen", el, `rect ${Math.round(r.left)}..${Math.round(r.right)} outside scroll parent ${Math.round(ar.left)}..${Math.round(ar.right)}`);
        }
        break;
      }
      anc = anc.parentElement;
    }
  }

  // overlap: two controls that sit on each other.
  // - Two controls in the same scroll container are compared by plain geometry, scrolled into view or not.
  // - In different containers, each rect is first clipped by the clipping ancestors the other one is not inside (a strip
  //   label scrolled under its arrow shows nothing there).
  // - Inside the viewport the middle of the overlap is hit-tested. Only a real overlay covers: the lower control is
  //   aria-hidden or inert (a Radix modal hides the page), or a fixed or sticky layer, or a dialog, menu, listbox or
  //   tooltip, sits over it. A control that can't be hit (pointer-events: none) is judged by geometry.
  type Box = { left: number; top: number; right: number; bottom: number };
  const clipsX = (e: Element) => {
    const cs = style(e);
    return cs.overflowX !== "visible" || cs.overflowY !== "visible";
  };
  const scroller = (e: Element): Element | null => {
    for (let anc = e.parentElement; anc && anc !== document.documentElement; anc = anc.parentElement) {
      if (style(anc).position === "fixed") return anc;
      if (clipsX(anc)) return anc;
    }
    return null;
  };
  const clippedBox = (el: Element, other: Element | null): Box | null => {
    const r = el.getBoundingClientRect();
    let box: Box | null = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let anc = el.parentElement; anc && box && anc !== document.documentElement; anc = anc.parentElement) {
      if (other && anc.contains(other)) break;
      if (style(anc).position === "fixed") break;
      if (!clipsX(anc)) continue;
      const ar = anc.getBoundingClientRect();
      box = { left: Math.max(box.left, ar.left), top: Math.max(box.top, ar.top), right: Math.min(box.right, ar.right), bottom: Math.min(box.bottom, ar.bottom) };
      if (box.right - box.left <= 0 || box.bottom - box.top <= 0) box = null;
    }
    return box;
  };
  const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper]';
  const isOverlay = (e: Element): boolean => {
    if (e.closest(OVERLAY)) return true;
    for (let cur: Element | null = e; cur && cur !== document.body; cur = cur.parentElement) {
      const pos = style(cur).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  };
  /** At (x, y): are both controls there, without a real overlay hiding the lower one? */
  const touches = (a: Element, b: Element, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true;
    // Hit-testing only says something where both controls are on screen; scrolled out of their pane, geometry decides.
    const on = (e: Element) => {
      const v = clippedBox(e, null);
      return v !== null && x >= v.left && x <= v.right && y >= v.top && y <= v.bottom;
    };
    if (!on(a) || !on(b)) return true;
    // Behind an open modal (Radix hides the rest of the page with aria-hidden and pointer-events: none): covered.
    if (isHidden(a) || isHidden(b)) return false;
    const stack = document.elementsFromPoint(x, y);
    const ia = stack.findIndex((e) => a === e || a.contains(e));
    const ib = stack.findIndex((e) => b === e || b.contains(e));
    // A control that ignores the pointer (pointer-events: none) is not in the stack: geometry decides. One that takes the
    // pointer but isn't there is hidden under something (a modal's backdrop): not touching.
    const unhit = (e: Element, i: number) => i === -1 && style(e).pointerEvents !== "none";
    if (unhit(a, ia) || unhit(b, ib)) return false;
    if (ia === -1 || ib === -1) return true;
    const [upper, lower, to] = ia < ib ? [a, b, ib] : [b, a, ia];
    const between = stack.slice(0, to).filter((e) => !upper.contains(e) && !lower.contains(e) && !e.contains(lower));
    // The upper control's own overlay (it sits in a drawer or dialog the lower one is not in) covers the lower one.
    const upperLayer = between.some((e) => e.contains(upper) && isOverlay(e));
    return !upperLayer && !between.some((e) => !e.contains(upper) && isOverlay(e));
  };
  const isHidden = (e: Element) => e.closest('[aria-hidden="true"], [inert]') !== null;
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i];
      const b = interactive[j];
      if (a.contains(b) || b.contains(a) || allowed(a, "overlap") || allowed(b, "overlap")) continue;
      let ra: Box | null;
      let rb: Box | null;
      if (scroller(a) === scroller(b)) {
        const x = a.getBoundingClientRect();
        const y = b.getBoundingClientRect();
        ra = { left: x.left, top: x.top, right: x.right, bottom: x.bottom };
        rb = { left: y.left, top: y.top, right: y.right, bottom: y.bottom };
      } else {
        ra = clippedBox(a, b);
        rb = clippedBox(b, a);
      }
      if (!ra || !rb) continue;
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix <= 4 || iy <= 4) continue;
      const x = Math.max(ra.left, rb.left) + ix / 2;
      const y = Math.max(ra.top, rb.top) + iy / 2;
      if (touches(a, b, x, y)) add("overlap", a, `overlaps ${describe(b)} by ${Math.round(ix)}×${Math.round(iy)}`);
    }
  }

  // mid-token-wrap
  let budget = 300;
  const seenText = new Set<Node>();
  for (const host of Array.from(document.body.querySelectorAll("code, pre, kbd, [data-command]"))) {
    if (budget <= 0) break;
    if (!isVisible(host) || allowed(host, "mid-token-wrap")) continue;
    let reported = false;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && budget > 0 && !reported; n = walker.nextNode()) {
      if (seenText.has(n)) continue;
      seenText.add(n);
      const value = n.textContent ?? "";
      for (const m of value.matchAll(/\S+/g)) {
        if (budget <= 0) break;
        if (m[0].length > 40) continue;
        budget--;
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        if (tops.size > 1) {
          add("mid-token-wrap", host, `token "${m[0]}" wraps across ${tops.size} lines`);
          reported = true;
          break;
        }
      }
    }
  }

  // narrow-wrap: a text block squeezed into a sliver, so it stacks a few characters per line
  for (const el of all) {
    if (el.closest("pre, code") || allowed(el, "narrow-wrap")) continue;
    const text = ownText(el).replace(/\s+/g, " ");
    if (text.length < 4) continue;
    const range = document.createRange();
    const tops = new Set<number>();
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim() === "") continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0) tops.add(Math.round(r.top));
    }
    if (tops.size >= 4 && text.length / tops.size <= 6) {
      add("narrow-wrap", el, `${text.length} characters over ${tops.size} lines (${(text.length / tops.size).toFixed(1)} per line), width ${Math.round(el.getBoundingClientRect().width)}`);
    }
  }

  return issues;
}
