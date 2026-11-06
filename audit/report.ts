import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Issue, RawIssue } from "./types";

const OUT = fileURLToPath(new URL("../audit-output/", import.meta.url));
const ISSUES = join(OUT, "issues");

/** Writes one screen × width issues file; Task 4 reuses this. */
export async function writeIssues(screen: string, width: number, issues: RawIssue[]): Promise<void> {
  await mkdir(ISSUES, { recursive: true });
  const full: Issue[] = issues.map((i) => ({ screen, width, check: i.check, selector: i.selector, detail: i.detail }));
  await writeFile(join(ISSUES, `${screen}@${width}.json`), JSON.stringify(full, null, 2));
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export function renderMarkdown(issues: Issue[]): string {
  const widths = [...new Set(issues.map((i) => i.width))].sort(cmp);
  const checks = [...new Set(issues.map((i) => i.check))].sort(cmp);
  const lines: string[] = ["# Raven visual audit", "", `${issues.length} issues`, ""];
  lines.push(`| check | ${widths.join(" | ")} | total |`, `|---|${widths.map(() => "---:").join("|")}|---:|`);
  for (const c of checks) {
    const counts = widths.map((w) => issues.filter((i) => i.check === c && i.width === w).length);
    lines.push(`| ${c} | ${counts.join(" | ")} | ${counts.reduce((a, b) => a + b, 0)} |`);
  }
  const screens = [...new Set(issues.map((i) => i.screen))].sort(cmp);
  for (const s of screens) {
    lines.push("", `## ${s}`, "");
    const rows = new Map<string, { issue: Issue; widths: number[] }>();
    for (const i of issues.filter((x) => x.screen === s)) {
      const key = `${i.check}\u0000${i.selector}`;
      const row = rows.get(key);
      if (row) row.widths.push(i.width);
      else rows.set(key, { issue: i, widths: [i.width] });
    }
    for (const { issue, widths: ws } of rows.values()) {
      lines.push(`- [${ws.join(", ")}] **${issue.check}** \`${issue.selector}\` — ${issue.detail}`);
    }
    lines.push("", ...[...new Set(issues.filter((x) => x.screen === s).map((x) => x.width))].sort(cmp).map((w) => `[${s}@${w}](shots/${s}@${w}.png)`).join(" · ").split("\n"));
  }
  return lines.join("\n") + "\n";
}

export default async function globalTeardown(): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(ISSUES)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  const issues: Issue[] = [];
  for (const f of files) issues.push(...(JSON.parse(await readFile(join(ISSUES, f), "utf8")) as Issue[]));
  issues.sort((a, b) => cmp(a.screen, b.screen) || cmp(a.width, b.width) || cmp(a.check, b.check) || cmp(a.selector, b.selector));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), JSON.stringify(issues, null, 2));
  await writeFile(join(OUT, "report.md"), renderMarkdown(issues));
}
