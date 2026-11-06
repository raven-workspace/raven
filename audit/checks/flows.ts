import type { Page } from "@playwright/test";
import { AUDIT_IDS } from "../../src/audit/fixtures";
import type { RawIssue } from "../types";

export type FlowStep =
  | { press: string } // 1 action
  | { type: string } // 1 action (one field fill = one action)
  | { click: string; why: string } // 1 action, and reported as flow-needs-mouse
  | { expect: string }; // 0 actions: waits for the selector, timed

export interface Flow {
  id: string;
  path: string;
  budget: number;
  steps: FlowStep[];
  /** Appears when the flow has achieved its goal. Never appearing means the flow is broken. */
  done: string;
}

const E = `/e/${AUDIT_IDS.labEngagement}`;
const H = `${E}/h/${AUDIT_IDS.webHost}`;
const SLOW_MS = 200;
const DONE_TIMEOUT_MS = 5000;

// Nothing else in the app uses a dialog while these flows run, so "no dialog" is a visible-selector for "it closed".
const NO_DIALOG = "body:not(:has([role='dialog']))";
const STUCK = "aside[aria-label^='Stuck on']";

// The shortest keyboard path to a host from the board today: Tab through the top bar, the section tabs and the
// sidebar until the first host link. The board's own cards are 11 Tabs further on.
const TABS_TO_FIRST_HOST = 12;

export const FLOWS: Flow[] = [
  {
    id: "log-command", path: H, budget: 3, done: "text=nmap -sV 10.10.20.15",
    steps: [{ press: "l" }, { expect: "[role='dialog']" }, { type: "nmap -sV 10.10.20.15" }, { press: "Meta+Enter" }],
  },
  {
    id: "add-credential", path: H, budget: 3, done: NO_DIALOG,
    steps: [{ press: "l" }, { expect: "[role='dialog']" }, { type: "administrator:Password123!" }, { press: "Meta+Enter" }],
  },
  {
    id: "next-step", path: E, budget: 2, done: "[aria-label='Now']",
    steps: [...Array.from({ length: TABS_TO_FIRST_HOST }, () => ({ press: "Tab" })), { press: "Enter" }],
  },
  {
    id: "palette-run", path: H, budget: 3, done: NO_DIALOG,
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
    id: "switch-host", path: H, budget: 3, done: `${"role=tab[name='Story']"} >> visible=true`,
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

  for (const step of flow.steps) {
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
  await timed(flow.done, DONE_TIMEOUT_MS);

  if (actions.length > flow.budget) {
    issues.push({
      check: "flow-over-budget",
      selector: `flow:${flow.id}`,
      detail: `${actions.length} actions > budget ${flow.budget}: ${actions.join(", ")}`,
    });
  }
  return issues;
}
