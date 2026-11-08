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
    // 1px boxes are screen-reader-only text (sr-only), never seen.
    if (r.width <= 1 || r.height <= 1) return false;
    const s = style(el);
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

    // overflow (a popup, absolutely placed over the page, is meant to reach past its anchor: that is not overflow)
    const popupOnly = (): boolean => {
      const right = el.getBoundingClientRect().left + el.clientLeft + el.clientWidth + TOL;
      let popup = false;
      const walk = (node: Element): boolean => {
        for (const child of Array.from(node.children)) {
          const cs = style(child);
          const r = child.getBoundingClientRect();
          if (cs.position === "absolute" || cs.position === "fixed") {
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

  // overlap: two controls that visibly sit on each other. Judged on what shows: each rect is first clipped by its
  // scrolling or clipping ancestors (a strip label scrolled under its arrow shows nothing there), then the middle of the
  // overlap is hit-tested. A control under an opaque layer that is not the other control (a drawer or the stuck panel
  // over the page) is covered, not overlapping. Outside the viewport nothing can be hit-tested: geometry alone decides.
  type Box = { left: number; top: number; right: number; bottom: number };
  const clipped = new Map<Element, Box | null>();
  const shownBox = (el: Element): Box | null => {
    if (clipped.has(el)) return clipped.get(el)!;
    const r = el.getBoundingClientRect();
    let box: Box | null = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let anc = el.parentElement; anc && box && anc !== document.documentElement; anc = anc.parentElement) {
      const cs = style(anc);
      if (cs.position === "fixed") break;
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const ar = anc.getBoundingClientRect();
      box = { left: Math.max(box.left, ar.left), top: Math.max(box.top, ar.top), right: Math.min(box.right, ar.right), bottom: Math.min(box.bottom, ar.bottom) };
      if (box.right - box.left <= 0 || box.bottom - box.top <= 0) box = null;
    }
    clipped.set(el, box);
    return box;
  };
  const opaque = (el: Element): boolean => {
    const bg = style(el).backgroundColor;
    const m = /rgba?\(([^)]*)\)/.exec(bg);
    if (!m) return bg !== "transparent";
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0.5;
  };
  /** At (x, y): does `upper` sit directly on `lower`, with no opaque layer of its own between them? */
  const touches = (a: Element, b: Element, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true;
    const stack = document.elementsFromPoint(x, y);
    const ia = stack.findIndex((e) => a === e || a.contains(e));
    const ib = stack.findIndex((e) => b === e || b.contains(e));
    if (ia === -1 || ib === -1) return false;
    if (Math.min(ia, ib) !== 0 && !stack.slice(0, Math.min(ia, ib)).every((e) => e.contains(a) || e.contains(b) || !opaque(e))) return false;
    const [upper, lower, from, to] = ia < ib ? [a, b, ia, ib] : [b, a, ib, ia];
    return stack.slice(from, to).every((e) => upper.contains(e) || e.contains(lower) || !opaque(e));
  };
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i];
      const b = interactive[j];
      if (a.contains(b) || b.contains(a) || allowed(a, "overlap") || allowed(b, "overlap")) continue;
      const ra = shownBox(a);
      const rb = shownBox(b);
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
