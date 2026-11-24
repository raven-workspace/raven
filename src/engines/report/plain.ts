import type { Finding, FindingFile } from "../../types/findings";
import type { LogEntry } from "../../types/log";
import { findingBlocks, inlineMarkdown, labelled } from "./findingText";
import { testedLine, testedNotExploited } from "./coverage";
import { msfLine, PLAIN_TABLE_KINDS, plainTable } from "./plainTables";
import { bold, code, codeBlock, figure, heading, listItem, para, sourced, table, text, textTable } from "./nodes";
import { ADDRESS_COMMAND } from "./proof";
import { isFlag } from "./prove";
import { firstScan, machinesInOrder, PHASE_TITLE, placementPlan, type PlanStep } from "./placement";
import { attackPathRows, portRows, resultLine } from "./tables";
import { blockHash, sourceOf, stamp } from "./stamp";
import { source as src } from "./page/source";
import { reportTargets } from "./targets";
import type { ReportData, ReportMeta, ReportNode, ReportTarget } from "./types";
import { omitted } from "./trim";
import { capitalize, splitAffected } from "./wording";

/**
 * A target written as a plain document (the owner's sample report, §4.1 Quartz): only ordinary editable nodes
 * (headings, paragraphs, flat lists, code blocks, tables, hard breaks) and one `figure` per screenshot (image plus an
 * editable caption). No slots, chips or atoms. Each generated block carries a `source` attr ("entry:<id>:<block>",
 * "finding:<id>:fix", "ports:<hostId>") for Refresh and the checks, and a `gen` attr (`blockHash` of the block as
 * generated) so an owner edit shows; neither prints on the page. Every source is produced by one function here, and
 * `sourceBlocks` regenerates a source through that same function.
 */

/** The node types a plain draft is made of. */
export const PLAIN_NODE_TYPES: readonly string[] = [
  "doc",
  "heading",
  "paragraph",
  "text",
  "hardBreak",
  "list",
  "codeBlock",
  "table",
  "tableRow",
  "tableHeaderCell",
  "tableCell",
  "figure",
];

export const ADDITIONAL_HEADING = "Additional findings (not on the path to root)";
export const TESTED_HEADING = "Also tested";
export const ENUM_HEADING = PHASE_TITLE.enum!;

/** Finding or observation text as blocks (`findingBlocks`: pasted terminal text as code), each code block without the
 *  indent all its lines share (text pasted as an indented block). */
function writtenBlocks(value: string): ReportNode[] {
  return findingBlocks(value).map((b) => {
    if (b.type !== "codeBlock" || !b.content?.[0]?.text) return b;
    const lines = b.content[0].text.split("\n");
    const indent = Math.min(...lines.filter((l) => l.trim() !== "").map((l) => /^[ \t]*/.exec(l)![0].length));
    if (!Number.isFinite(indent) || indent === 0) return b;
    return { ...b, content: [text(lines.map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)![0].length))).join("\n"))] };
  });
}

/** Outputs longer than this are cut for the page (a written report keeps only what proves the step). */
export const PLAIN_MAX_LINES = 12;
const EDGE_LINES = 4;
/** Lines a cut output always keeps: a success mark, an id, an address, a flag, a secret, a changed line of a diff. */
const PROVING_LINE = [
  /\[\+\]/,
  /Pwn3d!/,
  /uid=/,
  /inet \d/,
  /\b[0-9a-f]{32}\b/,
  /password|passwd|BEGIN .*KEY/i,
  // A diff's added or removed line (not its ---/+++ file headers).
  /^[+-](?![+-]{2}\s)\s*\S/,
];

/** An `ip a` interface line ("2: ens3: <…>") or an ipconfig adapter line ("Ethernet adapter Ethernet0:"). */
const INTERFACE_LINE = /^\d+:\s+\S+:\s|^\S.*adapter .*:\s*$/;
/** A line of `ip a` / ifconfig / ipconfig detail under an interface. */
const ADDRESS_DETAIL = /^\s+\S/;

/**
 * The address part of an output cut to the machine's own: each interface line and the detail lines under it go,
 * except the interface that holds `ip` (its interface line and the lines naming the IP). Lines outside an interface's
 * block (hostname, whoami, a flag) stay.
 */
export function ownAddressLines(output: string, ip: string): string {
  const lines = output.split(/\r?\n/);
  const out: string[] = [];
  let block: string[] | null = null;
  const flush = () => {
    if (block && block.some((l) => l.includes(ip))) out.push(block[0], ...block.slice(1).filter((l) => l.includes(ip)));
    block = null;
  };
  for (const line of lines) {
    if (INTERFACE_LINE.test(line)) {
      flush();
      block = [line];
    } else if (block && (ADDRESS_DETAIL.test(line) || line.trim() === "")) block.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/**
 * An output as a written report prints it: trailing blank lines off; one over `PLAIN_MAX_LINES` lines keeps its first
 * and last four and every proving line (`PROVING_LINE`), each gap one "[… N lines omitted …]" line. A command that
 * prints addresses (`ip a`) keeps only the machine's own (`ownAddressLines`) when `ip` is known.
 */
export function trimmedOutput(output: string, command = "", ip: string | null = null): string {
  let body = output.replace(/\s+$/, "");
  if (ip && ADDRESS_COMMAND.test(command)) body = ownAddressLines(body, ip);
  if (body === "") return "";
  const lines = body.split(/\r?\n/);
  if (lines.length <= PLAIN_MAX_LINES) return lines.join("\n");
  const out: string[] = [];
  let gap = 0;
  lines.forEach((line, i) => {
    const keep = i < EDGE_LINES || i >= lines.length - EDGE_LINES || PROVING_LINE.some((re) => re.test(line));
    if (!keep) {
      gap++;
      return;
    }
    if (gap > 0) out.push(omitted(gap));
    gap = 0;
    out.push(line);
  });
  return out.join("\n");
}

/** Words of an nmap script name that only name the protocol ("http-git" is about git). */
const PROTOCOL_WORDS = new Set(["http", "https", "ssh", "ftp", "smb", "smb2", "ms", "sql", "rdp", "ssl", "tls", "nbstat", "rpc"]);

/**
 * A port scan's output cut to its open port lines, plus the `|` script blocks under a port in `findings` (port → the
 * text of the findings about it) whose script name the findings mention ("http-git" under 80 when a finding is about
 * the `.git/` directory). Host keys, titles, headers and other script noise go. Empty when it holds no open port.
 */
export function openPortLines(output: string, findings: ReadonlyMap<number, string> = new Map()): string {
  const out: string[] = [];
  let text: string | null = null;
  let keep = false;
  for (const line of output.split(/\r?\n/)) {
    const port = /^(\d+)\/(?:tcp|udp)\s+open\b/.exec(line);
    if (port) {
      out.push(line);
      text = findings.get(Number(port[1])) ?? null;
      keep = false;
    } else if (line.startsWith("|")) {
      const script = /^\|_? ?([A-Za-z][\w-]*):/.exec(line);
      if (script && text !== null) {
        const words = script[1].toLowerCase().split("-").filter((w) => w.length >= 3 && !PROTOCOL_WORDS.has(w));
        keep = words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text!));
      }
      if (text !== null && keep) out.push(line);
    } else {
      text = null;
      keep = false;
    }
  }
  return out.join("\n");
}

/** An entry's title as a step's sentence: capitalised, ending in ":". */
export function titleSentence(title: string): string {
  const body = title.trim().replace(/[\s.:;,]+$/, "");
  return body === "" ? "Run the following:" : `${capitalize(body)}:`;
}

/** A step's sentence: the owner's observations when written (as written), else the title as a sentence. Never empty. */
function sentenceOf(entry: LogEntry): ReportNode[] {
  const said = entry.observations?.trim() ? writtenBlocks(entry.observations.trim()) : [];
  if (said.length > 0 && said[0].type === "paragraph") return sourced(said, src.entry(entry.id, "observations"));
  return [para(inlineMarkdown(titleSentence(entry.title)), src.entry(entry.id, "title")), ...sourced(said, src.entry(entry.id, "observations"))];
}

/** A flag's sentence: the owner's observations when written, else "Read local.txt:". */
function flagSentence(flag: LogEntry): ReportNode[] {
  if (flag.observations?.trim()) return sourced(writtenBlocks(flag.observations.trim()), src.entry(flag.id, "observations"));
  return [para([text(`Read ${flag.content.kind === "flag" ? flag.content.flagKind : "the"}.txt:`)], src.entry(flag.id, "title"))];
}

/** One step in progress: its blocks, and the outputs it shows (to leave out a flag proof printed already). */
interface Step {
  blocks: ReportNode[];
  shown: string[];
}

/** An entry's evidence as plain blocks: each command (consecutive commands that printed nothing join the next one),
 *  then its trimmed output; an HTTP request and response; a screenshot as a figure; a note as paragraphs. */
function evidence(data: ReportData, entry: LogEntry, step: Step) {
  const c = entry.content;
  const ip = data.hosts.find((h) => entry.hostIds.includes(h.id))?.ip ?? null;
  if (c.kind === "command") {
    let pending: { command: string; at: number }[] = [];
    c.blocks.forEach((b, i) => {
      const command = (b.command ?? "").trim();
      const output = trimmedOutput(b.output ?? "", command, ip);
      if (command !== "") pending.push({ command, at: i });
      if (output === "" && i < c.blocks.length - 1) return;
      if (pending.length > 0) {
        step.blocks.push(codeBlock(pending.map((p) => p.command).join("\n"), { source: src.entryRun(entry.id, pending[0].at, "command") }));
      }
      pending = [];
      if (output !== "") {
        step.blocks.push(codeBlock(output, { source: src.entryRun(entry.id, i, "output") }));
        step.shown.push(b.output ?? "");
      }
    });
  } else if (c.kind === "http") {
    if (c.request.trim()) step.blocks.push(codeBlock(c.request.trim(), { source: src.entry(entry.id, "request") }));
    const response = trimmedOutput(c.response ?? "");
    if (response) {
      step.blocks.push(codeBlock(response, { source: src.entry(entry.id, "response") }));
      step.shown.push(c.response ?? "");
    }
  } else if (c.kind === "screenshot") {
    step.blocks.push(figure(c.attachmentId, c.caption.trim() || entry.title, entry.id));
  } else if (c.kind === "note") {
    step.blocks.push(...sourced(writtenBlocks(c.text), src.entry(entry.id, "note")));
  }
}

/** A pasted prompt line (`ronan@garnet:~$ id`, `root@x:/tmp# id`, `PS C:\x> whoami`): the command, already shown. */
const PROMPT_LINE = /^(?:\S+@\S+?:\S*\s*[$#]|PS [A-Za-z]:\\[^>]*>|\*Evil-WinRM\* PS [^>]*>)\s/;
const linesOf = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Whether a flag's pasted proof is already on the step: every line of it, prompts aside, is a line printed there. */
function printed(proof: string, shown: string[]): boolean {
  const lines = new Set(shown.flatMap(linesOf));
  const own = linesOf(proof).filter((l) => !PROMPT_LINE.test(l));
  return own.length > 0 && own.every((l) => lines.has(l));
}

/** A flag's own evidence in a step: its proof text unless the step already prints it, else its value unless printed;
 *  its picture as a figure. */
function flagEvidence(data: ReportData, entry: LogEntry, step: Step) {
  const c = entry.content;
  if (c.kind !== "flag") return;
  const shown = step.shown.join("\n");
  const proof = c.proof?.trim() ?? "";
  if (proof !== "" && !printed(proof, step.shown)) {
    const ip = data.hosts.find((h) => entry.hostIds.includes(h.id))?.ip ?? null;
    // A pasted proof holds its own commands: `ip a` in it cuts the addresses to the machine's own.
    step.blocks.push(codeBlock(trimmedOutput(proof, proof, ip), { source: src.entry(entry.id, "proof") }));
    step.shown.push(proof);
  } else if (proof === "" && c.value.trim() !== "" && !shown.includes(c.value.trim())) {
    step.blocks.push(codeBlock(c.value.trim(), { source: src.entry(entry.id, "value") }));
    step.shown.push(c.value);
  }
  if (c.attachmentId) step.blocks.push(figure(c.attachmentId, `${c.flagKind}.txt`, entry.id));
}

/** Whether a block is one of an entry's own (`entry:<id>` or `entry:<id>:…`). */
const isEntryBlock = (b: ReportNode, entryId: string) => {
  const source = sourceOf(b);
  return source === `entry:${entryId}` || (source?.startsWith(`entry:${entryId}:`) ?? false);
};

/**
 * An entry whose evidence a step already holds (a flag whose value an output prints) is recorded on the block that
 * holds it, in a hidden `also` attr (entry ids, in order, once each): the block that prints `value`, else the step's
 * last sourced block. So the page still knows the entry is placed (`entryIdsIn`).
 */
function absorb(step: Step, entryId: string, value: string) {
  const textIn = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textIn).join("");
  const lastIndex = (test: (b: ReportNode) => boolean) => step.blocks.reduce((found, b, i) => (test(b) ? i : found), -1);
  let at = lastIndex((b) => b.type === "codeBlock" && value !== "" && textIn(b).includes(value));
  if (at === -1) at = lastIndex((b) => sourceOf(b) !== null);
  if (at === -1) return;
  const b = step.blocks[at];
  const also = Array.isArray(b.attrs?.also) ? (b.attrs.also as string[]) : [];
  if (!also.includes(entryId)) step.blocks[at] = { ...b, attrs: { ...b.attrs, also: [...also, entryId] } };
}

const flagValue = (e: LogEntry) => (e.content.kind === "flag" ? e.content.value.trim() : "");

/**
 * A plan step as the page prints it: its lead's sentence ("Read local.txt:" for a flag), then each entry's evidence in
 * the plan's order. A flag the step doesn't lead is absorbed: its proof is printed unless the step already prints it,
 * and when nothing of its own is printed it is recorded on the block that shows it (`absorb`).
 */
function printStep(data: ReportData, plan: PlanStep): Step {
  const step: Step = { blocks: isFlag(plan.lead) ? flagSentence(plan.lead) : sentenceOf(plan.lead), shown: [] };
  for (const e of plan.entries) {
    if (!isFlag(e)) {
      evidence(data, e, step);
      continue;
    }
    const before = step.blocks.length;
    flagEvidence(data, e, step);
    if (e !== plan.lead && !step.blocks.slice(before).some((b) => isEntryBlock(b, e.id))) absorb(step, e.id, flagValue(e));
  }
  return step;
}

/** A section under a phase heading: its heading, the finding's labelled lines, then its numbered steps. */
interface Section {
  heading: ReportNode;
  header: ReportNode[];
  steps: Step[];
}

/** The finding's labelled lines, as the sample prints them: explanation, fix, severity, exploit code. Empty parts are
 *  left out: the page never holds a placeholder. */
function findingHeader(f: Finding, files: FindingFile[]): ReportNode[] {
  const out: ReportNode[] = [];
  const { affected, explanation } = splitAffected(f.description ?? "");
  const expl = writtenBlocks(explanation);
  if (expl.length > 0) out.push(...sourced(labelled("Vulnerability explanation:", expl), src.finding(f.id, "explanation")));
  const fix = writtenBlocks((f.remediation ?? "").trim());
  if (fix.length > 0) out.push(...sourced(labelled("Vulnerability fix:", fix), src.finding(f.id, "fix")));
  if (f.severity) out.push(para([bold("Severity:"), text(` ${capitalize(f.severity)}`)], src.finding(f.id, "severity")));
  if (affected) out.push(...sourced(labelled("Affected:", [para(inlineMarkdown(affected))]), src.finding(f.id, "affected")));
  out.push(...exploitLines(f, files));
  return out;
}

/** "Exploit code:": the public exploit's URL when used unmodified, the code when modified; the finding's exploit notes
 *  carry on after it. */
function exploitLines(f: Finding, files: FindingFile[]): ReportNode[] {
  const notes = writtenBlocks((f.exploitNotes ?? "").trim());
  const out: ReportNode[] = [];
  const lead = (intro: ReportNode[], blocks: ReportNode[]): ReportNode[] => {
    const [first, ...rest] = blocks;
    if (first?.type === "paragraph") return [para([...intro, text(" "), ...(first.content ?? [])]), ...rest];
    return [para(intro), ...blocks];
  };
  files.forEach((file, i) => {
    const source = src.file(file.id);
    const tail = i === files.length - 1 ? notes : [];
    if (!file.modified) {
      const intro = file.originalUrl ? [text(`Public exploit from ${file.originalUrl}, used without changes.`)] : [code(file.name), text(", used without changes.")];
      out.push(...sourced(labelled("Exploit code:", lead(intro, tail)), source));
    } else {
      const intro = file.originalUrl ? [text(`Modified from ${file.originalUrl}:`)] : [code(file.name), text(":")];
      const body = file.content.trim() ? [codeBlock(file.content.replace(/\s+$/, ""), { language: file.language ?? "", source })] : [];
      out.push(...sourced(labelled("Exploit code:", [para(intro), ...body, ...tail]), source));
    }
  });
  if (files.length === 0 && notes.length > 0) out.push(...sourced(labelled("Exploit code:", notes), src.finding(f.id, "exploit")));
  return out;
}

/** The Result line: "low-privilege shell as `ronan`, then root. local.txt `…`, proof.txt `…`." (`resultLine`). */
function resultParagraph(data: ReportData, target: ReportTarget, hostId: string, meta: ReportMeta): ReportNode | null {
  const line = resultLine(data, target, hostId, meta);
  const content: ReportNode[] = [bold("Result:")];
  if (line.access) {
    const first = data.grants.filter((g) => g.hostId === hostId).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
    const access = first?.level === "user" ? `low-privilege ${line.access}` : line.access;
    content.push(text(" "));
    access.split(/`([^`]*)`/).forEach((t, i) => t !== "" && content.push(i % 2 === 1 ? code(t) : text(t)));
    content.push(text("."));
  }
  line.flags.forEach((f, i) => {
    content.push(text(i === 0 ? " " : ", "), text(`${f.kind}.txt `), code(f.value));
    if (i === line.flags.length - 1) content.push(text("."));
  });
  return content.length > 1 ? para(content, src.result(hostId)) : null;
}

/** An nmap service name as the sample prints it ("ftp" → "FTP"); a product name stays as written. */
const serviceName = (name: string, fromNmap: boolean) => (fromNmap && /^[a-z0-9]{2,6}$/.test(name) ? name.toUpperCase() : name);

/** Port | Service | Version | Notes, the Notes cells empty for the owner. */
function portTable(data: ReportData, hostId: string): ReportNode | null {
  const rows = portRows(data, hostId);
  if (rows.length === 0) return null;
  const nmapNamed = (serviceId: string) => data.services.find((s) => s.id === serviceId)?.confirmedProduct == null;
  return textTable(
    ["Port", "Service", "Version", "Notes"],
    rows.map((r) => [r.port, serviceName(r.service, nmapNamed(r.serviceId)), r.version, ""]),
    src.ports(hostId),
  );
}

/** A host's port scan as a code block, then its open ports (script lines only under a finding's ports). */
function portScan(data: ReportData, hostId: string, scan: LogEntry | undefined): ReportNode[] {
  if (!scan || scan.content.kind !== "command") return [];
  // Script blocks only under the ports a finding is about, and only the ones it mentions (http-git under 80).
  const scripted = new Map<number, string>();
  for (const f of data.findings.filter((x) => x.hostIds.includes(hostId))) {
    for (const s of data.services.filter((x) => x.hostId === hostId && f.serviceIds.includes(x.id))) {
      scripted.set(s.port, `${scripted.get(s.port) ?? ""}\n${f.title}\n${f.description}`);
    }
  }
  const out: ReportNode[] = [];
  scan.content.blocks.forEach((b, i) => {
    if ((b.command ?? "").trim() === "") return;
    out.push(codeBlock(b.command.trim(), { source: src.entryRun(scan.id, i, "command") }));
    const output = openPortLines(b.output ?? "", scripted) || trimmedOutput(b.output ?? "");
    if (output) out.push(codeBlock(output, { source: src.entryRun(scan.id, i, "output") }));
  });
  return out;
}

/** A finding as one Additional findings bullet: "**<title>** (<Severity>): <description>", code runs as code blocks,
 *  then its screenshots that go with the finding itself (`findingFigures`) as figures. */
function additionalItem(f: Finding, figures: ReportNode[] = []): ReportNode {
  const lead = [bold(f.title), text(f.severity ? ` (${capitalize(f.severity)})` : "")];
  const blocks = writtenBlocks(splitAffected(f.description ?? "").explanation);
  const [first, ...rest] = blocks;
  const content =
    first?.type === "paragraph"
      ? [para([...lead, text(": "), ...(first.content ?? [])]), ...rest]
      : [para(blocks.length > 0 ? [...lead, text(":")] : lead), ...blocks];
  return listItem("bullet", [...content, ...figures], src.finding(f.id));
}

/** A machine's heading: "<name> (<IP>)", "<name>" with no IP. Its number is the page's (`targetNumbers`). */
function factsHeading(data: ReportData, hostId: string): ReportNode {
  const host = data.hosts.find((h) => h.id === hostId);
  return heading(1, `${host?.name ?? hostId}${host?.ip ? ` (${host.ip})` : ""}`, src.facts(hostId));
}

/** Also tested: one bullet per thing tried that went nowhere. */
const testedBullets = (data: ReportData, hostId: string): ReportNode[] =>
  testedNotExploited(data, hostId).map((t) => listItem("bullet", [para([text(testedLine(t))])], src.tested(hostId)));

/** An AD set's attack path: a bold "Attack path" line and its Step | From | Technique | To | Access gained table. */
function attackPathBlocks(data: ReportData, hostIds: string[]): ReportNode[] {
  const rows = attackPathRows(data, hostIds);
  if (rows.length === 0) return [];
  const ticked = (value: string) => value.split(/`([^`]*)`/).flatMap((t, i) => (t === "" ? [] : [i % 2 === 1 ? code(t) : text(t)]));
  return [
    para([bold("Attack path")], src.attackPath),
    table(
      ["Step", "From", "Technique", "To", "Access gained"].map((h) => [text(h)]),
      rows.map((r) => [[text(String(r.step))], [text(r.from)], [text(r.technique)], [text(r.to)], ticked(r.access)]),
      src.attackPath,
    ),
  ];
}

/** A finding's screenshots that go with the finding itself, as figures: from the plan of each target holding one of
 *  its machines (`target` first). */
function findingFigures(data: ReportData, target: ReportTarget | null, meta: ReportMeta, f: Finding): ReportNode[] {
  const shots = new Map<string, LogEntry>();
  for (const hostId of f.hostIds) {
    if (!data.hosts.some((h) => h.id === hostId)) continue;
    for (const e of placementPlan(data, targetOf(data, target, meta, hostId)).findingFigures.get(f.id) ?? []) shots.set(e.id, e);
  }
  return [...shots.values()].map((e) => {
    const step: Step = { blocks: [], shown: [] };
    evidence(data, e, step);
    return step.blocks;
  }).flat();
}

/** One machine of the target, in the sample's order. */
function machineBlock(data: ReportData, target: ReportTarget, meta: ReportMeta, hostId: string): ReportNode[] {
  const out: ReportNode[] = [factsHeading(data, hostId)];
  const result = resultParagraph(data, target, hostId, meta);
  if (result) out.push(result);

  const machine = placementPlan(data, target).machines.find((m) => m.hostId === hostId);
  const enumBlocks = [portTable(data, hostId), ...portScan(data, hostId, machine?.scan ?? undefined)].filter((n): n is ReportNode => n !== null);
  if (enumBlocks.length > 0) out.push(heading(2, ENUM_HEADING, src.phase(hostId, "enum")), ...enumBlocks);

  const sections: Section[] = (machine?.sections ?? []).map(({ phase, finding: f, steps }) => {
    const title = PHASE_TITLE[phase]!;
    return {
      heading: heading(2, f ? `${title}: ${f.title}` : title, src.phase(hostId, phase, f?.id)),
      header: f ? [...findingHeader(f, data.findingFiles.filter((ff) => ff.findingId === f.id)), ...findingFigures(data, target, meta, f)] : [],
      steps: steps.map((st) => printStep(data, st)),
    };
  });
  for (const s of sections) {
    out.push(s.heading, ...s.header);
    if (s.steps.length > 0) {
      out.push(para([bold("Steps to reproduce:")], src.phaseSteps(hostId)));
      out.push(...s.steps.map((st) => listItem("ordered", st.blocks)));
    }
  }

  const extra = machine?.additional ?? [];
  if (extra.length > 0) out.push(heading(2, ADDITIONAL_HEADING, src.phase(hostId, "additional")), ...extra.map((f) => additionalItem(f, findingFigures(data, target, meta, f))));

  const tested = testedBullets(data, hostId);
  if (tested.length > 0) out.push(heading(2, TESTED_HEADING, src.phase(hostId, "tested")), ...tested);
  return out;
}

/**
 * A target as a plain document in the order of the sample's §4.1: "<name> (<IP>)", the Result line, Service
 * enumeration (ports table, the scan and its open ports), one heading per finding that enabled a phase ("Initial
 * access: <title>", "Privilege escalation: <title>") with its labelled lines and numbered steps (each step a sentence,
 * the command, its trimmed output, the screenshots that came with it; the flags close their phase), Additional
 * findings as bullets, Also tested. An AD set opens with its attack path, then its machines follow one another.
 * Headings carry no number: the page numbers them (`targetNumbers`). Every sourced block is stamped (`stamp`), the
 * blocks of each step included.
 */
export function buildPlainTarget(data: ReportData, target: ReportTarget, meta: ReportMeta): ReportNode {
  const machines = machinesInOrder(data, target);
  const content = [
    ...(target.kind === "ad-set" ? attackPathBlocks(data, target.hostIds) : []),
    ...machines.flatMap((id) => machineBlock(data, target, meta, id)),
  ];
  const doc = normalize({ type: "doc", content });
  // A step's list item has no source of its own: its blocks are stamped one by one.
  const blocks = stamp(doc.content ?? []).map((b) => (b.type === "list" && !sourceOf(b) ? { ...b, content: stamp(b.content ?? []) } : b));
  return { ...doc, content: blocks };
}

/* ------------------------------------------------------------------ Refresh */

/** Blocks as the page holds them: text normalised, sourced blocks stamped. */
export const finish = (blocks: ReportNode[]): ReportNode[] => stamp(blocks.map(normalize));

/** Every block an entry can put on a page, as a draft step holds them (a flag: "Read local.txt:" and its proof). */
function entryRun(data: ReportData, entry: LogEntry): ReportNode[] {
  const flag = entry.content.kind === "flag";
  const step: Step = { blocks: flag ? flagSentence(entry) : sentenceOf(entry), shown: [] };
  if (flag) flagEvidence(data, entry, step);
  else evidence(data, entry, step);
  return step.blocks;
}

/** One entry's blocks exactly as a draft step holds them: its sentence, then its evidence. Stamped. */
export function entryBlocks(data: ReportData, entry: LogEntry): ReportNode[] {
  return finish(entryRun(data, entry));
}

const ENTRY_SOURCE = /^entry:([^:]+)(?::(?:\d+:(?:command|output)|title|observations|request|response|note|proof|value))?$/;
const FINDING_SOURCE = /^finding:([^:]+)(?::(?:explanation|fix|severity|affected|exploit))?$/;

/** The target a machine belongs to: the page's own, else the report's target holding it, else the machine alone. */
function targetOf(data: ReportData, target: ReportTarget | null, meta: ReportMeta, hostId: string): ReportTarget {
  if (target?.hostIds.includes(hostId)) return target;
  return reportTargets(data, meta).find((t) => t.hostIds.includes(hostId)) ?? { key: hostId, kind: "standalone", hostIds: [hostId] };
}

/** Every block of a source, before the filter: the function that wrote it in the draft. Null when the source is
 *  unknown or its entry, finding, file or host is private or gone. */
function sourceRun(source: string, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode[] | null {
  const [kind, id] = source.split(":");
  const entryMatch = ENTRY_SOURCE.exec(source);
  if (entryMatch) {
    const entry = data.log.find((e) => e.id === entryMatch[1]);
    if (!entry || entry.private) return null;
    // A host's first port scan is printed by Service enumeration, not as a step.
    const scanned = entry.hostIds.filter((h) => firstScan(data, h)?.id === entry.id).flatMap((h) => portScan(data, h, entry));
    return scanned.some((b) => sourceOf(b) === source) ? scanned : entryRun(data, entry);
  }
  const findingMatch = FINDING_SOURCE.exec(source);
  if (findingMatch || source === `file:${id}`) {
    const file = kind === "file" ? data.findingFiles.find((ff) => ff.id === id) : undefined;
    const f = data.findings.find((x) => x.id === (findingMatch ? findingMatch[1] : file?.findingId));
    if (!f) return null;
    return [...findingHeader(f, data.findingFiles.filter((ff) => ff.findingId === f.id)), additionalItem(f, findingFigures(data, target, meta, f))];
  }
  if (source === "msf") return [msfLine(data)];
  const tableKind = PLAIN_TABLE_KINDS.find((k) => source === `table:${k}`);
  if (tableKind) return plainTable(tableKind, data, meta);
  if (source === "attack-path") {
    const set = target?.kind === "ad-set" ? target : reportTargets(data, meta).find((t) => t.kind === "ad-set");
    return set ? attackPathBlocks(data, set.hostIds) : [];
  }
  const hostKinds = ["facts", "result", "ports", "tested"];
  if (!hostKinds.includes(kind) || source !== `${kind}:${id}`) return null;
  if (!data.hosts.some((h) => h.id === id)) return null;
  switch (kind) {
    case "facts":
      return [factsHeading(data, id)];
    case "result":
      return [resultParagraph(data, targetOf(data, target, meta, id), id, meta)].filter((n): n is ReportNode => n !== null);
    case "ports":
      return [portTable(data, id)].filter((n): n is ReportNode => n !== null);
    default:
      return testedBullets(data, id);
  }
}

/**
 * The blocks a source produces, regenerated from the log, findings and files as the draft would write them now, and
 * stamped: one block, or the whole run of a multi-block source (observations, a labelled finding part, the Also tested
 * bullets). Null for `phase:*`, `phase-steps:*`, an unknown source, and a private or deleted entry, finding, file or
 * host: those offer no Refresh.
 */
export function sourceBlocks(source: string, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode[] | null {
  const run = sourceRun(source, data, target, meta);
  if (!run) return null;
  const blocks = run.filter((b) => sourceOf(b) === source);
  return finish(source.startsWith("entry:") ? withAbsorbed(blocks, source, data, target, meta) : blocks);
}

const SENTENCE_SOURCE = /^entry:([^:]+):(?:title|observations)$/;

/** The source Refresh groups a block under: an entry's sentence is one family (`entry:<id>:sentence`), whether the
 *  page holds its title or its observations; every other source is its own. */
export function refreshFamily(source: string): string {
  const m = SENTENCE_SOURCE.exec(source);
  return m ? `entry:${m[1]}:sentence` : source;
}

/**
 * What Refresh puts in place of a run of `source` (`refreshFamily`): an entry's sentence is the sentence the draft
 * writes now (its title, or its observations once written, or both), any other source its `sourceBlocks`. Null when
 * that is nothing: an unknown, private or deleted source, or one that regenerates no block (a result line or port
 * table with nothing to show). Refresh never takes a block away and puts nothing back.
 */
export function refreshBlocks(source: string, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode[] | null {
  const m = SENTENCE_SOURCE.exec(source);
  const blocks = m
    ? [...(sourceBlocks(src.entry(m[1], "title"), data, target, meta) ?? []), ...(sourceBlocks(src.entry(m[1], "observations"), data, target, meta) ?? [])]
    : sourceBlocks(source, data, target, meta);
  return blocks && blocks.length > 0 ? blocks : null;
}

/** A block's source, or "" when it has none. */
export const srcOf = (n: ReportNode) => sourceOf(n) ?? "";

/** An entry's regenerated blocks with the `also` the draft records on them (`absorb`): read off the plan step that
 *  holds the entry in each target holding one of its machines, printed as the draft prints it, block by block in the
 *  run's order. */
function withAbsorbed(blocks: ReportNode[], source: string, data: ReportData, target: ReportTarget | null, meta: ReportMeta): ReportNode[] {
  const id = ENTRY_SOURCE.exec(source)?.[1];
  const entry = data.log.find((e) => e.id === id);
  const found: ReportNode[] = [];
  const walk = (n: ReportNode) => {
    if (sourceOf(n) === source) found.push(n);
    else n.content?.forEach(walk);
  };
  const targets = new Map<string, ReportTarget>();
  for (const hostId of entry?.hostIds ?? []) {
    if (!data.hosts.some((h) => h.id === hostId)) continue;
    const t = targetOf(data, target, meta, hostId);
    targets.set(`${t.kind}:${t.hostIds.join(",")}`, t);
  }
  for (const t of targets.values()) {
    const step = placementPlan(data, t).at(entry!.id)?.step;
    if (step) printStep(data, step).blocks.forEach(walk);
  }
  return blocks.map((b, i) => {
    const also = found[i]?.attrs?.also;
    return Array.isArray(also) && also.length > 0 ? { ...b, attrs: { ...b.attrs, also: [...also] } } : b;
  });
}

/**
 * One entry's blocks as the draft places them (`entryBlocks`), each carrying the `also` the draft records on it: an
 * entry whose evidence one of these blocks already shows (a flag its output prints) is placed with it, never twice.
 */
export function draftedEntryBlocks(data: ReportData, target: ReportTarget, meta: ReportMeta, entry: LogEntry): ReportNode[] {
  const blocks = entryBlocks(data, entry);
  const sources = [...new Set(blocks.map(srcOf).filter((s) => s !== ""))];
  const withAlso = new Map(sources.map((s) => [s, withAbsorbed(blocks.filter((b) => srcOf(b) === s), s, data, target, meta)]));
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    const s = srcOf(b);
    if (!s) return b;
    const i = seen.get(s) ?? 0;
    seen.set(s, i + 1);
    return withAlso.get(s)![i] ?? b;
  });
}

/** A plan step's blocks as the draft prints them, stamped: what a screenshot that illustrates it or goes with its flag
 *  brings to a page that already holds the step (`companionStepAt`). */
export const stepBlocks = (data: ReportData, step: PlanStep): ReportNode[] => finish(printStep(data, step).blocks);

/** A machine's Also tested run as the draft writes it: its heading and its bullets, stamped; empty when it has none. */
export function testedRun(data: ReportData, hostId: string): ReportNode[] {
  const bullets = testedBullets(data, hostId);
  return bullets.length > 0 ? finish([heading(2, TESTED_HEADING, src.phase(hostId, "tested")), ...bullets]) : [];
}

/** Text nodes as ProseMirror stores them: neighbours with the same marks joined, empty ones dropped. */
function normalize(n: ReportNode): ReportNode {
  if (!n.content) return n;
  const out: ReportNode[] = [];
  for (const child of n.content.map(normalize)) {
    if (child.type === "text" && !child.text) continue;
    const last = out[out.length - 1];
    if (child.type === "text" && last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(child.marks ?? [])) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + child.text };
    } else out.push(child);
  }
  return { ...n, content: out };
}

export { blockHash, sourceOf, stamp };
