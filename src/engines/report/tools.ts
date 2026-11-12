import { isMetasploitLine, metasploitHostIds, USE_MODULE } from "../checklist/examRules";
import { firstBinary } from "../library/matcher";
import { NOT_TOOLS, TOOL_CATALOG } from "./toolCatalog";
import type { ToolOverride } from "./types";
import type { Engagement } from "../../types/engagement";
import type { FailedAttempt } from "../../types/findings";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

const blocksOf = (entry: LogEntry) => (entry.content.kind === "command" ? entry.content.blocks : []);
const linesOf = (command: string) =>
  command
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

/** Command segments of a line, split at unquoted `;`, `&&`, `||` and `|`. */
function segments(line: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ";" || ch === "|" || (ch === "&" && line[i + 1] === "&")) {
      out.push(line.slice(from, i));
      if (line[i + 1] === ch) i++;
      from = i + 1;
    }
  }
  out.push(line.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

const CATALOG_BY_BIN = new Map(TOOL_CATALOG.flatMap((t) => t.bins.map((b) => [b, t] as const)));
const PYTHON = new Set(["python", "python2", "python3"]);

/** The tools a command segment runs: its binary, and the command a wrapper (rlwrap) runs. Python counts only when it runs a script. */
function toolsIn(segment: string): string[] {
  const bin = firstBinary(segment);
  if (!bin) return [];
  // A script run directly (`./46153.py`) is the same exploit runner as `python3 46153.py`; Impacket's own scripts
  // (`psexec.py`) are named in the catalog.
  if (/\.py$/.test(bin) && !CATALOG_BY_BIN.has(bin)) return ["python3"];
  if (PYTHON.has(bin)) {
    const script = segment.split(/\s+/).slice(1).find((t) => !t.startsWith("-"));
    return script && /\.py$/i.test(script) && !/(^|\s)-[cm]\b/.test(segment) ? ["python3"] : [];
  }
  if (bin === "rlwrap") {
    const rest = segment.replace(/^\S+\s+(-\S+\s+)*/, "");
    return rest === segment ? [bin] : [bin, ...toolsIn(rest)];
  }
  return [bin];
}

export interface ToolRow {
  /** The name the report prints ("winPEAS"); also the key of its override. */
  tool: string;
  purpose: string;
  url: string;
}

/**
 * The tools of the report's non-private entries (tagged to those hosts, or untagged), each once with its purpose and
 * URL from the catalog, then the owner's overrides; alphabetical. Shell builtins and system commands are left out, and
 * so are entries a private (operator) attempt points at.
 */
export function toolsUsed(
  log: LogEntry[],
  hostIds: string[],
  opts: { attempts?: FailedAttempt[]; overrides?: Record<string, ToolOverride> } = {},
): ToolRow[] {
  const wanted = new Set(hostIds);
  const hidden = new Set((opts.attempts ?? []).filter((a) => a.private || a.reasonKind === "operator").map((a) => a.logEntryId));
  const rows = new Map<string, ToolRow>();
  for (const e of log) {
    if (e.private || hidden.has(e.id)) continue;
    if (e.hostIds.length > 0 && !e.hostIds.some((id) => wanted.has(id))) continue;
    for (const block of blocksOf(e)) {
      for (const line of linesOf(block.command ?? "")) {
        for (const segment of segments(line)) {
          for (const bin of toolsIn(segment)) {
            if (NOT_TOOLS.has(bin)) continue;
            const known = CATALOG_BY_BIN.get(bin);
            const tool = known?.name ?? bin;
            if (!rows.has(tool)) rows.set(tool, { tool, purpose: known?.purpose ?? "", url: known?.url ?? "" });
          }
        }
      }
    }
  }
  return [...rows.values()]
    // An emptied field is no override: the catalog's value comes back.
    .map((r) => {
      const o = opts.overrides?.[r.tool];
      return { ...r, purpose: o?.purpose || r.purpose, url: o?.url || r.url };
    })
    .sort((a, b) => a.tool.toLowerCase().localeCompare(b.tool.toLowerCase()));
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
