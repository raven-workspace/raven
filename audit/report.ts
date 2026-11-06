import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENS, WIDTHS } from "./screens";
import type { Issue, RawIssue } from "./types";

const OUT = fileURLToPath(new URL("../audit-output/", import.meta.url));
const ISSUES = join(OUT, "issues");
const SHOTS = join(OUT, "shots");

/** Writes one screen × width issues file; Task 4 reuses this. */
export async function writeIssues(screen: string, width: number, issues: RawIssue[]): Promise<void> {
  await mkdir(ISSUES, { recursive: true });
  const full: Issue[] = issues.map((i) => ({ screen, width, check: i.check, selector: i.selector, detail: i.detail }));
  await writeFile(join(ISSUES, `${screen}@${width}.json`), JSON.stringify(full, null, 2));
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export const MAX_GROUPS_PER_CHECK = 12;

export interface RowGroup {
  check: string;
  selector: string;
  count: number;
  widths: number[];
  detail: string;
}

/** Groups one screen's issues by (check, selector without positional pseudo-classes). */
export function groupRows(issues: Issue[]): { groups: RowGroup[]; more: { check: string; count: number }[] } {
  const byKey = new Map<string, RowGroup>();
  for (const i of issues) {
    const selector = i.selector.replace(/:nth-(?:of-type|child)\([^)]*\)/g, "");
    const key = `${i.check}\u0000${selector}`;
    const g = byKey.get(key);
    if (g) {
      g.count++;
      if (!g.widths.includes(i.width)) g.widths.push(i.width);
    } else byKey.set(key, { check: i.check, selector, count: 1, widths: [i.width], detail: i.detail });
  }
  const perCheck = new Map<string, RowGroup[]>();
  for (const g of byKey.values()) perCheck.set(g.check, [...(perCheck.get(g.check) ?? []), g]);
  const groups: RowGroup[] = [];
  const more: { check: string; count: number }[] = [];
  for (const check of [...perCheck.keys()].sort(cmp)) {
    const list = perCheck.get(check)!.sort((a, b) => b.count - a.count);
    groups.push(...list.slice(0, MAX_GROUPS_PER_CHECK));
    if (list.length > MAX_GROUPS_PER_CHECK) more.push({ check, count: list.length - MAX_GROUPS_PER_CHECK });
  }
  for (const g of groups) g.widths.sort((a, b) => a - b);
  return { groups, more };
}

export function renderMarkdown(issues: Issue[], screenIds: string[], shots: Set<string>): string {
  const widths = [...new Set(issues.map((i) => i.width))].sort(cmp);
  const checks = [...new Set(issues.map((i) => i.check))].sort(cmp);
  const lines: string[] = ["# Raven visual audit", "", `${issues.length} issues`, ""];
  lines.push(`| check | ${widths.join(" | ")} | total |`, `|---|${widths.map(() => "---:").join("|")}|---:|`);
  for (const c of checks) {
    const counts = widths.map((w) => issues.filter((i) => i.check === c && i.width === w).length);
    const groupCount = new Set(issues.filter((i) => i.check === c).map((i) => `${i.screen}\u0000${i.selector.replace(/:nth-(?:of-type|child)\([^)]*\)/g, "")}`)).size;
    lines.push(`| ${c} | ${counts.join(" | ")} | ${counts.reduce((a, b) => a + b, 0)} (${groupCount} groups) |`);
  }
  // Keyboard issues are filed under ids that are not screens (`<id>:kbd`, `shortcut:<id>`).
  const extra = [...new Set(issues.map((i) => i.screen))].filter((s) => !screenIds.includes(s));
  for (const s of [...screenIds, ...extra].sort(cmp)) {
    lines.push("", `## ${s}`, "");
    const { groups, more } = groupRows(issues.filter((x) => x.screen === s));
    if (groups.length === 0) lines.push("No issues.");
    for (const g of groups) {
      lines.push(`- [${g.widths.join(", ")}] **${g.check}** \`${g.selector}\` ×${g.count} — ${g.detail}`);
    }
    for (const m of more) lines.push(`- …${m.count} more ${m.check} groups in report.json`);
    const state = /^(.+)~(empty|loading|error)$/.exec(s);
    if (state) {
      const file = `${state[1]}@1280~${state[2]}.png`;
      lines.push("", shots.has(file) ? `[${s}](shots/${file})` : "No screenshot: this state did not run.");
      continue;
    }
    if (!screenIds.includes(s)) continue;
    const links = WIDTHS.filter((w) => shots.has(`${s}@${w}.png`)).map((w) => `[${s}@${w}](shots/${s}@${w}.png)`);
    lines.push("", links.length > 0 ? links.join(" · ") : "No screenshots: this screen did not run.");
  }
  return lines.join("\n") + "\n";
}

export default async function globalTeardown(): Promise<void> {
  let files: string[];
  try {
    files = (await readdir(ISSUES)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  if (files.length === 0) return;
  const shots = new Set(await readdir(SHOTS).catch(() => [] as string[]));
  const issues: Issue[] = [];
  for (const f of files) issues.push(...(JSON.parse(await readFile(join(ISSUES, f), "utf8")) as Issue[]));
  issues.sort((a, b) => cmp(a.screen, b.screen) || cmp(a.width, b.width) || cmp(a.check, b.check) || cmp(a.selector, b.selector));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), JSON.stringify(issues, null, 2));
  await writeFile(join(OUT, "report.md"), renderMarkdown(issues, SCREENS.map((x) => x.id), shots));
}
