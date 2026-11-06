import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { RawIssue } from "../types";

const RULES = ["color-contrast", "label", "button-name", "link-name", "aria-input-field-name", "select-name"];

export async function collectA11yIssues(page: Page): Promise<RawIssue[]> {
  const results = await new AxeBuilder({ page }).withRules(RULES).analyze();
  const issues: RawIssue[] = [];
  for (const v of results.violations) {
    for (const node of v.nodes) {
      issues.push({
        check: v.id === "color-contrast" ? "contrast" : "label",
        selector: node.target.join(" "),
        detail: (node.failureSummary ?? v.help).split("\n")[0],
      });
    }
  }
  return issues;
}
