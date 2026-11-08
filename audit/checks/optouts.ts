import type { RawIssue } from "../types";

/**
 * In-page: every `data-audit-allow` opt-out on the page, so the report can list them. One without a non-empty
 * `data-audit-reason`, or one naming a check that doesn't exist, is an error. Passed to `page.evaluate`, so it stays self-contained.
 */
export function collectOptOuts(known: readonly string[]): RawIssue[] {
  const describe = (el: Element): string => {
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;
    const label = el.getAttribute("aria-label");
    const tag = el.tagName.toLowerCase();
    if (label) return `${tag}[aria-label="${label}"]`;
    const cls = Array.from(el.classList).slice(0, 3).map((k) => "." + CSS.escape(k)).join("");
    return `${tag}${cls}[data-audit-allow="${el.getAttribute("data-audit-allow")}"]`;
  };
  const out: RawIssue[] = [];
  for (const el of Array.from(document.querySelectorAll("[data-audit-allow]"))) {
    const checks = (el.getAttribute("data-audit-allow") ?? "").trim();
    const reason = (el.getAttribute("data-audit-reason") ?? "").trim();
    const unknown = checks.split(/\s+/).filter((c) => c !== "" && !known.includes(c));
    if (checks === "" || unknown.length > 0) {
      out.push({ check: "opt-out-invalid", selector: describe(el), detail: `allows ${checks === "" ? "nothing" : `unknown check "${unknown.join(" ")}"`}: a typo would opt out of nothing` });
    }
    if (reason === "") out.push({ check: "opt-out-unreasoned", selector: describe(el), detail: `allows "${checks}" without a data-audit-reason` });
    else out.push({ check: "opt-out", selector: describe(el), detail: `${checks}: ${reason}` });
  }
  return out;
}
