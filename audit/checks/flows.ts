import type { Page } from "@playwright/test";
import { AUDIT_IDS } from "../../src/audit/fixtures";
import type { RawIssue } from "../types";

export type FlowStep =
  | { press: string } // 1 action
  | { type: string } // 1 action (one field fill = one action)
  | { click: string; why: string } // 1 action, and reported as flow-needs-mouse
  | { expect: string } // 0 actions: waits for the selector, timed
  | { tabTo: string }; // N actions: presses Tab until the focused element matches the selector (cap 40) // 0 actions: waits for the selector, timed

export interface Flow {
  id: string;
  path: string;
  budget: number;
  steps: FlowStep[];
  /** Selector that appears, or a wait that resolves, when the flow has achieved its goal. Never happening means the flow is broken. */
  done: string | ((page: Page) => Promise<void>);
  /** Runs before the first action; not counted. */
  prepare?: (page: Page) => Promise<void>;
  /** Runs after `done`; not counted. Reports what the flow did not actually achieve. */
  verify?: (page: Page) => Promise<RawIssue[]>;
}

const E = `/e/${AUDIT_IDS.labEngagement}`;
const H = `${E}/h/${AUDIT_IDS.webHost}`;
const H_DC = `${E}/h/${AUDIT_IDS.dcHost}`;
const SLOW_MS = 200;
const DONE_TIMEOUT_MS = 5000;

const NO_DIALOG = "body:not(:has([role='dialog']))";
const SENTINEL = "audit-clipboard-sentinel";
const MAX_TABS = 40;
const CRED_PASTE = "administrator:Password123!";
const STUCK = "aside[aria-label^='Stuck on']";

// Rows mentioning the pasted user in the host's "Host Credentials" fact group (not a counted action: it observes the outcome).
const credRowsBefore = new WeakMap<Page, number>();
async function countCredRows(page: Page): Promise<number> {
  const group = page.locator("section[aria-label='Host Credentials']");
  await group.waitFor({ timeout: DONE_TIMEOUT_MS });
  const folded = group.locator("button[aria-expanded='false']");
  if (await folded.count()) await folded.first().click();
  await group.getByRole("heading", { name: "Host Credentials" }).waitFor({ timeout: DONE_TIMEOUT_MS });
  return group.getByText(/administrator/i).count();
}

export const FLOWS: Flow[] = [
  {
    id: "log-command", path: H, budget: 3,
    // The host page opens on Next; the new entry shows in the Log tab.
    done: async (page) => {
      await page.getByRole("tab", { name: "Log", exact: true }).dispatchEvent("click");
      await page.locator("text=nmap -sV 10.10.20.15").first().waitFor({ state: "visible", timeout: DONE_TIMEOUT_MS });
    },
    steps: [{ press: "l" }, { expect: "[role='dialog']" }, { type: "nmap -sV 10.10.20.15" }, { press: "Meta+Enter" }],
  },
  {
    id: "add-credential", path: H, budget: 3, done: NO_DIALOG,
    steps: [{ press: "l" }, { expect: "[role='dialog']" }, { type: CRED_PASTE }, { press: "Meta+Enter" }],
    // Intake only reads tool output (nxc, secretsdump, ...). A bare user:pass is saved as a log entry, not a credential.
    prepare: async (page) => {
      credRowsBefore.set(page, await countCredRows(page));
    },
    verify: async (page) => {
      const created = (await countCredRows(page)) > (credRowsBefore.get(page) ?? 0);
      return created
        ? []
        : [{
            check: "flow-needs-mouse",
            selector: "section[aria-label='Host Credentials']",
            detail: `pasting \`${CRED_PASTE}\` and saving created no credential (intake only parses tool output); adding one takes the Add access form in the Host Credentials group`,
          }];
    },
  },
  {
    id: "next-step", path: E, budget: 2, done: async (page) => {
      await page.waitForURL(`**${H}`, { timeout: DONE_TIMEOUT_MS });
      await page.getByRole("tab", { name: "Next", selected: true }).waitFor({ state: "visible", timeout: DONE_TIMEOUT_MS });
    },
    // The shortest keyboard path from the board to a host today is the first sidebar host link; board cards come later.
    steps: [{ tabTo: "nav[aria-label='Engagement'] a[href*='/h/']" }, { press: "Enter" }],
  },
  {
    id: "palette-run", path: H, budget: 3,
    // Enter copies the top result: the clipboard must change from the sentinel.
    prepare: (page) => page.evaluate((v) => navigator.clipboard.writeText(v), SENTINEL),
    done: async (page) => {
      await page.waitForFunction((v) => navigator.clipboard.readText().then((t) => t !== v && t.length > 0), SENTINEL, { timeout: DONE_TIMEOUT_MS });
      await page.locator(NO_DIALOG).waitFor({ state: "visible", timeout: DONE_TIMEOUT_MS });
    },
    steps: [{ press: "Meta+K" }, { expect: "role=combobox" }, { type: "smb" }, { expect: "role=listbox[name='Results']" }, { press: "Enter" }],
  },
  {
    id: "arsenal-copy", path: H, budget: 3, done: "text=Copied",
    steps: [
      { press: "a" },
      { expect: "input[aria-label='Search the Arsenal']" },
      { type: "kerberoast" },
      { expect: "role=listbox[name='Arsenal results']" },
      { press: "Enter" },
      {
        click: "aside[aria-label='Arsenal'] button[aria-label^='Copy command'] >> nth=0",
        why: "Enter in the Arsenal drawer opens the card but does not copy; its Copy button has no keyboard shortcut",
      },
    ],
  },
  {
    id: "switch-host", path: H, budget: 3, done: async (page) => {
      await page.waitForURL(`**${H_DC}`, { timeout: DONE_TIMEOUT_MS });
      await page.locator("role=heading[level=1][name='dc01']").waitFor({ state: "visible", timeout: DONE_TIMEOUT_MS });
    },
    steps: [
      {
        click: `nav[aria-label='Engagement'] a[href$='/h/${AUDIT_IDS.dcHost}']`,
        why: "the palette does not search hosts (⌘K dc01 lists log entries) and no shortcut switches host",
      },
    ],
  },
  {
    id: "stuck-and-back", path: H, budget: 2, done: `body:not(:has(${STUCK}))`,
    steps: [{ press: "h" }, { expect: STUCK }, { press: "Escape" }],
  },
];

const label = (s: FlowStep): string | null => ("press" in s ? s.press : "type" in s ? "type" : "click" in s ? "click" : null);

/** Replays the flow on a freshly loaded `flow.path`. Throws when `flow.done` never appears. */
export async function runFlow(page: Page, flow: Flow): Promise<RawIssue[]> {
  const issues: RawIssue[] = [];
  const actions: string[] = [];
  let lastAction = "";
  let lastAt = 0;

  const timed = async (selector: string, timeout: number) => {
    await page.locator(selector).first().waitFor({ state: "visible", timeout });
    const ms = Date.now() - lastAt;
    if (lastAction && ms > SLOW_MS) {
      issues.push({ check: "flow-slow", selector, detail: `${ms}ms from ${lastAction} until visible (> ${SLOW_MS}ms)` });
    }
  };

  await flow.prepare?.(page);
  for (const step of flow.steps) {
    if ("tabTo" in step) {
      let reached = false;
      for (let n = 0; n < MAX_TABS && !reached; n++) {
        await page.keyboard.press("Tab");
        actions.push("Tab");
        reached = await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, step.tabTo);
      }
      if (!reached) throw new Error(`flow ${flow.id}: Tab did not reach ${step.tabTo} within ${MAX_TABS} presses`);
      lastAction = "Tab";
      lastAt = Date.now();
      continue;
    }
    if ("expect" in step) {
      await timed(step.expect, DONE_TIMEOUT_MS);
      continue;
    }
    if ("press" in step) await page.keyboard.press(step.press);
    else if ("type" in step) await page.keyboard.insertText(step.type);
    else {
      await page.locator(step.click).click();
      issues.push({ check: "flow-needs-mouse", selector: step.click, detail: step.why });
    }
    actions.push(label(step)!);
    lastAction = label(step)!;
    lastAt = Date.now();
  }
  if (typeof flow.done === "string") await timed(flow.done, DONE_TIMEOUT_MS);
  else {
    await flow.done(page);
    const ms = Date.now() - lastAt;
    if (ms > SLOW_MS) issues.push({ check: "flow-slow", selector: `flow:${flow.id}`, detail: `${ms}ms from ${lastAction} until done (> ${SLOW_MS}ms)` });
  }
  issues.push(...((await flow.verify?.(page)) ?? []));

  if (actions.length > flow.budget) {
    issues.push({
      check: "flow-over-budget",
      selector: `flow:${flow.id}`,
      detail: `${actions.length} actions > budget ${flow.budget}: ${actions.join(", ")}`,
    });
  }
  return issues;
}
