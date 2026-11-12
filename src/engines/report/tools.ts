import { isMetasploitLine, metasploitHostIds, USE_MODULE } from "../checklist/examRules";
import { firstBinary } from "../library/matcher";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

const blocksOf = (entry: LogEntry) => (entry.content.kind === "command" ? entry.content.blocks : []);
const linesOf = (command: string) =>
  command
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** The tool at the head of each command line of the report's non-private entries (tagged to those hosts, or untagged), most used first. */
export function toolsUsed(log: LogEntry[], hostIds: string[]): { tool: string; count: number }[] {
  const wanted = new Set(hostIds);
  const counts = new Map<string, number>();
  for (const e of log) {
    if (e.private) continue;
    if (e.hostIds.length > 0 && !e.hostIds.some((id) => wanted.has(id))) continue;
    for (const block of blocksOf(e)) {
      for (const line of linesOf(block.command ?? "")) {
        const tool = firstBinary(line);
        if (tool) counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}

const HANDLER = /(?:^|\/)multi\/handler$/i;

/** Metasploit modules the non-private entries selected with `use <path>`, each with the hosts it is attributed to. */
export function msfModules(
  log: LogEntry[],
  engagement: Engagement,
  hosts: Host[],
): { hostId: string; module: string }[] {
  const seen = new Set<string>();
  const out: { hostId: string; module: string }[] = [];
  for (const e of log) {
    if (e.private) continue;
    const modules: string[] = [];
    for (const block of blocksOf(e)) {
      for (const line of linesOf(block.command ?? "")) {
        if (!isMetasploitLine(line)) continue;
        for (const m of line.matchAll(USE_MODULE)) if (!HANDLER.test(m[1])) modules.push(m[1]);
      }
    }
    if (modules.length === 0) continue;
    for (const hostId of metasploitHostIds(e, engagement, hosts)) {
      for (const module of modules) {
        const key = `${hostId}\0${module}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ hostId, module });
      }
    }
  }
  return out;
}
