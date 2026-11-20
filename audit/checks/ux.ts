import type { RawIssue } from "../types";

/**
 * In-page static UX checks (hierarchy, spacing, targets, noise, motion).
 * Passed to `page.evaluate`, so it must stay a single self-contained function:
 * no imports, no outer-scope references. Raven's font is JetBrains Mono, so
 * 1ch = 0.6 x font-size. "Viewport" means the first 900px of height.
 */
export function collectUxIssues(): RawIssue[] {
  const VIEW_H = 900;
  const issues: RawIssue[] = [];
  const INTERACTIVE =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"]';
  const COMMAND_BLOCK = "pre, code, [data-command]";

  const style = (el: Element) => getComputedStyle(el);

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
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
    for (let i = chain.length - 1; i >= 0 && document.querySelectorAll(parts.join(" > ")).length > 1; i--) {
      const sameTag = Array.from(chain[i].parentElement?.children ?? []).filter((x) => x.tagName === chain[i].tagName);
      if (sameTag.length > 1) parts[i] += `:nth-of-type(${sameTag.indexOf(chain[i]) + 1})`;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  };

  const add = (check: RawIssue["check"], el: Element | null, detail: string, selector?: string) => {
    issues.push({ check, selector: selector ?? (el ? describe(el) : "html"), detail });
  };

  const ownText = (el: Element): string =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  /** An element (or an ancestor) opts out of one check with `data-audit-allow="<check> …"`; collectOptOuts lists them. */
  const allowed = (el: Element, check: RawIssue["check"]): boolean => {
    for (let a = el.closest("[data-audit-allow]"); a; a = a.parentElement?.closest("[data-audit-allow]") ?? null) {
      if ((a.getAttribute("data-audit-allow") ?? "").split(/\s+/).includes(check)) return true;
    }
    return false;
  };

  const px = (v: number) => `${Math.round(v * 10) / 10}px`;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  const all = Array.from(document.body.querySelectorAll("*")).filter((el) => !SKIP_TAGS.has(el.tagName) && isVisible(el));

  // Elements inside an open dialog are judged against the dialog only.
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).pop() ?? null;
  const inViewport = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.top < VIEW_H && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  };
  const scoped = all.filter((el) => inViewport(el) && (dialog === null || dialog.contains(el)));

  // hierarchy-flat
  const isHeadingTag = (el: Element) => /^h[1-6]$/.test(el.tagName.toLowerCase()) || el.getAttribute("role") === "heading";
  const inControl = (el: Element) => el.closest(`${INTERACTIVE}, th, td, label, summary, option`) !== null;
  const weightOf = (el: Element) => parseInt(style(el).fontWeight, 10) || 400;
  const isHeadingLike = (el: Element): boolean => {
    if (inControl(el)) return false;
    if (isHeadingTag(el)) return true;
    const s = style(el);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return weightOf(el) >= 600 && !s.display.startsWith("inline") && text.length > 0 && text.length <= 60;
  };
  const firstTextBlock = (root: Element): Element | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n: Node | null = root; n; n = walker.nextNode()) {
      const e = n as Element;
      if (!SKIP_TAGS.has(e.tagName) && ownText(e) !== "" && isVisible(e)) return e;
    }
    return null;
  };
  for (const el of all) {
    if (!isHeadingLike(el)) continue;
    let body: Element | null = null;
    for (let sib = el.nextElementSibling; sib && !body; sib = sib.nextElementSibling) {
      if (!isVisible(sib)) continue;
      body = firstTextBlock(sib);
    }
    if (!body || isHeadingTag(body) || inControl(body) || weightOf(body) >= 600) continue;
    const hs = style(el);
    const bs = style(body);
    const hFs = parseFloat(hs.fontSize);
    const bFs = parseFloat(bs.fontSize);
    const hW = weightOf(el);
    const bW = weightOf(body);
    if (hFs < 1.1 * bFs && Math.abs(hW - bW) < 200 && hs.color === bs.color) {
      add("hierarchy-flat", el, `heading ${hFs}px/${hW} vs body ${bFs}px/${bW}, same color`);
    }
  }

  // tight-stack
  const isCommandBlock = (el: Element): boolean =>
    isVisible(el) &&
    (el.matches("[data-command]") || el.tagName === "PRE" || (el.tagName === "CODE" && style(el).display === "block"));
  for (const el of Array.from(document.body.querySelectorAll(COMMAND_BLOCK))) {
    const next = el.nextElementSibling;
    if (!next || !isCommandBlock(el) || !isCommandBlock(next)) continue;
    const gap = next.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
    if (gap < 8) add("tight-stack", el, `${px(gap)} gap before the next command block ${describe(next)}, needs >= 8px`);
  }

  // off-scale-spacing (one issue per screen)
  const SPACING_PROPS = [
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "gap", "row-gap", "column-gap",
  ];
  const spacingValue = (el: Element, prop: string): number | null => {
    const map = (el as Element & { computedStyleMap?: () => StylePropertyMapReadOnly }).computedStyleMap?.();
    const raw = map?.get(prop);
    if (raw instanceof CSSKeywordValue) return null; // auto / normal
    if (raw instanceof CSSUnitValue && raw.unit === "percent") return null;
    const v = parseFloat(style(el).getPropertyValue(prop));
    return Number.isFinite(v) ? v : null;
  };
  const offScale = new Map<string, number>();
  for (const el of all) {
    for (const prop of SPACING_PROPS) {
      const v = spacingValue(el, prop);
      if (v === null || Math.abs(v) <= 1) continue;
      if (Math.abs(v / 2 - Math.round(v / 2)) > 0.001) {
        const key = px(v);
        offScale.set(key, (offScale.get(key) ?? 0) + 1);
      }
    }
  }
  if (offScale.size > 0) {
    const top = Array.from(offScale.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    add("off-scale-spacing", null, `${offScale.size} off-scale values; most frequent: ${top.map(([k, n]) => `${k} x${n}`).join(", ")}`, "(page)");
  }

  // tiny-text: nothing under 12px; only the label role (section labels and chips, `.section-label`) and key caps may be 12px.
  for (const el of all) {
    if (ownText(el) === "" || allowed(el, "tiny-text")) continue;
    const fs = parseFloat(style(el).fontSize);
    const twelveOk = el.closest("kbd, .section-label, .chip, .report-tab__state, .engagement-sidebar__heading, .sidebar-group-label, .data-table__head") !== null;
    const floor = twelveOk ? 12 : 13;
    if (fs < floor - 0.01) {
      add("tiny-text", el, `font-size ${fs}px < ${floor}px${twelveOk ? "" : " (12px is only for labels, chips and key caps)"}: "${ownText(el).slice(0, 40)}"`);
    }
  }

  // long-lines
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    const textBlock = tag === "p" || tag === "li" || el.getAttribute("role") === "note" || (tag === "div" && ownText(el) !== "");
    if (!textBlock || el.closest(COMMAND_BLOCK)) continue;
    const s = style(el);
    const fs = parseFloat(s.fontSize);
    const content = el.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    const ch = content / (0.6 * fs);
    // A line cannot be longer than its text, so short text in a wide box is fine.
    const chars = (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
    if (ch > 100 && chars > 100 && !allowed(el, "long-lines")) add("long-lines", el, `${Math.round(ch)}ch wide (> 100ch) with ${chars} chars of text`);
  }

  // small-target
  for (const el of Array.from(document.body.querySelectorAll(INTERACTIVE)).filter(isVisible)) {
    // A checkbox or radio inside its <label> is clicked through the label: the label is the target.
    const owner = el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest("label") : null;
    const r = (owner ?? el).getBoundingClientRect();
    if ((r.width >= 24 && r.height >= 24) || allowed(el, "small-target")) continue;
    if (el.tagName === "A" && style(el).display.startsWith("inline") && ownText(el.parentElement ?? el) !== "") {
      const inRunningText = Array.from(el.parentElement?.childNodes ?? []).some(
        (n) => n !== el && n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
      if (inRunningText) continue;
    }
    add("small-target", el, `${Math.round(r.width)}x${Math.round(r.height)} < 24x24`);
  }

  // color-noise
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, [number, number, number, number]>();
  const rgba = (css: string): [number, number, number, number] => {
    const hit = cache.get(css);
    if (hit) return hit;
    let out: [number, number, number, number] = [0, 0, 0, 0];
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    cache.set(css, out);
    return out;
  };
  /** Hue bin (30 degrees) of a saturated, mid-lightness color, else null. */
  const hueBin = (css: string): number | null => {
    const [R, G, B, a] = rgba(css);
    if (a < 0.5) return null;
    const r = R / 255, g = G / 255, b = B / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return null;
    const d = max - min;
    const sat = d / (1 - Math.abs(2 * l - 1));
    if (sat <= 0.3 || l < 0.2 || l > 0.85) return null;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return Math.floor(h / 30) % 12;
  };
  const accentCss = style(document.documentElement).getPropertyValue("--accent").trim();
  const accentBin = accentCss ? hueBin(accentCss) : null;
  const buckets = new Map<number, { el: Element; kind: string }>();
  const note = (bin: number | null, el: Element, kind: string) => {
    if (bin !== null && !buckets.has(bin)) buckets.set(bin, { el, kind });
  };
  for (const el of scoped) {
    const s = style(el);
    if (ownText(el) !== "") note(hueBin(s.color), el, "text");
    note(hueBin(s.backgroundColor), el, "background");
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const styleKey = `border${side}Style` as "borderTopStyle";
      if (s[styleKey] !== "none" && s[styleKey] !== "hidden" && parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0) {
        note(hueBin(s.getPropertyValue(`border-${side.toLowerCase()}-color`)), el, "border");
      }
    }
  }
  if (buckets.size > 3) {
    const parts = Array.from(buckets.entries()).map(
      ([bin, { el, kind }]) => `${bin * 30}-${bin * 30 + 30}deg${bin === accentBin ? " (accent)" : ""} ${kind} on ${describe(el)}`,
    );
    const first = buckets.values().next().value!;
    add("color-noise", first.el, `${buckets.size} saturated hues in the viewport (> 3): ${parts.join("; ")}`);
  }

  // competing-primaries
  const primaries = scoped.filter((el) => el.matches('[data-variant="primary"]'));
  if (primaries.length > 1) {
    add("competing-primaries", primaries[0], `${primaries.length} primary buttons in view: ${primaries.map(describe).join(", ")}`);
  }

  // unreduced-motion (the audit browser runs with reducedMotion: "reduce")
  for (const anim of document.getAnimations()) {
    if (anim.playState !== "running") continue;
    const effect = anim.effect as KeyframeEffect | null;
    const target = effect?.target ?? null;
    if (!effect || !target || allowed(target, "unreduced-motion")) continue;
    const t = effect.getComputedTiming();
    const duration = Number(t.duration);
    if (t.iterations === Infinity || duration > 200) {
      const name = (anim as CSSAnimation).animationName ?? (anim as CSSTransition).transitionProperty ?? "animation";
      add("unreduced-motion", target, `${name} runs ${t.iterations === Infinity ? "infinitely" : `${Math.round(duration)}ms`} under prefers-reduced-motion`);
    }
  }

  return issues;
}
