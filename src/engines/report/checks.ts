import type { Report } from "../../types/report";
import type { Host } from "../../types/host";
import type { AppendixIndex } from "./appendix";
import { suggestMoves } from "./appendix";
import { serviceCoverage } from "./coverage";
import { byTime, evidenceIdsIn } from "./draft";
import { captionOf } from "./figures";
import { expectedFlags, isValidOsid } from "./meta";
import { findFlagInPaste } from "../capture/flag";
import { proofCompanions, proofFacts } from "./proof";
import { provingEntries } from "./prove";
import { msfHosts, msfModules } from "./tools";
import type { CoverageOverride, ReportData, ReportMeta, ReportNode, ReportTarget } from "./types";
import { absoluteClaims, splitAffected } from "./wording";

export type CheckLevel = "fail" | "soft";
export interface Check {
  id: string;
  level: CheckLevel;
  text: string;
  fix?: string;
  /** `nodeIndex` counts the doc's nodes in document order (pre-order, the doc itself excluded). */
  anchor?: { entryId?: string; nodeIndex?: number };
}

export interface TargetChecksInput {
  data: ReportData;
  target: ReportTarget;
  doc: ReportNode;
  meta: ReportMeta;
  appendixRefs: AppendixIndex;
  /** The target's section id: `appendix-ref` matches entry keys exactly against it. */
  sectionId: string;
  /** The section's coverage overrides, by service id. */
  coverage?: Record<string, CoverageOverride>;
}

const SHOT_WINDOW_MS = 5 * 60_000;
const MAX_CAPTION_WORDS = 10;
const WIN_FIX = "whoami && hostname && type C:\\Users\\Administrator\\Desktop\\proof.txt && ipconfig";
const LINUX_FIX = "id; hostname; cat /root/proof.txt; ip addr";

interface Visit {
  node: ReportNode;
  path: string;
  index: number;
  siblings: ReportNode[];
  at: number;
}

function visit(doc: ReportNode): Visit[] {
  const out: Visit[] = [];
  let index = 0;
  const walk = (node: ReportNode, path: string) => {
    const kids = node.content ?? [];
    kids.forEach((child, i) => {
      const p = path === "" ? `${i}` : `${path}.${i}`;
      out.push({ node: child, path: p, index: index++, siblings: kids, at: i });
      walk(child, p);
    });
  };
  walk(doc, "");
  return out;
}

const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join(" ");
const hasText = (n: ReportNode | undefined) => n != null && (n.type === "slot" || n.type === "paragraph") && textOf(n).trim() !== "";
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Each expected flag's proof, read from the flag entry and its companions (`proofCompanions`): the flag's own paste and
 * screenshot, the commands that print its value, the screenshots taken with it.
 */
function proofChecks(host: Host, flags: ("local" | "proof")[], data: ReportData, onPage: Set<string>): Check[] {
  const out: Check[] = [];
  // Raven can't read a screenshot: when one may show what the text doesn't, the host gets one soft line, not one per gap.
  let unreadShot = false;
  for (const flag of flags) {
    const entries = data.log
      .filter((e) => e.kind === "flag" && e.content.kind === "flag" && e.content.flagKind === flag && !e.private && e.hostIds.includes(host.id))
      .sort(byTime);
    const entry = entries.find((e) => onPage.has(e.id));
    if (!entry) {
      // A proof read pasted as a command (no flag entry) still shows the flag on the page.
      if (!readOnPage(data, host.id, flag, onPage)) {
        out.push({ id: `proof-missing:${host.name}:${flag}`, level: "fail", text: `No ${flag}.txt for ${host.name} on the page.` });
      }
      continue;
    }
    const companions = proofCompanions(data, host.id, entry);
    const facts = proofFacts(entry, host, companions);
    const anchor = { entryId: entry.id };
    // One check per flag: with local.txt and proof.txt both expected, the text says which proof falls short.
    const key = `${host.name}:${flag}`;
    const which = `The ${flag}.txt proof for ${host.name}`;
    const fix = host.os === "windows" ? WIN_FIX : LINUX_FIX;
    const soft = (id: string, text: string) => out.push({ id: `${id}:${key}`, level: "soft", text, fix, anchor });
    if (facts.hasScreenshot) {
      if (!facts.showsIp) unreadShot = true;
    } else {
      if (!facts.showsIp) {
        out.push({
          id: `proof-ip:${key}`,
          level: "fail",
          text: `${which} doesn't show ipconfig, ifconfig or ip addr with ${host.ip ?? "its IP"}. Raven can't read the screenshot, so this checks the pasted proof.`,
          fix,
          anchor,
        });
      }
      out.push({ id: `proof-screenshot:${key}`, level: "fail", text: `${which} has no screenshot.`, anchor });
    }
    // A shell's own output (a companion command) shows it came from a shell, whatever was logged before the flag.
    const before = data.log.filter((e) => e.id !== entry.id && e.hostIds.includes(host.id) && byTime(e, entry) < 0).sort(byTime).pop();
    if (before?.kind === "http" && !companions.some((e) => e.kind === "command")) {
      out.push({ id: `proof-web:${key}`, level: "fail", text: `${which} looks like it came from a web request, not an interactive shell.`, anchor });
    }
    // What the text lacks may be in the screenshot: those gaps are only named when there is no screenshot.
    if (!facts.hasScreenshot) {
      if (!facts.showsIdentity) soft("proof-identity", `${which} doesn't show whoami or id.`);
      if (!facts.showsHostname) soft("proof-hostname", `${which} doesn't show hostname.`);
    }
    // Said only when the text shows the folder it read from.
    if (facts.pathKnown && !facts.usualPath) soft("proof-path", `${which} doesn't read the flag from its usual location.`);
  }
  if (unreadShot) {
    out.push({
      id: `proof-shot:${host.name}`,
      level: "soft",
      text: `Raven can't read screenshots; make sure the proof screenshot shows ipconfig and ${host.ip || "the target IP"}.`,
      fix: host.os === "windows" ? WIN_FIX : LINUX_FIX,
    });
  }
  return out;
}

/** Whether a command on the page reads the flag file and prints a flag value (`cat /root/proof.txt` then the hash). */
function readOnPage(data: ReportData, hostId: string, flag: "local" | "proof", onPage: Set<string>): boolean {
  return data.log.some(
    (e) =>
      onPage.has(e.id) &&
      !e.private &&
      e.hostIds.includes(hostId) &&
      e.content.kind === "command" &&
      e.content.blocks.some((b) => findFlagInPaste(`${b.command ?? ""}\n${b.output ?? ""}`)?.flagKind === flag),
  );
}

/** Per-target checks: what would lose OSCP exam points before export. Ids are stable and unique. */
export function targetChecks(input: TargetChecksInput): Check[] {
  const { data, target, doc, meta, appendixRefs, sectionId } = input;
  const out: Check[] = [];
  const nodes = visit(doc);
  const onPage = evidenceIdsIn(doc);
  const hosts = target.hostIds.flatMap((id) => data.hosts.find((h) => h.id === id) ?? []);
  const entryOf = (id: string) => data.log.find((e) => e.id === id);
  // Entries that proved something on one of the target's machines: a screenshot that isn't one came along with a step.
  const proving = new Set(hosts.flatMap((h) => [...provingEntries(data, h.id).keys()]));
  // A flag's companions (the command printing it, its screenshot) are part of the flag's block: no explanation needed.
  const companions = new Set(
    hosts.flatMap((h) =>
      data.log.filter((e) => e.kind === "flag" && !e.private && e.hostIds.includes(h.id)).flatMap((f) => proofCompanions(data, h.id, f).map((c) => c.id)),
    ),
  );

  for (const host of hosts) out.push(...proofChecks(host, expectedFlags(target, host.id, meta), data, onPage));

  const explain: { check: Check; shot: boolean }[] = [];
  const seenEvidence = new Set<string>();
  for (const { node, index, siblings, at } of nodes) {
    if (node.type !== "evidence") continue;
    const rawId = node.attrs?.entryId;
    const entryId = typeof rawId === "string" ? rawId : "";
    const entry = entryId === "" ? undefined : entryOf(entryId);
    const anchor = { entryId, nodeIndex: index };
    if (!entry || entry.private) {
      out.push({ id: entryId === "" ? `gone:node-${index}` : `gone:${entryId}`, level: "fail", text: "A step on the page uses an entry that was deleted or marked private.", anchor });
      continue;
    }
    if (entry.content.kind === "command" && !entry.returnedNothing) {
      const blocks = entry.content.blocks;
      const block = node.attrs?.block;
      const picked = typeof block === "number" ? blocks.slice(block, block + 1) : blocks;
      if (picked.length === 0 || picked.some((b) => (b.output ?? "").trim() === "")) {
        // Soft: downloads (iwr, certutil) and other quiet commands print nothing, and that is fine to show.
        out.push({
          id: `output:${entryId}`,
          level: "soft",
          text: "A command on the page shows no output. Fine if it printed nothing; otherwise paste its output.",
          anchor,
        });
      }
    }
    // The walkthrough explains a step before it: the block above, past only the same step's evidence (the entry's other
    // command blocks, or a screenshot that came along with it). Any other step stops the walk. A flag prints its own
    // label and needs none.
    let lead = at - 1;
    const idAt = (i: number) => (siblings[i]?.type === "evidence" ? siblings[i].attrs?.entryId : undefined);
    const tagsAlong = (id: unknown) => {
      const e = typeof id === "string" ? entryOf(id) : undefined;
      return e?.kind === "screenshot" && !proving.has(e.id);
    };
    const skipEntry = (id: unknown) => {
      while (lead >= 0 && idAt(lead) === id) lead--;
    };
    skipEntry(entryId);
    if (tagsAlong(entryId)) {
      // Past the other screenshots that came along, to the step they came with.
      while (lead >= 0 && tagsAlong(idAt(lead))) lead--;
      if (idAt(lead) !== undefined) skipEntry(idAt(lead));
    }
    if (entry.content.kind !== "flag" && !companions.has(entry.id) && !hasText(siblings[lead])) {
      explain.push({ check: { id: `explain:${entryId}`, level: "soft", text: "A step has no explanation before it.", anchor }, shot: entry.kind === "screenshot" });
    }
    if (entry.content.kind === "screenshot" && !seenEvidence.has(entryId)) {
      if (words(captionOf(node.attrs, entry)) > MAX_CAPTION_WORDS) {
        out.push({ id: `caption:${entryId}`, level: "soft", text: `A screenshot caption is over ${MAX_CAPTION_WORDS} words.`, anchor });
      }
    }
    seenEvidence.add(entryId);
  }
  out.push(...explain.sort((a, b) => Number(b.shot) - Number(a.shot)).map((e) => e.check));

  const shotsOnPage = [...onPage].flatMap((id) => entryOf(id) ?? []).filter((e) => !e.private && (e.kind === "screenshot" || (e.content.kind === "flag" && Boolean(e.content.attachmentId))));
  for (const g of data.grants) {
    const host = hosts.find((h) => h.id === g.hostId);
    if (!host) continue;
    if (!shotsOnPage.some((s) => Math.abs(s.at - g.at) <= SHOT_WINDOW_MS)) {
      out.push({ id: `access-shot:${host.name}:${g.level}`, level: "soft", text: `${host.name} has ${g.level} access with no screenshot of it on the page.` });
    }
  }

  for (const { node, index } of nodes) {
    if (node.type !== "vuln") continue;
    const f = data.findings.find((x) => x.id === node.attrs?.findingId);
    if (!f) {
      out.push({ id: `gone:${String(node.attrs?.findingId ?? `node-${index}`)}`, level: "fail", text: "A finding on the page was deleted.", anchor: { nodeIndex: index } });
      continue;
    }
    const anchor = { nodeIndex: index };
    const problem = (kind: string, text: string) => out.push({ id: `finding:${f.id}:${kind}`, level: "soft", text, anchor });
    if (f.severity == null) problem("severity", `The finding "${f.title}" has no severity.`);
    if (f.title.trim() !== "" && !/\s/.test(f.title.trim())) problem("title", `The finding title "${f.title}" is a single word. Name the vulnerability, not the tool.`);
    if (f.hostIds.length === 0 && f.serviceIds.length === 0) problem("affected", `The finding "${f.title}" has no affected host or service.`);
    // An "Affected: …" line alone is no description.
    if (splitAffected(f.description).explanation === "") problem("description", `The finding "${f.title}" has no description.`);
    if (f.remediation.trim() === "") problem("remediation", `The finding "${f.title}" has no remediation.`);
  }

  let n = 0;
  for (const { node, index } of nodes) {
    if (node.type !== "slot" && node.type !== "paragraph") continue;
    for (const claim of absoluteClaims(textOf(node))) {
      out.push({ id: `wording:${n++}`, level: "soft", text: `"${claim}" is an absolute claim. Say what you tested and what happened instead.`, anchor: { nodeIndex: index } });
    }
  }

  for (const { node, index, siblings, at } of nodes) {
    if (node.type !== "exploit") continue;
    const file = data.findingFiles.find((x) => x.id === node.attrs?.fileId);
    if (!file) {
      out.push({ id: `gone:${String(node.attrs?.fileId ?? `node-${index}`)}`, level: "fail", text: "An exploit file on the page was deleted.", anchor: { nodeIndex: index } });
      continue;
    }
    if (!file.modified) continue;
    const anchor = { nodeIndex: index };
    if (!file.originalUrl?.trim()) {
      out.push({ id: `exploit:${file.id}:url`, level: "fail", text: `The modified exploit ${file.name} has no original URL.`, anchor });
    }
    if (!hasText(siblings[at + 1])) {
      out.push({ id: `exploit:${file.id}:explain`, level: "soft", text: `The modified exploit ${file.name} has no explanation of the changes after it.`, anchor });
    }
    const marked = Array.isArray(node.attrs?.markedLines) ? node.attrs.markedLines : [];
    if (!file.originalContent && marked.length === 0) {
      out.push({ id: `exploit:${file.id}:original`, level: "fail", text: `The modified exploit ${file.name} has no original to compare against and no marked lines.`, anchor });
    }
  }

  for (const host of hosts) {
    for (const row of serviceCoverage(data, host.id, input.coverage ?? {})) {
      if (row.result === "untested") {
        out.push({ id: `coverage:${row.serviceId}`, level: "soft", text: `${row.port}/${row.protocol} on ${host.name} is untested.` });
      }
    }
  }

  for (const { node, path, index } of nodes) {
    const moved = node.attrs?.appendix === "moved" || node.attrs?.appendix === "split";
    if (!moved || !["evidence", "exploit", "generated"].includes(node.type)) continue;
    const key = `${sectionId}:${path}`;
    const exists = appendixRefs.entries.some((e) => e.key === key);
    if (!exists) out.push({ id: `appendix-ref:${key}`, level: "fail", text: "A block moved to an appendix has no appendix entry any more.", anchor: { nodeIndex: index } });
  }

  for (const m of suggestMoves(doc, data)) {
    out.push({ id: `move:${m.key}`, level: "soft", text: `This block is long (${m.reason}). Consider moving it to an appendix.` });
  }

  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.id) && seen.add(c.id));
}

/** A check's kind: its id's first part, or for findings and exploits the problem after the id ("finding-severity"). */
export function checkKind(id: string): string {
  const parts = id.split(":");
  if ((parts[0] === "finding" || parts[0] === "exploit") && parts.length >= 3) return `${parts[0]}-${parts[parts.length - 1]}`;
  return parts[0];
}

/** How a group of `n` checks of one kind reads in the outline. */
const PLURAL: Record<string, (n: number) => string> = {
  "proof-missing": (n) => `${n} flags are not on the page.`,
  "proof-ip": (n) => `${n} proofs don't show ipconfig, ifconfig or ip addr with the target IP.`,
  "proof-screenshot": (n) => `${n} proofs have no screenshot.`,
  "proof-web": (n) => `${n} proofs look like they came from a web request, not an interactive shell.`,
  "proof-identity": (n) => `${n} proofs don't show whoami or id.`,
  "proof-hostname": (n) => `${n} proofs don't show hostname.`,
  "proof-path": (n) => `${n} proofs don't read the flag from its usual location.`,
  "proof-shot": (n) => `Raven can't read screenshots; make sure ${n} proof screenshots show ipconfig and the target IP.`,
  gone: (n) => `${n} blocks on the page use deleted or private content.`,
  output: (n) => `${n} commands on the page show no output.`,
  explain: (n) => `${n} steps have no explanation.`,
  caption: (n) => `${n} screenshot captions are over ${MAX_CAPTION_WORDS} words.`,
  "access-shot": (n) => `${n} access levels have no screenshot of them on the page.`,
  "finding-severity": (n) => `${n} findings have no severity.`,
  "finding-title": (n) => `${n} finding titles are a single word.`,
  "finding-affected": (n) => `${n} findings have no affected host or service.`,
  "finding-description": (n) => `${n} findings have no description.`,
  "finding-remediation": (n) => `${n} findings have no remediation.`,
  wording: (n) => `${n} absolute claims on the page.`,
  "exploit-url": (n) => `${n} modified exploits have no original URL.`,
  "exploit-explain": (n) => `${n} modified exploits have no explanation of the changes after them.`,
  "exploit-original": (n) => `${n} modified exploits have no original and no marked lines.`,
  coverage: (n) => `${n} services are untested.`,
  "appendix-ref": (n) => `${n} moved blocks have no appendix entry any more.`,
  move: (n) => `${n} blocks are long. Consider moving them to an appendix.`,
  legible: (n) => `${n} screenshots are narrower than would print legibly.`,
};

/**
 * How one check of a kind reads in the outline's narrow column: short, the subject first. The check's own text is
 * its full statement (tooltip, picked detail). Kinds not listed read in full (coverage is short already).
 */
const SHORT: Record<string, (c: Check) => string> = {
  "proof-missing": (c) => `No ${part(c, 2)}.txt for ${part(c, 1)}`,
  "proof-ip": (c) => `${part(c, 2)}.txt proof lacks ipconfig`,
  "proof-screenshot": (c) => `${part(c, 2)}.txt proof has no screenshot`,
  "proof-web": (c) => `${part(c, 2)}.txt proof from a web request`,
  "proof-identity": (c) => `${part(c, 2)}.txt proof lacks whoami`,
  "proof-hostname": (c) => `${part(c, 2)}.txt proof lacks hostname`,
  "proof-path": (c) => `${part(c, 2)}.txt read from an odd place`,
  "proof-shot": (c) => `${part(c, 1)}: check ipconfig in the screenshot`,
  gone: () => "Deleted or private entry on the page",
  output: () => "A command shows no output",
  explain: () => "A step has no explanation",
  caption: () => "Caption over 10 words",
  "access-shot": (c) => `${part(c, 1)}: no ${part(c, 2)} screenshot`,
  "finding-severity": () => "A finding has no severity",
  "finding-title": () => "A finding title is one word",
  "finding-affected": () => "A finding has no affected host",
  "finding-description": () => "A finding has no description",
  "finding-remediation": () => "A finding has no remediation",
  wording: () => "An absolute claim",
  "exploit-url": () => "Exploit has no original URL",
  "exploit-explain": () => "Explain the modified exploit",
  "exploit-original": () => "Exploit has no original",
  "appendix-ref": () => "A moved block lost its appendix entry",
  move: (c) => {
    const why = /\(([^)]+)\)/.exec(c.text)?.[1];
    return why ? `Long block (${why})` : "Long block";
  },
  legible: () => "Screenshot too narrow to print",
};

/** The id's n-th ":" part ("proof-ip:ms01:local" → 1 "ms01", 2 "local"). */
const part = (c: Check, n: number) => c.id.split(":")[n] ?? "";

export interface CheckGroup {
  /** The kind the group's checks share. */
  key: string;
  /** Fail when any of its checks fails. */
  level: CheckLevel;
  /** The outline's line: one check's short wording, or several as a count ("12 steps have no explanation."). */
  text: string;
  /** The full statement, for the tooltip: one check's own text, or the count. */
  full: string;
  checks: Check[];
}

/** Checks grouped by kind, one outline row each: failing groups first, otherwise in the order their first check came. */
export function groupChecks(checks: Check[]): CheckGroup[] {
  const groups = new Map<string, Check[]>();
  for (const c of checks) {
    const key = checkKind(c.id);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out = [...groups].map(([key, list]): CheckGroup => ({
    key,
    level: list.some((c) => c.level === "fail") ? "fail" : "soft",
    text: list.length === 1 ? (SHORT[key]?.(list[0]) ?? list[0].text) : (PLURAL[key]?.(list.length) ?? `${list.length} × ${list[0].text}`),
    full: list.length === 1 ? list[0].text : (PLURAL[key]?.(list.length) ?? `${list.length} × ${list[0].text}`),
    checks: list,
  }));
  return [...out.filter((g) => g.level === "fail"), ...out.filter((g) => g.level !== "fail")];
}

/** Report-level checks; `data` feeds the Metasploit check across the targets' hosts. */
export function reportChecks(input: { report: Report; targets: ReportTarget[]; data: ReportData }): Check[] {
  const { report, targets, data } = input;
  const out: Check[] = [];
  if (!report.candidateName.trim() || !report.email.trim() || !report.osid.trim()) {
    out.push({ id: "details", level: "fail", text: "The report is missing your name, email or OSID." });
  }
  if (report.osid.trim() && !isValidOsid(report.osid)) {
    out.push({ id: "osid", level: "fail", text: "The OSID should look like OS-12345." });
  }
  if (targets.length === 0) out.push({ id: "no-targets", level: "fail", text: "The report has no targets." });
  {
    const ids = new Set(targets.flatMap((t) => t.hostIds));
    const hostsWithMsf = new Set(
      [...msfModules(data.log, data.engagement, data.hosts).map((m) => m.hostId), ...msfHosts(data.log, data.engagement, data.hosts)].filter((id) => ids.has(id)),
    );
    if (hostsWithMsf.size > 1) {
      out.push({ id: "msf-many", level: "fail", text: "Metasploit is attributed to more than one host. The exam allows Metasploit against one machine only." });
    }
  }
  return out;
}

/** Ready to export: no failing check remains. */
export function isReady(checks: Check[]): boolean {
  return !checks.some((c) => c.level === "fail");
}
