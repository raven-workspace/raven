import type { Report } from "../../types/report";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { suggestMoves } from "./appendix";
import { serviceCoverage } from "./coverage";
import { isWeakCaption } from "./figures";
import { expectedFlags, isValidOsid } from "./meta";
import { findFlagInPaste } from "../capture/flag";
import { byTime } from "./draft";
import { entryIdsIn } from "./plain";
import { proofCompanions, proofFacts } from "./proof";
import { sourceOf } from "./stamp";
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
  /** The target's section id, for the ids of the checks anchored to a path in the page. */
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
  parent: ReportNode;
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
      out.push({ node: child, path: p, index: index++, parent: node, siblings: kids, at: i });
      walk(child, p);
    });
  };
  walk(doc, "");
  return out;
}

const textOf = (n: ReportNode): string => (n.text ?? "") + (n.content ?? []).map(textOf).join(" ");
const hasText = (n: ReportNode | undefined) => n != null && n.type === "paragraph" && textOf(n).trim() !== "";
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The entry a block's source names (`entry:<id>…`), or null. */
const entryOfSource = (node: ReportNode): string | null => /^entry:([^:]+)/.exec(sourceOf(node) ?? "")?.[1] ?? null;
/** The entry id a figure shows, or "". */
const figureEntry = (node: ReportNode): string => (node.type === "figure" && typeof node.attrs?.entryId === "string" ? node.attrs.entryId : "");
const hasKind = (n: ReportNode, types: string[]): boolean => (n.content ?? []).some((c) => types.includes(c.type) || hasKind(c, types));
/** The first block with a source at or under a node. */
const firstSourced = (n: ReportNode): ReportNode | undefined => {
  if (sourceOf(n)) return n;
  for (const c of n.content ?? []) {
    const found = firstSourced(c);
    if (found) return found;
  }
  return undefined;
};

const isOrdered = (n: ReportNode) => n.type === "list" && n.attrs?.kind === "ordered";
/** A step is an ordered list item that is not itself nested in an ordered list. */
const isStep = (n: ReportNode, parent: ReportNode) => isOrdered(n) && !isOrdered(parent);

/**
 * The checks on numbered steps (an ordered list item): a step whose first child is not a sentence is unexplained; a
 * step with the owner's words and no command, output or screenshot under it can't be replayed (a note step is prose
 * already). Both are anchored to the step; the replay check names its number and heading.
 */
function stepChecks(nodes: Visit[], sectionId: string): Check[] {
  const out: Check[] = [];
  // Screenshots without supporting text are listed first: a step whose first sourced block is a figure.
  const explain: { check: Check; shot: boolean }[] = [];
  let h1 = "";
  let h2 = "";
  let n = 0;
  for (const { node, parent, path, index } of nodes) {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 1);
      if (level === 1) {
        h1 = textOf(node).trim();
        h2 = "";
        n = 0;
      } else if (level === 2) {
        h2 = textOf(node).trim();
        n = 0;
      }
      continue;
    }
    if (!isStep(node, parent)) continue;
    n++;
    const lead = firstSourced(node);
    const entryId = lead ? (entryOfSource(lead) ?? "") : "";
    const anchor = { entryId: entryId === "" ? undefined : entryId, nodeIndex: index };
    const sentence = node.content?.[0];
    if (!hasText(sentence)) {
      explain.push({ check: { id: `explain:${entryId === "" ? `node-${index}` : entryId}`, level: "soft", text: "A step has no explanation before it.", anchor }, shot: lead?.type === "figure" });
      continue;
    }
    if (!hasKind(node, ["codeBlock", "figure"]) && !sourceOf(lead ?? node)?.endsWith(":note")) {
      out.push({
        id: `step-replay:${sectionId}:${path}`,
        level: "soft",
        text: `Step ${n} of ${h2 || h1 || "this page"} has no command or output under it, so a reader can't replay it. Add it from the log column`,
        anchor,
      });
    }
  }
  return [...explain.sort((x, y) => Number(y.shot) - Number(x.shot)).map((e) => e.check), ...out];
}

/**
 * Credentials that moved you (§10.6): one found on a machine (`sourceHostId`) that got you onto another, by an access
 * grant for its username or a hop whose via names it, with no finding on either machine that names the username or has
 * that grant's or hop's entry as a step. Names the user, never the secret.
 */
function credentialChecks(data: ReportData, hosts: Host[]): Check[] {
  const out: Check[] = [];
  const nameOf = (id: string) => data.hosts.find((h) => h.id === id)?.name ?? id;
  // The username as a whole word, any case: "admin" is not in "Administrator", "sa" is not in "salvador".
  const mentions = (text: string, user: string) =>
    new RegExp(`(?<![\\w])${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i").test(text);
  for (const c of data.credentials) {
    const user = c.username.trim();
    if (user === "" || !c.sourceHostId) continue;
    const moves: { hostId: string; entryId: string | null }[] = [
      ...data.grants
        .filter((g) => data.usernames.find((u) => u.id === g.usernameId)?.username.toLowerCase() === user.toLowerCase())
        .map((g) => ({ hostId: g.hostId, entryId: g.logEntryId })),
      ...data.hops.filter((h) => mentions(h.via, user)).map((h) => ({ hostId: h.toHostId, entryId: h.logEntryId })),
    ];
    for (const move of moves) {
      if (move.hostId === c.sourceHostId || !hosts.some((h) => h.id === move.hostId)) continue;
      const covered = data.findings.some(
        (f) =>
          (f.hostIds.includes(move.hostId) || f.hostIds.includes(c.sourceHostId!)) &&
          ((move.entryId != null && f.stepEntryIds.includes(move.entryId)) || mentions([f.title, f.description ?? "", f.remediation].join("\n"), user)),
      );
      if (covered) continue;
      out.push({
        id: `cred-finding:${c.id}:${move.hostId}`,
        level: "soft",
        text: `${user}'s credential from ${nameOf(c.sourceHostId)} got you onto ${nameOf(move.hostId)}, but no finding covers it. A credential that lets you move is a finding too`,
      });
    }
  }
  return out;
}

/**
 * Each expected flag's proof, read from the flag entry and its companions (`proofCompanions`): the flag's own paste and
 * screenshot, the commands that print its value, the screenshots taken with it.
 */
function proofChecks(host: Host, flags: ("local" | "proof")[], data: ReportData, onPage: Set<string>): Check[] {
  const out: Check[] = [];
  for (const flag of flags) {
    const entries = data.log
      .filter((e) => e.kind === "flag" && e.content.kind === "flag" && e.content.flagKind === flag && !e.private && e.hostIds.includes(host.id))
      .sort(byTime);
    // The flag entry on the page; else a proof read pasted as a command (no flag entry on the page), checked as the
    // proof with its own companions.
    const entry = entries.find((e) => onPage.has(e.id)) ?? readOnPage(data, host.id, flag, onPage);
    if (!entry) {
      out.push({ id: `proof-missing:${host.name}:${flag}`, level: "fail", text: `No ${flag}.txt for ${host.name} on the page.` });
      continue;
    }
    const companions = proofCompanions(data, host.id, entry);
    const facts = proofFacts(entry, host, companions);
    // Another of the host's entries for this flag on the page may carry the screenshot (the text and the picture
    // logged apart).
    if (entries.some((e) => e.id !== entry.id && onPage.has(e.id) && e.content.kind === "flag" && e.content.attachmentId)) facts.hasScreenshot = true;
    const anchor = { entryId: entry.id };
    // One check per flag: with local.txt and proof.txt both expected, the text says which proof falls short.
    const key = `${host.name}:${flag}`;
    const which = `The ${flag}.txt proof for ${host.name}`;
    const fix = host.os === "windows" ? WIN_FIX : LINUX_FIX;
    const soft = (id: string, text: string) => out.push({ id: `${id}:${key}`, level: "soft", text, fix, anchor });
    if (facts.hasScreenshot) {
      // Raven can't read a screenshot: when it may show what the text doesn't, one soft line for the proof, not one per gap.
      if (!facts.showsIp) {
        const ipCommand = host.os === "windows" ? "ipconfig" : "ip a or ifconfig";
        soft("proof-shot", `Raven can't read screenshots; make sure the ${flag}.txt screenshot for ${host.name} shows ${ipCommand} with ${host.ip || "its IP"}.`);
      }
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
    const before = data.log.filter((e) => e.id !== entry.id && !e.private && e.hostIds.includes(host.id) && byTime(e, entry) < 0).sort(byTime).pop();
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
  return out;
}

/**
 * A command on the page that reads the flag file and prints a flag value (`cat /root/proof.txt` then the hash), the
 * first in time, as the flag entry it stands for: its value, its terminal text as the proof, no screenshot of its own.
 */
function readOnPage(data: ReportData, hostId: string, flag: "local" | "proof", onPage: Set<string>): LogEntry | undefined {
  for (const e of data.log.filter((x) => onPage.has(x.id) && !x.private && x.hostIds.includes(hostId)).sort(byTime)) {
    if (e.content.kind !== "command") continue;
    const blocks = e.content.blocks.map((b) => `${b.command ?? ""}\n${b.output ?? ""}`);
    const found = blocks.map(findFlagInPaste).find((f) => f?.flagKind === flag);
    if (found) return { ...e, content: { kind: "flag", flagKind: flag, value: found.value, proof: blocks.join("\n"), attachmentId: null } } as LogEntry;
  }
  return undefined;
}

/** Under this natural width a screenshot is upscaled or tiny at page width (spec §6.5). */
const MIN_PRINT_WIDTH = 600;

/**
 * Soft checks for screenshots on the page whose loaded image (`widths`, natural px by entry id) is too narrow to print
 * legibly, each named by the caption the page prints.
 */
export function legibilityChecks(doc: ReportNode, data: ReportData, widths: Record<string, number>): Check[] {
  const out: Check[] = [];
  for (const { node } of visit(doc)) {
    const id = figureEntry(node);
    const width = widths[id];
    if (id === "" || width === undefined || width >= MIN_PRINT_WIDTH || out.some((c) => c.id === `legible:${id}`)) continue;
    const entry = data.log.find((e) => e.id === id);
    if (!entry || entry.private) continue;
    const name = textOf(node).trim() || "A screenshot";
    out.push({
      id: `legible:${id}`,
      level: "soft",
      text: `The screenshot "${name}" is narrower than would print legibly. Retake it larger or crop it tighter.`,
      anchor: { entryId: id },
    });
  }
  return out;
}

/** Per-target checks: what would lose OSCP exam points before export. Ids are stable and unique. */
export function targetChecks(input: TargetChecksInput): Check[] {
  const { data, target, doc, meta, sectionId } = input;
  const out: Check[] = [];
  const nodes = visit(doc);
  const onPage = entryIdsIn(doc);
  const hosts = target.hostIds.flatMap((id) => data.hosts.find((h) => h.id === id) ?? []);
  const entryOf = (id: string) => data.log.find((e) => e.id === id);
  for (const host of hosts) out.push(...proofChecks(host, expectedFlags(target, host.id, meta), data, onPage));

  // A block from a private or deleted entry: the words or picture on the page may be what was hidden or meant to go.
  // One check per entry, at its first block. A command block with no output block of its entry after it (before that
  // entry's next command block) is soft, per block.
  const seenEntry = new Set<string>();
  /** Per entry, the command block still waiting for an output block: its block number and node index. */
  const waiting = new Map<string, { block: string; index: number }>();
  const silent: { id: string; block: string; index: number }[] = [];
  for (const { node, index } of nodes) {
    const source = sourceOf(node) ?? "";
    const cmd = /^entry:([^:]+):(\d+):command$/.exec(source);
    if (cmd) {
      const was = waiting.get(cmd[1]!);
      if (was) silent.push({ id: cmd[1]!, ...was });
      waiting.set(cmd[1]!, { block: cmd[2]!, index });
    }
    const res = /^entry:([^:]+):\d+:output$/.exec(source)?.[1];
    if (res) waiting.delete(res);
    const id = figureEntry(node) || entryOfSource(node) || "";
    if (id === "" || seenEntry.has(id)) continue;
    seenEntry.add(id);
    const entry = entryOf(id);
    if (entry && !entry.private) continue;
    out.push(
      entry
        ? { id: `copied-private:${id}`, level: "fail", text: "A block on the page comes from an entry that is now private.", anchor: { nodeIndex: index } }
        : { id: `copied-deleted:${id}`, level: "fail", text: "A block on the page comes from an entry that was deleted.", anchor: { nodeIndex: index } },
    );
  }
  for (const [id, was] of waiting) silent.push({ id, ...was });
  for (const { id, block, index } of silent.sort((a, b) => a.index - b.index)) {
    const entry = entryOf(id);
    if (!entry || entry.private || entry.content.kind !== "command" || entry.returnedNothing) continue;
    // Soft: downloads (iwr, certutil) and other quiet commands print nothing, and that is fine to show.
    out.push({ id: `output:${id}:${block}`, level: "soft", text: "A command on the page shows no output. Fine if it printed nothing; otherwise paste its output.", anchor: { entryId: id, nodeIndex: index } });
  }

  // A finding or file that was deleted: one check per id, at its first block.
  const goneSeen = new Set<string>();
  for (const { node, index } of nodes) {
    const source = sourceOf(node) ?? "";
    const finding = /^finding:([^:]+)/.exec(source)?.[1];
    const file = /^file:(.+)$/.exec(source)?.[1];
    const id = finding ?? file;
    if (!id || goneSeen.has(id)) continue;
    goneSeen.add(id);
    const exists = finding ? data.findings.some((f) => f.id === finding) : data.findingFiles.some((f) => f.id === file);
    if (!exists) out.push({ id: `gone:${id}`, level: "fail", text: "A finding or file on the page was deleted.", anchor: { nodeIndex: index } });
  }

  out.push(...stepChecks(nodes, sectionId));

  const seenFigure = new Set<string>();
  for (const { node, index } of nodes) {
    const entryId = figureEntry(node);
    const entry = entryId === "" ? undefined : entryOf(entryId);
    if (!entry || entry.private || seenFigure.has(entryId)) continue;
    seenFigure.add(entryId);
    const caption = textOf(node).trim();
    const anchor = { entryId, nodeIndex: index };
    if (isWeakCaption(caption)) out.push({ id: `caption-weak:${entryId}`, level: "soft", text: "A screenshot has no caption of its own. Say what it shows.", anchor });
    if (words(caption) > MAX_CAPTION_WORDS) out.push({ id: `caption:${entryId}`, level: "soft", text: `A screenshot caption is over ${MAX_CAPTION_WORDS} words.`, anchor });
  }
  out.push(...credentialChecks(data, hosts));

  const shotIds = new Set([...seenFigure, ...[...onPage].filter((id) => { const e = entryOf(id); return e?.content.kind === "flag" && Boolean(e.content.attachmentId); })]);
  const shotsOnPage = [...shotIds].flatMap((id) => entryOf(id) ?? []).filter((e) => !e.private && (e.kind === "screenshot" || (e.content.kind === "flag" && Boolean(e.content.attachmentId))));
  for (const g of data.grants) {
    const host = hosts.find((h) => h.id === g.hostId);
    if (!host) continue;
    // Only the host's own screenshots show its access. A grant is often recorded long after the shell: its linked
    // step's time is when access came; with no step linked, any screenshot from the host's first access step on counts.
    const shots = shotsOnPage.filter((s) => s.hostIds.includes(host.id));
    const step = g.logEntryId ? entryOf(g.logEntryId) : undefined;
    const firstAccess = Math.min(
      ...data.grants.filter((x) => x.hostId === host.id).flatMap((x) => (x.logEntryId ? [entryOf(x.logEntryId)?.at ?? Infinity] : [])),
      ...data.hops.filter((h) => h.toHostId === host.id).flatMap((h) => (h.logEntryId ? [entryOf(h.logEntryId)?.at ?? Infinity] : [])),
      Infinity,
    );
    const shown = step
      ? shots.some((s) => Math.abs(s.at - step.at) <= SHOT_WINDOW_MS)
      : shots.some((s) => firstAccess === Infinity || s.at >= firstAccess);
    if (!shown) {
      out.push({ id: `access-shot:${host.name}:${g.level}`, level: "soft", text: `${host.name} has ${g.level} access with no screenshot of it on the page.` });
    }
  }

  // Findings named by any `finding:<id>…` block, checked once, anchored at the first.
  const checkedFindings = new Set<string>();
  for (const { node, index } of nodes) {
    const id = /^finding:([^:]+)/.exec(sourceOf(node) ?? "")?.[1];
    const f = id ? data.findings.find((x) => x.id === id) : undefined;
    if (!f || checkedFindings.has(f.id)) continue;
    checkedFindings.add(f.id);
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
    if (node.type !== "paragraph") continue;
    for (const claim of absoluteClaims(textOf(node))) {
      out.push({ id: `wording:${n++}`, level: "soft", text: `"${claim}" is an absolute claim. Say what you tested and what happened instead.`, anchor: { nodeIndex: index } });
    }
  }

  // A modified exploit: its original's URL and content, and a sentence after its blocks saying what changed.
  const checkedFiles = new Set<string>();
  for (const { node, index, siblings, at } of nodes) {
    const id = /^file:(.+)$/.exec(sourceOf(node) ?? "")?.[1];
    const file = id ? data.findingFiles.find((x) => x.id === id) : undefined;
    if (!file || checkedFiles.has(file.id)) continue;
    checkedFiles.add(file.id);
    if (!file.modified) continue;
    const anchor = { nodeIndex: index };
    if (!file.originalUrl?.trim()) {
      out.push({ id: `exploit:${file.id}:url`, level: "fail", text: `The modified exploit ${file.name} has no original URL.`, anchor });
    }
    // The run of the file's blocks; the explanation is a paragraph in the run after its code (the finding's exploit
    // notes) or the sibling after it.
    let end = at;
    while (sourceOf(siblings[end + 1] ?? { type: "" }) === `file:${file.id}`) end++;
    const code = siblings.slice(at, end + 1).findIndex((b) => b.type === "codeBlock");
    const noted = code >= 0 && siblings.slice(at + code + 1, end + 1).some(hasText);
    if (!noted && !hasText(siblings[end + 1])) {
      out.push({ id: `exploit:${file.id}:explain`, level: "soft", text: `The modified exploit ${file.name} has no explanation of the changes after it.`, anchor });
    }
    if (!file.originalContent) {
      out.push({ id: `exploit:${file.id}:original`, level: "fail", text: `The modified exploit ${file.name} has no original to compare against.`, anchor });
    }
  }

  for (const host of hosts) {
    for (const row of serviceCoverage(data, host.id, input.coverage ?? {})) {
      if (row.result === "untested") {
        out.push({ id: `coverage:${row.serviceId}`, level: "soft", text: `${row.port}/${row.protocol} on ${host.name} is untested.` });
      }
    }
  }

  for (const m of suggestMoves(doc)) {
    out.push({ id: `move:${m.key}`, level: "soft", text: `This block is long (${m.reason}). Consider moving it to an appendix page.` });
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
  "proof-missing": (n) => `${n} flags are not on the page`,
  "proof-ip": (n) => `${n} proofs don't show ipconfig, ifconfig or ip addr with the target IP`,
  "proof-screenshot": (n) => `${n} proofs have no screenshot`,
  "proof-web": (n) => `${n} proofs look like they came from a web request, not an interactive shell`,
  "proof-identity": (n) => `${n} proofs don't show whoami or id`,
  "proof-hostname": (n) => `${n} proofs don't show hostname`,
  "proof-path": (n) => `${n} proofs don't read the flag from its usual location`,
  "proof-shot": (n) => `${n} proof screenshots: Raven can't read them; check each shows the target IP`,
  gone: (n) => `${n} blocks on the page come from a deleted finding or file`,
  "copied-private": (n) => `${n} blocks on the page come from now-private entries`,
  "copied-deleted": (n) => `${n} blocks on the page come from deleted entries`,
  output: (n) => `${n} commands on the page show no output`,
  explain: (n) => `${n} steps have no explanation`,
  "step-replay": (n) => `${n} steps have no command or output under them`,
  "cred-finding": (n) => `${n} credentials that moved you have no finding`,
  caption: (n) => `${n} screenshot captions are over ${MAX_CAPTION_WORDS} words`,
  "caption-weak": (n) => `${n} screenshots have no caption of their own`,
  "access-shot": (n) => `${n} access levels have no screenshot of them on the page`,
  "finding-severity": (n) => `${n} findings have no severity`,
  "finding-title": (n) => `${n} finding titles are a single word`,
  "finding-affected": (n) => `${n} findings have no affected host or service`,
  "finding-description": (n) => `${n} findings have no description`,
  "finding-remediation": (n) => `${n} findings have no remediation`,
  wording: (n) => `${n} absolute claims on the page`,
  "exploit-url": (n) => `${n} modified exploits have no original URL`,
  "exploit-explain": (n) => `${n} modified exploits have no explanation of the changes after them`,
  "exploit-original": (n) => `${n} modified exploits have no original to compare against`,
  coverage: (n) => `${n} services are untested`,
  move: (n) => `${n} blocks are long; consider moving them to an appendix`,
  legible: (n) => `${n} screenshots are narrower than would print legibly`,
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
  "proof-shot": (c) => `${part(c, 2)}.txt: screenshot shows IP?`,
  gone: () => "Deleted finding or file on the page",
  "copied-private": () => "Block from a now-private entry",
  "copied-deleted": () => "Block from a deleted entry",
  output: () => "A command shows no output",
  explain: () => "A step has no explanation",
  "step-replay": (c) => `Step ${/^Step (\d+)/.exec(c.text)?.[1] ?? ""} can't be replayed`,
  "cred-finding": (c) => c.text.replace(/, but no finding covers it.*$/, "").replace(/^(.+?)'s credential from .+ got you onto /, "$1 got you onto ") + ": no finding",
  caption: () => "Caption over 10 words",
  "caption-weak": () => "A screenshot has no caption",
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
  /** The outline's line, never ending in a full stop: one check's short wording, or several as a count ("12 steps have
   *  no explanation"). */
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
    text: list.length === 1 ? (SHORT[key]?.(list[0]) ?? list[0].text.replace(/\.$/, "")) : (PLURAL[key]?.(list.length) ?? `${list.length} × ${list[0].text.replace(/\.$/, "")}`),
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
