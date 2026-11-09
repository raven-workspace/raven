import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { PASTE_CONTEXTS, type PasteContext } from "./context";
import { failedPayloadIds } from "./memory";
import type { PayloadDef, ToolId } from "./types";

export type DbEngine = "mssql" | "mysql" | "postgres" | "oracle" | "sqlite";

export interface PayloadSituation {
  os: "linux" | "windows" | null;
  services: { port: number; name: string; product: string }[];
  prompt: "ps" | "cmd" | "sh" | null;
  webShellUrl: string | null;
  tools: { present: string[]; absent: string[] };
  /** Payloads logged on this host that returned nothing or errored (memory.ts). */
  failedPayloadIds: string[];
  exam: boolean;
  dbEngine: DbEngine | null;
}

type Evidence = Partial<Record<keyof PayloadSituation, string>>;

const pad = (n: number) => String(n).padStart(2, "0");
const fromEntry = (e: LogEntry) => {
  const d = new Date(e.at);
  return `from your ${pad(d.getHours())}:${pad(d.getMinutes())} log entry`;
};

const WIN_RE = /\b(IIS|Microsoft|Windows)\b/i;
const LIN_RE = /\b(Ubuntu|Debian|Linux|CentOS|Fedora)\b/i;

function osFromServices(services: Service[]): { os: "linux" | "windows"; evidence: string } | null {
  let win: { s: Service; p: string } | null = null;
  let lin: { s: Service; p: string } | null = null;
  for (const s of services) {
    const p = `${s.confirmedProduct ?? ""} ${s.confirmedVersion ?? ""}`.trim() || s.nmapVersion || "";
    if (!win && WIN_RE.test(p)) win = { s, p };
    if (!lin && LIN_RE.test(p)) lin = { s, p };
  }
  if (win && !lin) return { os: "windows", evidence: `from nmap (${win.p} on ${win.s.port})` };
  if (lin && !win) return { os: "linux", evidence: `from nmap (${lin.p} on ${lin.s.port})` };
  return null;
}

const DB_BY_PORT: Record<number, DbEngine> = { 1433: "mssql", 3306: "mysql", 5432: "postgres", 1521: "oracle" };

const PROMPT_PS = /^PS [A-Za-z]:\\.*>$/;
const PROMPT_CMD = /^[A-Za-z]:\\.*>$/;
const PROMPT_SH = [
  /^\S+@\S+:.*[$#]$/, // user@host:path$  root@host:~#
  /^\[\S+@\S+ .*\][$#]$/, // [user@host dir]$
  /^(?:ba|z|da|k)?sh-[\d.]+[$#]$/, // bash-5.1$  sh-4.4$
];

/** Only the last non-empty line counts, and it must have a real prompt shape. */
function promptOf(output: string): "ps" | "cmd" | "sh" | null {
  const last = output.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).pop();
  if (!last) return null;
  if (PROMPT_PS.test(last)) return "ps";
  if (PROMPT_CMD.test(last)) return "cmd";
  if (PROMPT_SH.some((r) => r.test(last))) return "sh";
  return null;
}

const WEBSHELL_RE = /https?:\/\/[^\s'"]*?[?&](?:cmd|exec|command)=/i;

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const normTool = (n: string) => n.replace(/^(nc|ncat)\.(openbsd|traditional)$/, "nc");

function toolsFromEntry(e: LogEntry, found: Map<string, boolean>) {
  if (e.content.kind !== "command") return;
  for (const b of e.content.blocks) {
    let inUseful = false;
    for (const raw of b.output.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^[╔═]/.test(line)) { inUseful = /Useful software/i.test(line); continue; }
      if (inUseful && line.startsWith("/")) found.set(normTool(basename(line)), true);
    }
    const names: string[] = [];
    // Drop redirections (2>/dev/null), then split compound commands at ; | & < >.
    for (const seg of b.command.replace(/\d*>+\S*/g, ";").split(/[;|&<>]+/)) {
      const m = /^\s*which\s+(.+?)\s*$/.exec(seg);
      if (m) names.push(...m[1].split(/\s+/).filter((a) => /^[\w.+-]+$/.test(a) && !a.startsWith("-")));
    }
    if (names.length) {
      const paths = b.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("/"));
      for (const name of names) found.set(name, paths.some((p) => basename(p) === name));
    }
  }
}

export function inferSituation(input: {
  host: Host | null; services: Service[]; entries: LogEntry[]; examKind: boolean;
}): { situation: PayloadSituation; evidence: Evidence } {
  const { host, examKind } = input;
  const services = input.services.filter((s) => s.state.toLowerCase() === "open");
  const evidence: Evidence = {};
  const entries = input.entries
    .filter((e) => !host || e.hostIds.includes(host.id))
    .sort((a, b) => a.at - b.at);

  let os: PayloadSituation["os"] = null;
  if (host?.os === "windows" || host?.os === "linux") {
    os = host.os;
    evidence.os = "from the host's OS";
  } else {
    const g = osFromServices(services);
    if (g) { os = g.os; evidence.os = g.evidence; }
  }

  let dbEngine: DbEngine | null = null;
  for (const s of services) {
    if (DB_BY_PORT[s.port]) {
      dbEngine = DB_BY_PORT[s.port];
      evidence.dbEngine = `from nmap (${s.nmapService ?? dbEngine} on ${s.port})`;
      break;
    }
  }

  // Ran on this box only if ranOn is blank or the host's name; anything else ran on an attacker machine.
  const onBox = entries.filter((e) => !e.ranOn || (host !== null && e.ranOn === host.name));

  let prompt: PayloadSituation["prompt"] = null;
  for (const e of [...onBox].reverse()) {
    if (e.content.kind !== "command") continue;
    const p = promptOf(e.content.blocks.map((b) => b.output).join("\n"));
    if (p) { prompt = p; evidence.prompt = fromEntry(e); break; }
  }

  let webShellUrl: string | null = null;
  for (const e of [...entries].reverse()) {
    const texts = e.content.kind === "command" ? e.content.blocks.map((b) => b.command)
      : e.content.kind === "http" ? [e.content.request] : [];
    const m = texts.map((t) => WEBSHELL_RE.exec(t)).find(Boolean);
    if (m) { webShellUrl = m[0]; evidence.webShellUrl = fromEntry(e); break; }
  }

  const found = new Map<string, boolean>();
  for (const e of onBox) toolsFromEntry(e, found);
  const tools = {
    present: [...found].filter(([, v]) => v).map(([k]) => k),
    absent: [...found].filter(([, v]) => !v).map(([k]) => k),
  };

  return {
    situation: {
      os,
      services: services.map((s) => ({
        port: s.port, name: s.nmapService ?? "",
        product: s.confirmedProduct ?? s.nmapVersion ?? "",
      })),
      prompt, webShellUrl, tools, failedPayloadIds: host ? failedPayloadIds(entries, host.id) : [], exam: examKind, dbEngine,
    },
    evidence,
  };
}

export function inferContext(s: PayloadSituation): PasteContext | null {
  if (s.prompt === "ps") return "powershell";
  if (s.prompt === "cmd") return "cmd";
  if (s.prompt === "sh") return "bash-prompt";
  if (s.webShellUrl) return "webshell-param";
  return null;
}

export interface Toggles {
  /** The owner says callbacks can't get out: reverse payloads are marked, binds come first. */
  callbacksBlocked: boolean;
  /** The owner's ticks; they win over inferredTools. */
  tools: Partial<Record<ToolId, "present" | "missing">>;
}

const NO_TOGGLES: Toggles = { callbacksBlocked: false, tools: {} };

export const TOOL_LABEL: Record<ToolId, string> = {
  bash: "bash", python3: "python3", perl: "perl", nc: "nc", "nc-e": "nc with -e", socat: "socat",
  powershell: "PowerShell", curl: "curl", wget: "wget",
};

/** The tool name inferSituation sees for a ToolId: nc.exe stands for nc with -e; the rest go by name. */
const TOOL_NAME: Record<ToolId, string> = {
  bash: "bash", python3: "python3", perl: "perl", nc: "nc", "nc-e": "nc.exe", socat: "socat",
  powershell: "powershell", curl: "curl", wget: "wget",
};

export function inferredTools(s: PayloadSituation): Partial<Record<ToolId, "present" | "missing">> {
  const out: Partial<Record<ToolId, "present" | "missing">> = {};
  for (const id of Object.keys(TOOL_NAME) as ToolId[]) {
    if (s.tools.present.includes(TOOL_NAME[id])) out[id] = "present";
    else if (s.tools.absent.includes(TOOL_NAME[id])) out[id] = "missing";
  }
  return out;
}

const isTool = (r: string): r is ToolId => r in TOOL_LABEL;
const isReverse = (d: PayloadDef) => d.shape === undefined;

/**
 * Only a wrong OS or a context the def does not work in folds a payload, in that precedence; only the first is shown.
 * Toggles, inferred tools and failure memory never fold: they are marks (see marksFor).
 */
function misfitReason(d: PayloadDef, s: PayloadSituation, ctx: PasteContext | null): string | null {
  if (s.os && d.os !== "any" && d.os !== s.os) return `Wrong OS (${s.os})`;
  if (ctx && !d.contexts.includes(ctx)) {
    return `Doesn't work in ${PASTE_CONTEXTS.find((c) => c.id === ctx)?.label ?? ctx}`;
  }
  return null;
}

/**
 * Marks, in order: Needs a callback (a reverse payload, only when callbacks are blocked), Needs <tool> for each required
 * tool that is missing (owner ticks over inference; php from inference only; awk, busybox and served-file never), and
 * Failed here before. A marked payload sorts down but stays a fit.
 */
function marksFor(d: PayloadDef, s: PayloadSituation, toggles: Toggles, tools: Partial<Record<ToolId, "present" | "missing">>): string[] {
  const out: string[] = [];
  if (toggles.callbacksBlocked && isReverse(d)) out.push("Needs a callback");
  for (const r of d.requires) {
    if (isTool(r) && tools[r] === "missing") out.push(`Needs ${TOOL_LABEL[r]}`);
    else if (r === "php" && s.tools.absent.includes("php")) out.push("Needs php");
  }
  if (s.failedPayloadIds.includes(d.id)) out.push("Failed here before");
  return out;
}

/**
 * Spec §4.2, the open services' payload: IIS → the ASPX, Tomcat → the WAR, Apache httpd or PHP → php-exec among the
 * reverse shells (no msfvenom change). Tomcat's "Apache Tomcat" is not Apache httpd.
 */
const SERVICE_PREFERENCE: { test: RegExp; ids: string[] }[] = [
  { test: /\bIIS\b/i, ids: ["msf-win-x64-aspx"] },
  { test: /Tomcat|Coyote/i, ids: ["msf-java-war"] },
  { test: /Apache httpd|\bPHP\b/i, ids: ["php-exec"] },
];
function preferredIds(s: PayloadSituation): Set<string> {
  const out = new Set<string>();
  for (const svc of s.services) {
    const text = `${svc.name} ${svc.product}`;
    for (const p of SERVICE_PREFERENCE) if (p.test.test(text)) for (const id of p.ids) out.add(id);
  }
  return out;
}

export function rankPayloads(
  defs: PayloadDef[], s: PayloadSituation, ctx: PasteContext | null, toggles: Toggles = NO_TOGGLES,
): { fits: PayloadDef[]; marks: Record<string, string[]>; misfits: { def: PayloadDef; reason: string }[] } {
  // Order: with callbacks blocked, binds first; then unmarked defs, the open services' preferred payload first (a soft
  // key: it never folds anything); then marked defs. Catalogue order within each group.
  const tools = { ...inferredTools(s) };
  for (const [k, v] of Object.entries(toggles.tools) as [ToolId, "present" | "missing" | undefined][]) if (v) tools[k] = v;
  const fits: PayloadDef[] = [];
  const marks: Record<string, string[]> = {};
  const misfits: { def: PayloadDef; reason: string }[] = [];
  for (const def of defs) {
    const reason = misfitReason(def, s, ctx);
    if (reason) { misfits.push({ def, reason }); continue; }
    fits.push(def);
    const m = marksFor(def, s, toggles, tools);
    if (m.length > 0) marks[def.id] = m;
  }
  const preferred = preferredIds(s);
  const bindFirst = (d: PayloadDef) => toggles.callbacksBlocked && d.shape === "bind";
  // Marked defs keep catalogue order: the service preference only lifts unmarked ones.
  const rank = (d: PayloadDef) => (bindFirst(d) ? 0 : 1) * 4 + (marks[d.id] ? 2 : preferred.has(d.id) ? 0 : 1);
  // Array.prototype.sort is stable, so ties keep catalogue order.
  return { fits: [...fits].sort((a, b) => rank(a) - rank(b)), marks, misfits };
}

/** A hint when two or more reverse payloads in `defs` already failed on this host: maybe callbacks can't get out. */
export function callbackClue(s: PayloadSituation, defs: PayloadDef[]): string | null {
  const reverse = new Set(defs.filter(isReverse).map((d) => d.id));
  const n = new Set(s.failedPayloadIds.filter((id) => reverse.has(id))).size;
  if (n < 2) return null;
  return n === 2 ? "Callbacks failed here twice" : `Callbacks failed here ${n} times`;
}
