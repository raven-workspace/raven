import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import type { Service } from "../../types/service";
import { PASTE_CONTEXTS, type PasteContext } from "./context";
import type { PayloadDef } from "./types";

export type DbEngine = "mssql" | "mysql" | "postgres" | "oracle" | "sqlite";

export interface PayloadSituation {
  os: "linux" | "windows" | null;
  services: { port: number; name: string; product: string }[];
  prompt: "ps" | "cmd" | "sh" | null;
  webShellUrl: string | null;
  tools: { present: string[]; absent: string[] };
  /** Task 6 adds LogEntry.payloadId and fills this from logged payloads marked failed; empty until then. */
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
const PROMPT_SH = /^(?:\S+@\S+.*)?[$#]$/;

function promptOf(output: string): "ps" | "cmd" | "sh" | null {
  const lines = output.split(/\r?\n/).map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (PROMPT_PS.test(l)) return "ps";
    if (PROMPT_CMD.test(l)) return "cmd";
    if (PROMPT_SH.test(l)) return "sh";
  }
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
    const m = /^\s*which\s+(.+?)\s*$/.exec(b.command);
    if (m) {
      const paths = b.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("/"));
      for (const name of m[1].split(/\s+/).filter((a) => !a.startsWith("-"))) {
        found.set(name, paths.some((p) => basename(p) === name));
      }
    }
  }
}

export function inferSituation(input: {
  host: Host | null; services: Service[]; entries: LogEntry[]; examKind: boolean;
}): { situation: PayloadSituation; evidence: Evidence } {
  const { host, services, examKind } = input;
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

  let prompt: PayloadSituation["prompt"] = null;
  const latestCmd = [...entries].reverse().find((e) => e.content.kind === "command");
  if (latestCmd && latestCmd.content.kind === "command") {
    prompt = promptOf(latestCmd.content.blocks.map((b) => b.output).join("\n"));
    if (prompt) evidence.prompt = fromEntry(latestCmd);
  }

  let webShellUrl: string | null = null;
  for (const e of [...entries].reverse()) {
    const texts = e.content.kind === "command" ? e.content.blocks.map((b) => b.command)
      : e.content.kind === "http" ? [e.content.request] : [];
    const m = texts.map((t) => WEBSHELL_RE.exec(t)).find(Boolean);
    if (m) { webShellUrl = m[0]; evidence.webShellUrl = fromEntry(e); break; }
  }

  const found = new Map<string, boolean>();
  for (const e of entries) toolsFromEntry(e, found);
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
      prompt, webShellUrl, tools, failedPayloadIds: [], exam: examKind, dbEngine,
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

/** Tool names a def's `requires` id is looked up as in tools.absent, and the wording used in the reason. */
const REQUIRE_TOOL: Record<string, { lookup: string; label: string } | undefined> = {
  nc: { lookup: "nc", label: "nc" },
  "nc-e": { lookup: "nc.exe", label: "nc with -e" },
  python3: { lookup: "python3", label: "python3" },
  powershell: { lookup: "powershell", label: "PowerShell" },
  bash: { lookup: "bash", label: "bash" },
  php: { lookup: "php", label: "php" },
};

const absentTool = (def: PayloadDef, s: PayloadSituation): string | null => {
  for (const r of def.requires) {
    const t = REQUIRE_TOOL[r];
    if (t && s.tools.absent.includes(t.lookup)) return t.label;
  }
  return null;
};

const EXAM_BANNED = /meterpreter|\bstaged\b|\/shell\/reverse_/i;
const bannedInExam = (d: PayloadDef) =>
  EXAM_BANNED.test([d.id, d.title, d.template, ...(d.notes ?? []), ...d.parts.map((p) => p.token)].join("\n"));

/**
 * Reason precedence when several apply: Wrong OS, then Doesn't work in <context>, then Needs <tool>,
 * then Failed here before, then Not allowed in the exam. Only the first is shown.
 */
function misfitReason(d: PayloadDef, s: PayloadSituation, ctx: PasteContext | null): string | null {
  if (s.os && d.os !== s.os) return `Wrong OS (${s.os})`;
  if (ctx && !d.contexts.includes(ctx)) {
    return `Doesn't work in ${PASTE_CONTEXTS.find((c) => c.id === ctx)?.label ?? ctx}`;
  }
  const tool = absentTool(d, s);
  if (tool) return `Needs ${tool}, which isn't on this box`;
  if (s.failedPayloadIds.includes(d.id)) return "Failed here before";
  if (s.exam && bannedInExam(d)) return "Not allowed in the exam";
  return null;
}

export function rankPayloads(
  defs: PayloadDef[], s: PayloadSituation, ctx: PasteContext | null,
): { fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[] } {
  const fits: { def: PayloadDef; i: number }[] = [];
  const misfits: { def: PayloadDef; reason: string }[] = [];
  defs.forEach((def, i) => {
    const reason = misfitReason(def, s, ctx);
    if (reason) misfits.push({ def, reason });
    else fits.push({ def, i });
  });
  const key = (x: { def: PayloadDef; i: number }) =>
    [ctx && x.def.contexts.includes(ctx) ? 0 : 1, absentTool(x.def, s) ? 1 : 0, x.i] as const;
  fits.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  return { fits: fits.map((f) => f.def), misfits };
}
