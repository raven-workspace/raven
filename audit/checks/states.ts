import type { Page } from "@playwright/test";
import type { RawIssue } from "../types";

// Mirrors the non-"full" values of AuditScenario in src/audit/fakeApi.ts (not imported: it would drag the app into tsconfig.node).
export type AuditState = "empty" | "loading" | "error";

/** In-page: regions of the main content that show nothing but their own heading. */
function emptyRegions(): RawIssue[] {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const label = el.getAttribute("aria-label");
    if (label) return `${tag}[aria-label="${label}"]`;
    const role = el.getAttribute("role");
    if (role) return `${tag}[role="${role}"]`;
    const parent = el.parentElement;
    if (!parent || tag === "main") return tag;
    return `${tag}:nth-of-type(${[...parent.children].filter((c) => c.tagName === el.tagName).indexOf(el) + 1})`;
  };
  const main = document.querySelector("main");
  if (!main) return [{ check: "missing-empty-state", selector: "body", detail: "no <main> region" }];
  const issues: RawIssue[] = [];
  for (const region of [main, ...main.querySelectorAll("[role='tabpanel'], section")]) {
    if (!visible(region)) continue;
    let text = (region as HTMLElement).innerText ?? "";
    for (const h of region.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']")) {
      if (visible(h)) text = text.replace((h as HTMLElement).innerText ?? "", "");
    }
    if (text.trim() === "") {
      issues.push({ check: "missing-empty-state", selector: describe(region), detail: "no text beyond its heading when there is no data" });
    }
  }
  return issues;
}

/** In-page: the main content is blank while data loads. */
function blankLoading(): RawIssue[] {
  const main = document.querySelector("main");
  const text = ((main as HTMLElement | null)?.innerText ?? "").trim();
  const busy = main?.querySelector("[aria-busy='true'], [role='progressbar'], [role='status']");
  return text === "" && !busy
    ? [{ check: "blank-loading", selector: "main", detail: "no text, aria-busy, progressbar or status 500ms after navigation" }]
    : [];
}

/** In-page: a failed load that tells the user nothing. */
function silentError(): RawIssue[] {
  const alert = [...document.querySelectorAll("[role='alert']")].some((el) => el.getBoundingClientRect().height > 0);
  const said = /error|failed|couldn.?t|try again/i.test(document.body.innerText);
  return alert || said
    ? []
    : [{ check: "silent-error", selector: "main", detail: "every command failed and nothing on screen says so after 1s" }];
}

/** Call once the screen has loaded under `?audit=<state>`. Waits the state's own grace period, then checks. */
export async function collectStateIssues(page: Page, scenario: AuditState): Promise<RawIssue[]> {
  if (scenario === "loading") {
    await page.waitForTimeout(500);
    return page.evaluate(blankLoading);
  }
  if (scenario === "error") {
    await page.waitForTimeout(1000);
    return page.evaluate(silentError);
  }
  await page.waitForTimeout(500);
  return page.evaluate(emptyRegions);
}
