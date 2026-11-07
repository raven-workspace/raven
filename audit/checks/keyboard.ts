import type { Page } from "@playwright/test";
import { AUDIT_IDS } from "../../src/audit/fixtures";
import type { RawIssue } from "../types";

const E = `/e/${AUDIT_IDS.labEngagement}`;
const H = `${E}/h/${AUDIT_IDS.webHost}`;

export interface ShortcutCase {
  id: string;
  path: string;
  keys: string[];
  /** Selector that must become visible. */
  opens: string;
  /** Focus must land inside `opens`. */
  focusInside: boolean;
  closesWithEscape: boolean;
  /** Replaces the generic open/focus/close flow when the outcome is not "something opens". */
  custom?: (page: Page) => Promise<RawIssue[]>;
}

/** What one Tab stop reports back from the page. */
interface StopResult {
  end: "cycle" | "body" | null;
  issues: RawIssue[];
}

interface KbdState {
  stops: Element[];
  targets: Element[];
  checked: WeakSet<Element>;
  describe: (el: Element) => string;
}

const STATE_KEY = "__auditKbd";

/**
 * Collects the visible interactive elements and installs the helpers the other
 * in-page functions use. Self-contained: it runs inside `page.evaluate`.
 */
function install(key: string): number {
  const INTERACTIVE =
    'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
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
    return null;
  };

  const describe = (el: Element): string => {
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;
    const role = implicitRole(el);
    if (role) {
      const name = el.getAttribute("aria-label") ?? (el.textContent ?? "").replace(/\s+/g, " ").trim();
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

  // A transition on blur would hide the difference we are measuring.
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(style);

  const targets = Array.from(document.body.querySelectorAll(INTERACTIVE)).filter(
    (el) => isVisible(el) && !(el as HTMLButtonElement).disabled && !el.closest('[inert], [aria-hidden="true"]'),
  );
  const state: KbdState = { stops: [], targets, checked: new WeakSet(), describe };
  (window as unknown as Record<string, KbdState>)[key] = state;
  // Start from the top of the document: a click or select in a screen's setup moves Chromium's
  // sequential focus starting point, and Tab would skip everything before it.
  (document.activeElement as HTMLElement | null)?.blur();
  getSelection()?.removeAllRanges();
  document.body.setAttribute("tabindex", "-1");
  document.body.focus({ preventScroll: true });
  document.body.removeAttribute("tabindex");
  return targets.length;
}

/** Reads the focused element after a Tab press and runs the per-stop checks. */
function recordStop(key: string): StopResult {
  const state = (window as unknown as Record<string, KbdState>)[key];
  const el = document.activeElement;
  // Radix puts zero-size guard spans at both ends of a modal; reaching one means the dialog's tab loop wrapped.
  if (el?.hasAttribute("data-radix-focus-guard")) return { end: state.stops.length > 0 ? "cycle" : null, issues: [] };
  if (!el || el === document.body || el === document.documentElement) return { end: "body", issues: [] };
  // Focus that did not move since the last Tab is a stuck stop, not a cycle.
  if (state.stops.length > 0 && el === state.stops[0] && state.stops[state.stops.length - 1] !== el) return { end: "cycle", issues: [] };
  state.stops.push(el);
  if (state.checked.has(el)) return { end: null, issues: [] };
  state.checked.add(el);

  const issues: RawIssue[] = [];
  const selector = state.describe(el);

  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const hidden: string[] = [];
  if (r.width === 0 || r.height === 0) hidden.push("zero-size rect");
  if (s.visibility === "hidden") hidden.push("visibility:hidden");
  if (parseFloat(s.opacity) === 0) hidden.push("opacity 0");
  if (r.right <= 0 || r.left >= window.innerWidth || r.bottom <= 0 || r.top >= window.innerHeight) {
    hidden.push(`outside viewport after focus scroll (rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
  }
  if (hidden.length > 0) issues.push({ check: "focus-hidden", selector, detail: `focused element is not visible: ${hidden.join(", ")}` });

  const PROPS = ["outline-style", "outline-width", "outline-color", "box-shadow", "border-color", "background-color", "text-decoration-line"];
  const snap = () => {
    const cs = getComputedStyle(el);
    return PROPS.map((p) => cs.getPropertyValue(p));
  };
  const focused = snap();
  (el as HTMLElement).blur();
  const blurred = snap();
  if (el.isConnected) (el as HTMLElement).focus({ preventScroll: true });
  if (focused.every((v, i) => v === blurred[i])) {
    issues.push({ check: "focus-invisible", selector, detail: `no visible change on focus (${PROPS.join(", ")} identical)` });
  }
  return { end: null, issues };
}

/** Interactive elements the walk never focused. */
function unreached(key: string): RawIssue[] {
  const state = (window as unknown as Record<string, KbdState>)[key];
  const GROUPS = '[role="tablist"], [role="listbox"], [role="menu"], [role="radiogroup"]';
  const stops = new Set(state.stops);
  const out: RawIssue[] = [];
  for (const el of state.targets) {
    if (!el.isConnected || stops.has(el)) continue;
    const group = el.closest(GROUPS);
    if (group && state.stops.some((s) => group.contains(s))) continue;
    const idx = el.getAttribute("tabindex");
    out.push({
      check: "unreachable",
      selector: state.describe(el),
      detail: idx === "-1" ? "never received focus from Tab (tabindex=-1)" : "never received focus from Tab",
    });
  }
  return out;
}

/** Presses Tab through the page and reports focus problems. */
export async function tabWalk(page: Page, opts: { maxStops?: number } = {}): Promise<RawIssue[]> {
  const maxStops = opts.maxStops ?? 150;
  await page.evaluate(install, STATE_KEY);
  const issues: RawIssue[] = [];
  let ended = false;
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(recordStop, STATE_KEY);
    issues.push(...stop.issues);
    if (stop.end) {
      ended = true;
      break;
    }
  }
  if (!ended) {
    const trap = await page.evaluate((key) => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return null;
      const state = (window as unknown as Record<string, KbdState>)[key];
      const active = document.activeElement;
      return active ? state.describe(active) : "html";
    }, STATE_KEY);
    if (trap !== null) {
      issues.push({ check: "focus-trap", selector: trap, detail: `focus did not cycle back within ${maxStops} Tab presses` });
    }
    // An unfinished walk cannot say what is unreachable.
    return issues;
  }
  issues.push(...(await page.evaluate(unreached, STATE_KEY)));
  return issues;
}

async function boardMove(page: Page): Promise<RawIssue[]> {
  const where = (hostId: string) =>
    page.evaluate((id) => {
      const card = document.querySelector(`a[data-host-id="${id}"]`);
      return card?.closest("section")?.getAttribute("aria-label") ?? null;
    }, hostId);
  const pick = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("section[aria-label]")).filter((s) => s.querySelector("a[data-host-id]"));
    const all = Array.from(document.querySelectorAll("section[aria-label]"));
    for (const s of sections) {
      if (all.indexOf(s) === all.length - 1) continue;
      const card = s.querySelector("a[data-host-id]")!;
      return { id: card.getAttribute("data-host-id")!, from: s.getAttribute("aria-label")! };
    }
    return null;
  });
  if (!pick) return [{ check: "shortcut", selector: "a[data-host-id]", detail: "] had no board card to move (none outside the last column)" }];
  await page.locator(`a[data-host-id="${pick.id}"]`).focus();
  await page.keyboard.press("]");
  const moved = await page
    .waitForFunction(
      ({ id, from }) => {
        const to = document.querySelector(`a[data-host-id="${id}"]`)?.closest("section")?.getAttribute("aria-label");
        return !!to && to !== from;
      },
      pick,
      { timeout: 1000 },
    )
    .then(() => true, () => false);
  if (moved) return [];
  return [{ check: "shortcut", selector: `a[data-host-id="${pick.id}"]`, detail: `] did not move the card out of "${pick.from}" (still in "${await where(pick.id)}")` }];
}

/** Presses `key` on a neutral focus and checks that `target`'s aria-expanded (or presence) flips, then flips back. */
function toggles(key: string, target: string, label: string) {
  return async (page: Page): Promise<RawIssue[]> => {
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const state = () => page.locator(target).first().getAttribute("aria-expanded");
    const before = await state();
    await page.keyboard.press(key);
    const flipped = await page.waitForFunction(
      ({ sel, was }) => document.querySelector(sel)?.getAttribute("aria-expanded") !== was,
      { sel: target, was: before },
      { timeout: 1000 },
    ).then(() => true, () => false);
    if (!flipped) return [{ check: "shortcut", selector: target, detail: `${key} did not toggle ${label}` }];
    await page.keyboard.press(key);
    const back = await page.waitForFunction(
      ({ sel, was }) => document.querySelector(sel)?.getAttribute("aria-expanded") === was,
      { sel: target, was: before },
      { timeout: 1000 },
    ).then(() => true, () => false);
    return back ? [] : [{ check: "shortcut", selector: target, detail: `a second ${key} did not toggle ${label} back` }];
  };
}

async function sidebarToggle(page: Page): Promise<RawIssue[]> {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  const startsOpen = await collapse.isVisible();
  await page.keyboard.press("Meta+B");
  const flipped = await (startsOpen ? expand : collapse).waitFor({ state: "visible", timeout: 1000 }).then(() => true, () => false);
  return flipped ? [] : [{ check: "shortcut", selector: "role=button[name=/sidebar/]", detail: "⌘B did not toggle the sidebar" }];
}

async function tabSwitch(page: Page): Promise<RawIssue[]> {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Alt+2");
  const ok = await page.getByRole("tab", { name: "Log", selected: true }).waitFor({ timeout: 1000 }).then(() => true, () => false);
  return ok ? [] : [{ check: "shortcut", selector: "role=tab[name='Log']", detail: "⌥2 did not select the Log tab" }];
}

export const SHORTCUTS: ShortcutCase[] = [
  { id: "palette", path: H, keys: ["Meta+K"], opens: 'role=dialog[name="Search"]', focusInside: true, closesWithEscape: true },
  { id: "palette-hostpick", path: H, keys: ["Meta+K", "Alt+H"], opens: "select[aria-label='Fill for host']", focusInside: true, closesWithEscape: true },
  { id: "arsenal", path: H, keys: ["a"], opens: "aside[aria-label='Arsenal']", focusInside: true, closesWithEscape: true },
  { id: "stuck", path: H, keys: ["h"], opens: "aside[aria-label^='Stuck on']", focusInside: false, closesWithEscape: true },
  { id: "capture", path: H, keys: ["l"], opens: "[role='dialog']", focusInside: true, closesWithEscape: true },
  { id: "notes", path: H, keys: ["n"], opens: "aside[aria-label^='Notes']", focusInside: true, closesWithEscape: true },
  { id: "new-engagement", path: "/", keys: ["Meta+N"], opens: "[role='dialog']", focusInside: true, closesWithEscape: true },
  {
    id: "services-toggle", path: H, keys: ["s"], opens: "the Services fact group",
    focusInside: false, closesWithEscape: false, custom: toggles("s", "section[aria-label='Services'] button[aria-expanded]", "the Services group"),
  },
  { id: "finding-split", path: H, keys: ["f"], opens: "role=region[name='Finding']", focusInside: true, closesWithEscape: true },
  { id: "sidebar-toggle", path: H, keys: ["Meta+B"], opens: "the sidebar", focusInside: false, closesWithEscape: false, custom: sidebarToggle },
  { id: "tab-log", path: H, keys: ["Alt+2"], opens: "the Log tab", focusInside: false, closesWithEscape: false, custom: tabSwitch },
  {
    id: "board-move", path: E, keys: ["focus first board card", "]"], opens: "the moved board card",
    focusInside: false, closesWithEscape: false, custom: boardMove,
  },
];

/** Presses a shortcut's keys on an already loaded page and checks what happens. */
export async function checkShortcut(page: Page, s: ShortcutCase): Promise<RawIssue[]> {
  if (s.custom) return s.custom(page);
  const keys = s.keys.join(" then ");
  const issues: RawIssue[] = [];
  // Start from a neutral focus so plain-letter shortcuts are free keys.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (const k of s.keys) await page.keyboard.press(k);
  const target = page.locator(s.opens).first();
  const opened = await target.waitFor({ state: "visible", timeout: 1000 }).then(() => true, () => false);
  if (!opened) return [{ check: "shortcut", selector: s.opens, detail: `${keys} did not open ${s.opens}` }];

  if (s.focusInside) {
    const inside = await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
    if (!inside) {
      const active = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName.toLowerCase()}${a.getAttribute("aria-label") ? `[aria-label="${a.getAttribute("aria-label")}"]` : ""}` : "none";
      });
      issues.push({ check: "shortcut", selector: s.opens, detail: `${keys} opened it but focus is not inside it (focus is on ${active})` });
    }
  }

  if (s.closesWithEscape) {
    await page.keyboard.press("Escape");
    const closed = await target.waitFor({ state: "hidden", timeout: 1000 }).then(() => true, () => false);
    if (!closed) issues.push({ check: "shortcut", selector: s.opens, detail: "Escape did not close it" });
    const connected = await page.evaluate(() => !!document.activeElement && document.activeElement.isConnected);
    if (!connected) issues.push({ check: "shortcut", selector: s.opens, detail: "after Escape, focus is on a detached node" });
  }
  return issues;
}
