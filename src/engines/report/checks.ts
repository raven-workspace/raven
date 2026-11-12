import type { Report } from "../../types/report";
import type { Host } from "../../types/host";
import type { AppendixIndex } from "./appendix";
import { suggestMoves } from "./appendix";
import { serviceCoverage } from "./coverage";
import { byTime, evidenceIdsIn } from "./draft";
import { expectedFlags, isValidOsid } from "./meta";
import { proofFacts } from "./proof";
import { msfModules } from "./tools";
import type { CoverageOverride, ReportData, ReportMeta, ReportNode, ReportTarget } from "./types";
import { absoluteClaims } from "./wording";

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

function proofChecks(host: Host, flags: ("local" | "proof")[], data: ReportData, onPage: Set<string>): Check[] {
  const out: Check[] = [];
  for (const flag of flags) {
    const entries = data.log
      .filter((e) => e.kind === "flag" && e.content.kind === "flag" && e.content.flagKind === flag && !e.private && e.hostIds.includes(host.id))
      .sort(byTime);
    const entry = entries.find((e) => onPage.has(e.id));
    if (!entry) {
      out.push({ id: `proof-missing:${host.name}:${flag}`, level: "fail", text: `No ${flag}.txt for ${host.name} on the page.` });
      continue;
    }
    const facts = proofFacts(entry, host);
    const anchor = { entryId: entry.id };
    // One check per flag: with local.txt and proof.txt both expected, the text says which proof falls short.
    const key = `${host.name}:${flag}`;
    const which = `The ${flag}.txt proof for ${host.name}`;
    const fix = host.os === "windows" ? WIN_FIX : LINUX_FIX;
    if (!facts.showsIp) {
      out.push({
        id: `proof-ip:${key}`,
        level: "fail",
        text: `${which} doesn't show ipconfig, ifconfig or ip addr with ${host.ip ?? "its IP"}. Raven can't read the screenshot, so this checks the pasted proof.`,
        fix,
        anchor,
      });
    }
    if (!facts.hasScreenshot) out.push({ id: `proof-screenshot:${key}`, level: "fail", text: `${which} has no screenshot.`, anchor });
    const before = data.log.filter((e) => e.id !== entry.id && e.hostIds.includes(host.id) && byTime(e, entry) < 0).sort(byTime).pop();
    if (before?.kind === "http") {
      out.push({ id: `proof-web:${key}`, level: "fail", text: `${which} looks like it came from a web request, not an interactive shell.`, anchor });
    }
    const soft = (id: string, text: string) => out.push({ id: `${id}:${key}`, level: "soft", text, fix, anchor });
    if (!facts.showsIdentity) soft("proof-identity", `${which} doesn't show whoami or id.`);
    if (!facts.showsHostname) soft("proof-hostname", `${which} doesn't show hostname.`);
    if (!facts.usualPath) soft("proof-path", `${which} doesn't read the flag from its usual location.`);
  }
  return out;
}

/** Per-target checks: what would lose OSCP exam points before export. Ids are stable and unique. */
export function targetChecks(input: TargetChecksInput): Check[] {
  const { data, target, doc, meta, appendixRefs, sectionId } = input;
  const out: Check[] = [];
  const nodes = visit(doc);
  const onPage = evidenceIdsIn(doc);
  const hosts = target.hostIds.flatMap((id) => data.hosts.find((h) => h.id === id) ?? []);
  const entryOf = (id: string) => data.log.find((e) => e.id === id);

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
        out.push({ id: `output:${entryId}`, level: "fail", text: "A command on the page has no output.", anchor });
      }
    }
    if (!hasText(siblings[at + 1])) {
      explain.push({ check: { id: `explain:${entryId}`, level: "soft", text: "A step has no explanation after it.", anchor }, shot: entry.kind === "screenshot" });
    }
    if (entry.content.kind === "screenshot" && !seenEvidence.has(entryId)) {
      if (words(entry.content.caption) > MAX_CAPTION_WORDS) {
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
    if (f.description.trim() === "") problem("description", `The finding "${f.title}" has no description.`);
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
    const hostsWithMsf = new Set(msfModules(data.log, data.engagement, data.hosts).filter((m) => ids.has(m.hostId)).map((m) => m.hostId));
    if (hostsWithMsf.size > 1) {
      out.push({ id: "msf-many", level: "fail", text: "Metasploit modules are attributed to more than one host. The exam allows Metasploit against one machine only." });
    }
  }
  return out;
}

/** Ready to export: no failing check remains. */
export function isReady(checks: Check[]): boolean {
  return !checks.some((c) => c.level === "fail");
}
