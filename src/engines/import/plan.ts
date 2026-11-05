// Maps selected old-Raven engagements to new-model records. Every record carries an explicit id (its old id,
// or a derived one) so the Rust side inserts with INSERT OR IGNORE and re-import stays add-only.
// Never throws: a malformed record is skipped and counted in `skipped`.
import type { BoardColumn, HostAccess, HostOs } from "../../types/host";
import type { EngagementKind, EngagementStatus } from "../../types/engagement";
import type { CommandBlock, FlagKind, LogContent, LogKind, NewAttachment } from "../../types/log";
import type { ServiceProtocol } from "../../types/service";
import type { ChecklistStatus, Evidence } from "../../types/checklist";
import type { Hop, Tunnel, TunnelKind } from "../../types/network";
import type { Finding, Severity } from "../../types/findings";
import type {
  AccessGrant, AccessLevel, AttemptResult, AttemptService, AuthMode, CredAttempt, Credential, CredentialScope,
  CredentialType, CrackStatus, Username,
} from "../../types/credentials";
import { HOST_GOALS } from "../checklist/data/hostChecklist";
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP } from "../checklist/data/engagementChecklist";
import { attemptKey, defaultHashType, findDuplicateCredential, stripLineBreaks, usernameKey } from "../credentials/keys";
import { flagTitle, noteTitle, screenshotFileName } from "../capture/titles";
import { openThreads } from "../notes/threads";
import { boxesOf, listImportable, machinesOf } from "./list";
import { gatherLogs, type RawLog } from "./logs";
import type { OldBackup, OldMachine } from "./types";

/** EngagementInput with every field explicit, plus id and status. */
export interface PlanEngagement {
  id: string;
  name: string;
  kind: EngagementKind;
  client: string | null;
  subLabel: string | null;
  scopeCidrs: string[];
  domain: string | null;
  startsAt: number | null;
  endsAt: number | null;
  timeboxStart: number | null;
  timeboxMinutes: number | null;
  status: EngagementStatus;
  /** Old `msfHostId` when it names an imported host of this engagement, else null. Old `dcHostId` is not
   *  mapped: new Raven derives the DC (`findDcHost`). */
  msfHostId: string | null;
}

export interface PlanHost {
  id: string;
  engagementId: string;
  name: string;
  ip: string | null;
  os: HostOs | null;
  access: HostAccess;
  dualHomed: boolean;
  adSet: boolean | null;
  boardColumn: BoardColumn;
  boardManual: boolean;
  accessReviewedAt: number | null;
}

export interface PlanService {
  /** `<hostId>:<proto>/<port>` */
  id: string;
  hostId: string;
  port: number;
  protocol: ServiceProtocol;
  state: string;
  nmapService: string | null;
  nmapVersion: string | null;
}

export interface PlanLogEntry {
  id: string;
  engagementId: string;
  kind: LogKind;
  title: string;
  titleEdited: true;
  ranOn: string | null;
  hostIds: string[];
  observations: string | null;
  returnedNothing: false;
  private: false;
  content: LogContent;
  at: number;
  attachment?: NewAttachment;
}

/** Keyed like Raven's notes: `ownerId` is the host id, or the engagement id for the engagement note. */
export interface PlanNote {
  ownerId: string;
  engagementId: string;
  hostId: string | null;
  body: string;
  private: false;
}

/** A checklist item with every field explicit. Its identity is (ownerId, goalId). */
export interface PlanChecklistItem {
  engagementId: string;
  /** A host id, or the engagement id for engagement goals and credential routines. */
  ownerId: string;
  goalId: string;
  status: ChecklistStatus;
  notes: string | null;
  completedAt: number | null;
  auto: boolean;
  autoFrom: "na" | "in_progress" | null;
  evidence: Evidence[];
}

export type PlanHop = Hop;
export type PlanTunnel = Tunnel;
/** FindingInput with every field explicit, plus id, engagement and times. */
export type PlanFinding = Finding;
export type PlanCredential = Credential;
export type PlanUsername = Username;
export type PlanAccessGrant = AccessGrant;
export type PlanCredAttempt = CredAttempt;

export interface ImportPlan {
  engagements: PlanEngagement[];
  hosts: PlanHost[];
  services: PlanService[];
  logEntries: PlanLogEntry[];
  notes: PlanNote[];
  checklist: PlanChecklistItem[];
  hops: PlanHop[];
  tunnels: PlanTunnel[];
  findings: PlanFinding[];
  /** Ordered so a credential's crackedFrom/fromSecretId target comes before it. */
  credentials: PlanCredential[];
  usernames: PlanUsername[];
  /** Each grant's username comes earlier in `usernames`. */
  accessGrants: PlanAccessGrant[];
  /** Unique on attemptKey; credential, username and host are all in this plan, in one engagement. */
  credAttempts: PlanCredAttempt[];
  /** Skipped records by reason (e.g. missingImage, badLogEntry). Only reasons that occurred are present. */
  skipped: Record<string, number>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const textOr = <T>(v: unknown, fallback: T): string | T => (hasText(v) ? v : fallback);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Epoch-ms numbers are kept; ISO strings are parsed; anything else is `fallback`. */
function toMs<T>(v: unknown, fallback: T): number | T {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}

const OS: Record<string, HostOs> = { windows: "windows", linux: "linux", bsd: "linux", android: "linux", macos: "linux" };
const osOf = (v: unknown): HostOs | null => (hasText(v) ? (OS[v.trim().toLowerCase()] ?? "other") : null);

const COLUMN: Record<string, BoardColumn> = {
  backlog: "enumerate", recon: "enumerate", foothold: "foothold", root: "loot", completed: "done",
};

/** Old status and flags say how far the host went. */
function accessOf(m: OldMachine): HostAccess {
  if (m.status === "root" || m.status === "completed" || hasText(m.rootFlag) || hasText(m.rootPwnedAt)) return "root";
  if (m.status === "foothold" || hasText(m.userFlag) || hasText(m.userPwnedAt)) return "user";
  return "none";
}

const MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
function sniffMime(b64: string): string | null {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lG")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return null;
}

/** Lines that would be open threads (`? `, after indentation, outside code fences) get a `\` so they stay text. */
export function escapeThreads(body: string): string {
  const threads = openThreads(body);
  if (threads.length === 0) return body;
  const lines = body.split("\n");
  for (const { line } of threads) {
    const l = lines[line]!;
    const rest = l.trimStart();
    lines[line] = l.slice(0, l.length - rest.length) + "\\" + rest;
  }
  return lines.join("\n");
}

export function buildImportPlan(b: OldBackup, selectedIds: string[], now: number): ImportPlan {
  const plan: ImportPlan = {
    engagements: [], hosts: [], services: [], logEntries: [], notes: [],
    checklist: [], hops: [], tunnels: [], findings: [],
    credentials: [], usernames: [], accessGrants: [], credAttempts: [],
    skipped: {},
  };
  const skip = (reason: string, n = 1) => {
    if (n > 0) plan.skipped[reason] = (plan.skipped[reason] ?? 0) + n;
  };
  const seen = {
    engagement: new Set<string>(), host: new Set<string>(), service: new Set<string>(), log: new Set<string>(), note: new Set<string>(),
    checklist: new Set<string>(), hop: new Set<string>(), tunnel: new Set<string>(), finding: new Set<string>(),
  };
  const fresh = (table: keyof typeof seen, id: string): boolean => {
    if (seen[table].has(id)) {
      skip("duplicate");
      return false;
    }
    seen[table].add(id);
    return true;
  };

  const machines = machinesOf(b);
  const byId = new Map(machines.map((m) => [m.id, m]));
  const candidates = new Map(listImportable(b).map((c) => [c.id, c]));
  const images = new Map<string, Record<string, unknown>>();
  for (const img of arr(isObj(b?.indexedDb) ? b.indexedDb.images : undefined)) {
    if (isObj(img) && typeof img.id === "string" && !images.has(img.id)) images.set(img.id, img);
  }

  /** Old engagement id (a lab id, or a standalone's machine id) -> new engagement id. */
  const engagementOf = new Map<string, string>();

  for (const selected of new Set(Array.isArray(selectedIds) ? selectedIds : [])) {
    const c = candidates.get(selected);
    const container = byId.get(selected);
    if (!c || !container) continue;
    const isLabSel = c.kind === "lab";
    const engagementId = isLabSel ? container.id : `${container.id}#e`;
    if (!fresh("engagement", engagementId)) continue;
    const engagement: PlanEngagement = {
      id: engagementId,
      name: textOr(container.name, container.id),
      kind: c.engagementKind,
      client: null,
      subLabel: null,
      scopeCidrs: arr(container.scope).filter(hasText).map((s) => s.trim()),
      domain: hasText(container.domain) ? container.domain.trim() : null,
      startsAt: null,
      endsAt: null,
      timeboxStart: null,
      timeboxMinutes: null,
      status: "active",
      msfHostId: null,
    };
    plan.engagements.push(engagement);
    engagementOf.set(container.id, engagementId);

    // Hosts and their services.
    const boxes = isLabSel ? boxesOf(machines, container.id) : [];
    const hostRows = isLabSel ? boxes : [container];
    const hosts = new Map<string, PlanHost>();
    const serviceRows = new Map<string, ServiceRow[]>();
    const rowsOf = (m: OldMachine): ServiceRow[] => {
      let rows = serviceRows.get(m.id);
      if (!rows) {
        rows = parseServices(m, skip);
        serviceRows.set(m.id, rows);
      }
      return rows;
    };
    for (const m of hostRows) {
      if (!fresh("host", m.id)) continue;
      const host: PlanHost = {
        id: m.id,
        engagementId,
        name: textOr(m.name, m.id),
        ip: hasText(m.ip) ? m.ip.trim() : null,
        os: osOf(m.os),
        access: accessOf(m),
        dualHomed: m.dualHomed === true,
        adSet: null,
        boardColumn: (typeof m.status === "string" && COLUMN[m.status]) || "enumerate",
        boardManual: false,
        accessReviewedAt: toMs(m.accessReviewedAt, null),
      };
      hosts.set(m.id, host);
      plan.hosts.push(host);
      for (const r of rowsOf(m)) {
        const id = `${m.id}:${r.protocol}/${r.port}`;
        if (fresh("service", id)) {
          plan.services.push({ id, hostId: m.id, port: r.port, protocol: r.protocol, state: r.state, nmapService: r.service, nmapVersion: r.version });
        }
      }
    }

    // Old dcHostId is deliberately not mapped: new Raven derives the DC with findDcHost.
    if (hasText(container.msfHostId)) {
      if (hosts.has(container.msfHostId)) engagement.msfHostId = container.msfHostId;
      else skip("msfHostMissing");
    }

    const hostFor = (m: OldMachine): string[] => (hosts.has(m.id) ? [m.id] : []);
    const pushLog = (e: PlanLogEntry) => {
      if (fresh("log", e.id)) plan.logEntries.push(e);
    };
    /** A title past 300 characters keeps its full text in the observations. */
    const base = (id: string, title: string, hostIds: string[], at: number, observations: string | null = null) => {
      const long = title.length > TITLE_MAX;
      const obs = long ? [`Full title: ${title}`, observations].filter((o): o is string => !!o).join("\n\n") : observations;
      return { id, engagementId, title: title.slice(0, TITLE_MAX), titleEdited: true, ranOn: null, hostIds, observations: obs, returnedNothing: false, private: false, at } as const;
    };

    // Log entries.
    const gathered = gatherLogs(container, boxes, now);
    skip("badLogEntry", gathered.bad);
    skip("duplicate", gathered.duplicate);
    for (const raw of gathered.entries) {
      const entry = mapLog(raw);
      if (entry) pushLog(entry);
      else skip("emptyLogEntry");
    }

    // Ruling T4-R2: old `credIds`, `tool` and `outOfScopeIps` are not mapped. The new model has no
    // entry-to-credential link (attempts keep their own proof links); dropped credIds are counted.
    function mapLog(e: RawLog): PlanLogEntry | null {
      const hostIds: string[] = [];
      for (const h of arr(e.hostIds)) {
        if (typeof h === "string" && hosts.has(h)) {
          if (!hostIds.includes(h)) hostIds.push(h);
        } else skip("droppedHostLink");
      }
      if (!isLabSel && hostIds.length === 0) hostIds.push(...hostFor(container!));
      if (arr(e.credIds).length > 0) skip("credLinkDropped");
      const blocks: CommandBlock[] = arr(e.blocks).filter(isObj).map((bl) => {
        const block: CommandBlock = {
          command: typeof bl.command === "string" ? bl.command : "",
          output: typeof bl.output === "string" ? bl.output : bl.output == null ? "" : String(bl.output),
        };
        if (typeof bl.shell === "string") block.shell = bl.shell;
        return block;
      });
      const title = typeof e.title === "string" ? oneLine(e.title) : "";
      const observations = hasText(e.observations) ? e.observations : null;
      let content: LogContent;
      let fallbackTitle: string;
      if (blocks.some((bl) => bl.command.trim())) {
        // Every stored block needs a command: output-only blocks join the neighbouring command's output.
        const kept: CommandBlock[] = [];
        let pending: string[] = [];
        for (const bl of blocks) {
          if (bl.command.trim()) {
            kept.push({ ...bl, output: [...pending, bl.output].filter((o) => o.length > 0).join("\n\n") });
            pending = [];
          } else if (bl.output.length > 0) {
            const prev = kept[kept.length - 1];
            if (prev) prev.output = [prev.output, bl.output].filter((o) => o.length > 0).join("\n\n");
            else pending.push(bl.output);
          }
        }
        content = { kind: "command", blocks: kept };
        fallbackTitle = oneLine(kept[0]!.command.split("\n").find((l) => l.trim()) ?? "").slice(0, 200);
      } else {
        const text = blocks.map((bl) => bl.output).filter((o) => o.trim()).join("\n\n") || title || (observations ?? "");
        if (!text.trim()) return null;
        content = { kind: "note", text };
        fallbackTitle = noteTitle(text);
      }
      return {
        ...base(e.id as string, title || fallbackTitle || "Imported entry", hostIds, toMs(e.at, now), observations),
        kind: content.kind,
        ranOn: hasText(e.ranOn) ? e.ranOn : null,
        content,
      };
    }

    // Screenshots and flags: the container's (engagement level for a lab), then each box's.
    const holders = isLabSel ? [container, ...boxes.filter((m) => hosts.has(m.id))] : [container];
    for (const m of holders) {
      const host = hosts.get(m.id) ?? null;
      for (const s of arr(m.screenshots)) {
        if (!isObj(s) || !hasText(s.id)) {
          skip("badScreenshot");
          continue;
        }
        const img = typeof s.imageId === "string" ? images.get(s.imageId) : undefined;
        if (!img) {
          skip("missingImage");
          continue;
        }
        // All whitespace goes: strict base64 decoders reject embedded newlines.
        const data = typeof img.data === "string" ? img.data.trim().replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
        const mime = typeof img.mime === "string" && MIMES.has(img.mime) ? img.mime : sniffMime(data);
        if (!data || !mime) {
          skip("badImage");
          continue;
        }
        const title = hasText(s.title) ? oneLine(s.title) : "Screenshot";
        const fileName = screenshotFileName({ ip: host?.ip ?? null, hostName: host?.name ?? null, column: host?.boardColumn ?? null, caption: title, mime });
        pushLog({
          ...base(`${m.id}:shot:${s.id}`, title, hostFor(m), toMs(s.createdAt, now)),
          kind: "screenshot",
          content: { kind: "screenshot", attachmentId: "", caption: typeof s.notes === "string" ? s.notes : "", fileName },
          attachment: { mime, dataBase64: data },
        });
      }
    }
    const redactedBackup = b?.isRedacted === true;
    for (const m of holders) {
      const host = hosts.get(m.id) ?? null;
      const flags: [FlagKind, unknown, unknown][] = [
        ["local", m.userFlag, m.userPwnedAt],
        ["proof", m.rootFlag, m.rootPwnedAt],
      ];
      for (const [flagKind, value, at] of flags) {
        if (!hasText(value)) continue;
        // A placeholder would block the real value forever: re-import is add-only.
        if (redactedBackup || value.trim() === "[REDACTED]") {
          skip("redactedFlag");
          continue;
        }
        pushLog({
          ...base(`${m.id}:flag:${flagKind}`, flagTitle(flagKind, host), hostFor(m), toMs(at, now)),
          kind: "flag",
          content: { kind: "flag", flagKind, value: value.trim(), attachmentId: null, proof: null },
        });
      }
    }

    // Notes: free text first, then sections for user-entered fields the new model has no column for.
    const pushNote = (ownerId: string, hostId: string | null, parts: string[]) => {
      const filled = parts.filter((p) => p.trim());
      if (filled.length === 0 || !fresh("note", ownerId)) return;
      const body = filled.length === 1 ? filled[0]! : filled.map((p) => p.replace(/\s+$/, "")).join("\n\n");
      plan.notes.push({ ownerId, engagementId, hostId, body, private: false });
    };
    const quick = (m: OldMachine) => (typeof m.quickNotes === "string" ? escapeThreads(m.quickNotes) : "");
    const shared = (m: OldMachine) => [
      quick(m),
      nextMoveThread(m.nextMove),
      domainSection(m, engagement.domain),
      listSection("## Extra IPs", arr(m.extraIps)),
    ];
    if (isLabSel) {
      const rows = rowsOf(container);
      pushNote(engagementId, null, [
        ...shared(container),
        labContainerSection(container),
        servicesSection(rows),
        triageSection(container, rows, skip),
      ]);
    }
    for (const m of hostRows) {
      if (hosts.has(m.id)) pushNote(m.id, m.id, [...shared(m), triageSection(m, rowsOf(m), skip)]);
    }

    const logIds = new Set(plan.logEntries.filter((e) => e.engagementId === engagementId).map((e) => e.id));
    /** An imported log entry of this engagement, else null (a dangling link is counted). */
    const logLink = (v: unknown): string | null => {
      if (!hasText(v)) return null;
      if (logIds.has(v)) return v;
      skip("droppedLogLink");
      return null;
    };

    // Checklist: engagement goals and credential routines belong to the engagement, host goals to the host.
    for (const m of holders) {
      const items = isObj(m.checklist) && isObj(m.checklist.itemsState) ? m.checklist.itemsState : {};
      for (const [goalId, st] of Object.entries(items)) {
        const engagementGoal = ENGAGEMENT_GOAL_IDS.has(goalId) || goalId.startsWith("cred-routine-");
        if (!engagementGoal && !HOST_GOAL_IDS.has(goalId)) {
          skip("unknownGoal");
          continue;
        }
        if (!isObj(st) || typeof st.status !== "string" || !STATUSES.has(st.status)) {
          skip("badChecklistItem");
          continue;
        }
        const ownerId = engagementGoal ? engagementId : hosts.has(m.id) ? m.id : null;
        if (!ownerId) {
          skip("checklistNoOwner");
          continue;
        }
        if (!fresh("checklist", `${ownerId}|${goalId}`)) continue;
        const evidence: Evidence[] = [];
        for (const ev of arr(st.evidence)) {
          if (!isObj(ev) || !hasText(ev.entryId) || !logIds.has(ev.entryId)) {
            skip("droppedEvidence");
            continue;
          }
          evidence.push({ entryId: ev.entryId, commandId: hasText(ev.commandId) ? ev.commandId : null });
        }
        plan.checklist.push({
          engagementId,
          ownerId,
          goalId,
          status: st.status as ChecklistStatus,
          notes: hasText(st.notes) ? st.notes : null,
          completedAt: toMs(st.completedAt, null),
          auto: st.auto === true,
          autoFrom: st.autoFrom === "na" || st.autoFrom === "in_progress" ? st.autoFrom : null,
          evidence,
        });
      }
    }

    // Hops and tunnels live on the container.
    const deletedHops = new Set(arr(container.deletedHopIds).filter(hasText));
    for (const h of arr(container.hops)) {
      if (!isObj(h) || !hasText(h.id) || !hasText(h.toHostId)) {
        skip("badHop");
        continue;
      }
      if (deletedHops.has(h.id)) continue;
      const fromHostId = hasText(h.fromHostId) ? h.fromHostId : null;
      if (!hosts.has(h.toHostId) || (fromHostId !== null && !hosts.has(fromHostId))) {
        skip("hopHostMissing");
        continue;
      }
      if (fromHostId === h.toHostId) {
        skip("badHop");
        continue;
      }
      if (!fresh("hop", h.id)) continue;
      // The new model's hop has no credential or username link.
      if (hasText(h.credId) || hasText(h.usernameId)) skip("hopCredLinkDropped");
      const at = toMs(h.at, toMs(h.updatedAt, now));
      plan.hops.push({
        id: h.id,
        engagementId,
        fromHostId,
        toHostId: h.toHostId,
        via: typeof h.via === "string" ? h.via.trim() : "",
        logEntryId: logLink(h.logEntryId),
        at,
        updatedAt: toMs(h.updatedAt, at),
      });
    }
    const deletedTunnels = new Set(arr(container.deletedTunnelIds).filter(hasText));
    for (const t of arr(container.tunnels)) {
      if (!isObj(t) || !hasText(t.id) || !hasText(t.viaHostId)) {
        skip("badTunnel");
        continue;
      }
      if (deletedTunnels.has(t.id)) continue;
      if (!hosts.has(t.viaHostId)) {
        skip("tunnelHostMissing");
        continue;
      }
      if (!fresh("tunnel", t.id)) continue;
      // Values the new model would reject stay readable in the notes.
      const entered = arr(t.subnets).filter(hasText).map((x) => x.trim());
      const subnets = entered.filter(validCidr).slice(0, MAX_SUBNETS);
      const rejected = entered.filter((x) => !subnets.includes(x));
      const cb = typeof t.callbackIp === "string" ? t.callbackIp.trim() : "";
      const cbOk = cb === "" || (!cb.includes("/") && validCidr(cb));
      const extra = [
        rejected.length ? `Subnets as entered: ${rejected.join(", ")}` : "",
        cbOk ? "" : `Callback as entered: ${oneLine(cb)}`,
      ].filter(Boolean).join("\n");
      const notes = [hasText(t.notes) ? t.notes.trim() : "", extra].filter(Boolean).join("\n\n");
      const createdAt = toMs(t.createdAt, toMs(t.updatedAt, now));
      plan.tunnels.push({
        id: t.id,
        engagementId,
        kind: typeof t.kind === "string" && TUNNEL_KINDS.has(t.kind) ? (t.kind as TunnelKind) : "other",
        viaHostId: t.viaHostId,
        subnets,
        callbackIp: cbOk ? cb : "",
        status: t.status === "up" ? "up" : "down",
        notes: notes || null,
        createdAt,
        updatedAt: toMs(t.updatedAt, createdAt),
      });
    }

    // Findings: each machine's LabFindings, linked to that machine when it is a host.
    for (const m of holders) {
      for (const f of arr(m.findings)) {
        if (!isObj(f) || !hasText(f.id)) {
          skip("badFinding");
          continue;
        }
        if (!fresh("finding", f.id)) continue;
        const description = [
          hasText(f.affectedService) ? `Affected: ${oneLine(f.affectedService)}` : "",
          hasText(f.repro) ? f.repro : "",
        ].filter(Boolean).join("\n\n");
        const refs = hasText(f.cweCve)
          ? [...new Set(f.cweCve.split(/[,;\n]+/).map((r) => r.trim()).filter(Boolean))].slice(0, MAX_REFS)
          : [];
        const score = f.cvssScore;
        const createdAt = toMs(f.createdAt, now);
        plan.findings.push({
          id: f.id,
          engagementId,
          title: hasText(f.title) ? oneLine(f.title) : "Imported finding",
          severity: typeof f.severity === "string" && SEVERITIES.has(f.severity) ? (f.severity as Severity) : null,
          cvssVector: null,
          cvssScore: typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
          status: "draft",
          description,
          impact: "",
          remediation: hasText(f.remediation) ? f.remediation : "",
          exploitNotes: "",
          lessons: "",
          refs,
          hostIds: hostFor(m),
          serviceIds: [],
          stepEntryIds: [],
          createdAt,
          updatedAt: toMs(f.updatedAt, createdAt),
        });
      }
    }
  }

  mapLoot(b, plan, engagementOf, skip, now);
  return plan;
}

const HOST_GOAL_IDS = new Set(HOST_GOALS.map((g) => g.id));
const ENGAGEMENT_GOAL_IDS = new Set([...ENGAGEMENT_SETUP, ...AD_PLAYBOOKS.flatMap((p) => p.goals)].map((g) => g.id));
const STATUSES = new Set<string>(["todo", "in_progress", "done", "na"]);
const TUNNEL_KINDS = new Set<string>(["ligolo", "chisel", "ssh", "socks", "other"]);
const SEVERITIES = new Set<string>(["critical", "high", "medium", "low", "info"]);
const MAX_SUBNETS = 50;
const MAX_REFS = 100;

/** IPv4 address or CIDR. Agrees with Rust `valid_cidr` (no leading zeros, prefix 0-32). */
function validCidr(s: string): boolean {
  const [ip, prefix, more] = s.split("/");
  if (more !== undefined) return false;
  if (prefix !== undefined && !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefix)) return false;
  const parts = ip!.split(".");
  return parts.length === 4 && parts.every((o) => /^(?:0|[1-9][0-9]{0,2})$/.test(o) && Number(o) <= 255);
}

const TITLE_MAX = 300;

interface ServiceRow {
  port: number;
  protocol: ServiceProtocol;
  state: string;
  service: string | null;
  version: string | null;
  cveNotes: string | null;
}

const validPort = (p: unknown): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535;

/** `services` rows, then `openPorts` without a row (any protocol) as open tcp with no name. */
function parseServices(m: OldMachine, skip: (reason: string) => void): ServiceRow[] {
  const rows: ServiceRow[] = [];
  const ports = new Set<number>();
  for (const s of arr(m.services)) {
    const raw = isObj(s) ? (s.protocol === undefined ? "tcp" : s.protocol) : null;
    const protocol = typeof raw === "string" ? raw.trim().toLowerCase() : null;
    if (!isObj(s) || !validPort(s.port) || (protocol !== "tcp" && protocol !== "udp")) {
      skip("badService");
      continue;
    }
    ports.add(s.port);
    rows.push({
      port: s.port,
      protocol,
      state: textOr(s.state, "open"),
      service: textOr(s.service, null),
      version: textOr(s.version, null),
      cveNotes: hasText(s.cveNotes) ? oneLine(s.cveNotes) : null,
    });
  }
  for (const p of arr(m.openPorts)) {
    if (!validPort(p)) skip("badService");
    else if (!ports.has(p)) {
      ports.add(p);
      rows.push({ port: p, protocol: "tcp", state: "open", service: null, version: null, cveNotes: null });
    }
  }
  return rows;
}

/** First line is the open thread; any further lines follow as plain (escaped) text. */
function nextMoveThread(v: unknown): string {
  if (!hasText(v)) return "";
  const lines = v.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  const rest = lines.slice(first + 1).join("\n").replace(/\s+$/, "");
  const head = `? ${lines[first]!.trim()}`;
  return rest.trim() ? `${head}\n${escapeThreads(rest)}` : head;
}

function listSection(heading: string, items: unknown[]): string {
  const lines = items.filter(hasText).map((x) => `- ${oneLine(x)}`);
  return lines.length ? [heading, ...lines].join("\n") : "";
}

/** The machine's domain when it differs from the engagement's, and its vhosts. */
function domainSection(m: OldMachine, engagementDomain: string | null): string {
  const lines: string[] = [];
  if (hasText(m.domain) && m.domain.trim() !== engagementDomain) lines.push(`- domain: ${oneLine(m.domain)}`);
  for (const v of arr(m.vhosts)) if (hasText(v)) lines.push(`- vhost: ${oneLine(v)}`);
  return lines.length ? ["## Domain / vhosts", ...lines].join("\n") : "";
}

/** A lab container is not a host, so its own ip and os are kept as text. */
function labContainerSection(m: OldMachine): string {
  const lines: string[] = [];
  if (hasText(m.ip)) lines.push(`- ip: ${m.ip.trim()}`);
  if (hasText(m.os)) lines.push(`- os: ${m.os.trim()}`);
  return lines.length ? ["## Lab container", ...lines].join("\n") : "";
}

function servicesSection(rows: ServiceRow[]): string {
  const lines = rows.map((r) =>
    `- ${r.port}/${r.protocol} ${r.state}${r.service ? ` ${r.service}` : ""}${r.version ? ` ${r.version}` : ""}`,
  );
  return lines.length ? ["## Services", ...lines].join("\n") : "";
}

/** `- <port>: <status> — <note>`, with a service's cveNotes added to its port's line. */
function triageSection(m: OldMachine, rows: ServiceRow[], skip: (reason: string) => void): string {
  const byPort = new Map<number, string>();
  if (isObj(m.portTriage)) {
    for (const [port, t] of Object.entries(m.portTriage)) {
      if (!/^\d+$/.test(port) || !isObj(t) || !hasText(t.status)) {
        skip("badPortTriage");
        continue;
      }
      byPort.set(Number(port), `- ${port}: ${t.status.trim()}${hasText(t.note) ? ` — ${oneLine(t.note)}` : ""}`);
    }
  }
  for (const r of rows) {
    if (!r.cveNotes) continue;
    const line = byPort.get(r.port);
    byPort.set(r.port, line ? `${line} — CVE: ${r.cveNotes}` : `- ${r.port}: CVE: ${r.cveNotes}`);
  }
  if (byPort.size === 0) return "";
  return ["## Port triage", ...[...byPort].sort((x, y) => x[0] - y[0]).map((r) => r[1])].join("\n");
}

// ---------------------------------------------------------------- credentials, usernames, access, attempts

const CRED_TYPES = new Set<string>(["password", "hash", "ticket", "key", "token", "other"]);
const SCOPES = new Set<string>(["domain", "local", "app"]);
const CRACK = new Set<string>(["uncracked", "cracked", "uncrackable"]);
const LEVELS = new Set<string>(["user", "admin", "system"]);
const RESULTS = new Set<string>(["admin", "valid", "failed", "errored"]);
/** Result names used before old loot schema 2. */
const LEGACY_RESULTS: Record<string, AttemptResult> = { tried: "errored", invalid: "failed" };
/** Old per-machine `credential.verifications` status -> attempt result ('untested' carried no information). */
const VERIFICATION_RESULTS: Record<string, AttemptResult> = { admin: "admin", user: "valid", failed: "failed" };
const SERVICES = new Set<string>(["smb", "winrm", "rdp", "mssql", "ssh", "ftp", "ldap", "wmi", "vnc", "nfs", "http", "kerberos", "other"]);
const AUTH_MODES = new Set<string>(["domain", "local"]);
const RESULT_RANK: Record<AttemptResult, number> = { errored: 0, failed: 1, valid: 2, admin: 3 };
const REDACTED = "[REDACTED]";

const optText = (v: unknown): string | null => (hasText(v) ? v.trim() : null);
const oneOf = <T extends string>(set: Set<string>, v: unknown): T | null => (typeof v === "string" && set.has(v) ? (v as T) : null);

/**
 * Old top-level loot, following old `normalizeLootState` + `mergeImportedLoot`: a record is selected when its
 * `engagementId` (or, failing that, its source machine) maps to an imported engagement. Placeholder secrets are
 * never stored. Duplicates keep the first record and move attempts and grants onto it.
 */
function mapLoot(b: OldBackup, plan: ImportPlan, engagementOf: Map<string, string>, skip: (reason: string) => void, now: number) {
  const hostEngagement = new Map(plan.hosts.map((h) => [h.id, h.engagementId]));
  const logEngagement = new Map(plan.logEntries.map((e) => [e.id, e.engagementId]));
  /** The imported engagement a record belongs to, else null (not selected). */
  const engagementFor = (r: Record<string, unknown>): string | null =>
    (hasText(r.engagementId) && (engagementOf.get(r.engagementId) ?? hostEngagement.get(r.engagementId))) ||
    (hasText(r.sourceMachineId) && hostEngagement.get(r.sourceMachineId)) ||
    null;
  const hostIn = (engagementId: string, v: unknown): v is string => hasText(v) && hostEngagement.get(v) === engagementId;
  /** A host link in the engagement, else null (a dangling link is counted). */
  const hostLink = (engagementId: string, v: unknown): string | null => {
    if (!hasText(v)) return null;
    if (hostIn(engagementId, v)) return v;
    skip("droppedHostLink");
    return null;
  };
  const logLink = (engagementId: string, v: unknown): string | null => {
    if (!hasText(v)) return null;
    if (logEngagement.get(v) === engagementId) return v;
    skip("droppedLogLink");
    return null;
  };
  const isImportedHost = (v: unknown) => hasText(v) && hostEngagement.has(v);

  // Credentials.
  const credIdMap = new Map<string, string>();
  const credScope = new Map<string, CredentialScope>();
  const skippedCreds = new Set<string>();
  const links = new Map<string, { crackedFrom: unknown; fromSecretId: unknown }>();
  const verifications: { rawId: string; credId: string; scope: CredentialScope; createdAt: number; v: Record<string, unknown> }[] = [];
  const kept: Credential[] = [];
  for (const raw of arr(b?.credentials)) {
    if (!isObj(raw)) {
      skip("badCredential");
      continue;
    }
    const engagementId = engagementFor(raw);
    if (!engagementId) continue;
    const id = optText(raw.id);
    if (!id || (typeof raw.username !== "string" && typeof raw.secret !== "string")) {
      skip("badCredential");
      continue;
    }
    const rawSecret = typeof raw.secret === "string" ? raw.secret : "";
    if (raw.redacted === true || rawSecret.trim() === REDACTED) {
      skip("redactedCredential");
      skippedCreds.add(id);
      continue;
    }
    const type = oneOf<CredentialType>(CRED_TYPES, raw.type) ?? "other";
    const secret = type === "hash" ? rawSecret.trim() : stripLineBreaks(rawSecret);
    const username = typeof raw.username === "string" ? raw.username.trim() : "";
    if (!username && !secret) {
      skip("badCredential");
      skippedCreds.add(id);
      continue;
    }
    const scope = oneOf<CredentialScope>(SCOPES, raw.scope) ?? "domain";
    let localHostId: string | null = null;
    if (scope === "local") {
      if (!hostIn(engagementId, raw.localHostId)) {
        skip("credLocalHostMissing");
        skippedCreds.add(id);
        continue;
      }
      localHostId = raw.localHostId;
    }
    const createdAt = toMs(raw.createdAt, now);
    const c: Credential = {
      id,
      engagementId,
      type,
      username,
      domain: optText(raw.domain),
      secret,
      hashType: type === "hash" ? (optText(raw.hashType) ?? defaultHashType(secret) ?? null) : null,
      scope,
      localHostId,
      sourceHostId: hostLink(engagementId, raw.sourceMachineId),
      source: optText(raw.source),
      notes: optText(raw.notes),
      crackStatus: type === "hash" ? (oneOf<CrackStatus>(CRACK, raw.crackStatus) ?? "uncracked") : null,
      crackedFrom: null,
      fromSecretId: null,
      createdAt,
      updatedAt: createdAt,
    };
    const dup = findDuplicateCredential(kept, c);
    if (dup) {
      skip("credDuplicate");
      if (!credIdMap.has(id)) credIdMap.set(id, dup.id);
    } else {
      kept.push(c);
      credIdMap.set(id, id);
      links.set(id, { crackedFrom: raw.crackedFrom, fromSecretId: raw.fromSecretId });
    }
    if (!credScope.has(id)) credScope.set(id, scope);
    if (isObj(raw.verifications)) {
      for (const v of Object.entries(raw.verifications)) {
        if (isObj(v[1])) verifications.push({ rawId: id, credId: credIdMap.get(id)!, scope, createdAt, v: { ...v[1], machineId: v[0].trim() } });
      }
    }
  }
  // Credential links: only to an imported credential of the same engagement, never to itself or in a cycle.
  const byId = new Map(kept.map((c) => [c.id, c]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (c: Credential) => {
    state.set(c.id, "visiting");
    const raw = links.get(c.id)!;
    for (const field of ["crackedFrom", "fromSecretId"] as const) {
      if (!hasText(raw[field])) continue;
      const target = byId.get(credIdMap.get(raw[field]) ?? "");
      if (!target || target.id === c.id || target.engagementId !== c.engagementId || state.get(target.id) === "visiting") {
        skip("droppedCredLink");
        continue;
      }
      c[field] = target.id;
      if (!state.has(target.id)) visit(target);
    }
    state.set(c.id, "done");
    plan.credentials.push(c);
  };
  for (const c of kept) if (!state.has(c.id)) visit(c);

  // Usernames, merged by id and then by usernameKey; access removed on any copy stays removed.
  const userIdMap = new Map<string, string>();
  const userByKey = new Map<string, Username>();
  const userById = new Map<string, Username>();
  const grantSources: { user: Username; access: unknown }[] = [];
  const deletedAccess = new Map<string, Set<string>>();
  for (const raw of arr(b?.usernames)) {
    if (!isObj(raw)) {
      skip("badUsername");
      continue;
    }
    const engagementId = engagementFor(raw);
    if (!engagementId) continue;
    const id = optText(raw.id);
    const name = optText(raw.username);
    if (!id || !name) {
      skip("badUsername");
      continue;
    }
    const u: Username = {
      id,
      engagementId,
      username: name,
      domain: optText(raw.domain),
      sourceHostId: hostLink(engagementId, raw.sourceMachineId),
      source: optText(raw.source),
      createdAt: toMs(raw.createdAt, now),
    };
    const twin = userById.get(id) ?? userByKey.get(usernameKey(u));
    const target = twin ?? u;
    if (twin) skip("usernameDuplicate");
    else {
      plan.usernames.push(u);
      userById.set(id, u);
      userByKey.set(usernameKey(u), u);
    }
    if (!userIdMap.has(id)) userIdMap.set(id, target.id);
    const deleted = deletedAccess.get(target.id) ?? new Set<string>();
    for (const d of arr(raw.deletedAccessIds)) if (hasText(d)) deleted.add(d);
    deletedAccess.set(target.id, deleted);
    grantSources.push({ user: target, access: raw.access });
  }
  const grantIds = new Set<string>();
  for (const { user, access } of grantSources) {
    for (const g of arr(access)) {
      if (!isObj(g) || !hasText(g.id) || !oneOf<AccessLevel>(LEVELS, g.level)) {
        skip("badGrant");
        continue;
      }
      if (deletedAccess.get(user.id)!.has(g.id)) continue;
      if (!hostIn(user.engagementId, g.hostId)) {
        skip("grantHostMissing");
        continue;
      }
      if (grantIds.has(g.id)) {
        skip("duplicate");
        continue;
      }
      grantIds.add(g.id);
      plan.accessGrants.push({
        id: g.id,
        engagementId: user.engagementId,
        usernameId: user.id,
        hostId: g.hostId,
        level: g.level as AccessLevel,
        via: typeof g.via === "string" ? g.via.trim() : "",
        logEntryId: logLink(user.engagementId, g.logEntryId),
        at: toMs(g.at, now),
      });
    }
  }

  // Attempts: explicit ones first, then legacy verifications; one per attemptKey, never downgraded.
  const attempts = new Map<string, CredAttempt>();
  const attemptIds = new Set<string>();
  const upsert = (a: CredAttempt) => {
    const key = attemptKey(a);
    const cur = attempts.get(key);
    if (!cur) {
      if (attemptIds.has(a.id)) {
        skip("duplicate");
        return;
      }
      attemptIds.add(a.id);
      attempts.set(key, a);
      return;
    }
    // Old upsertAttemptInList: a real result always beats a stored 'errored'; otherwise the later one wins,
    // and at the same instant the stronger one.
    const supersedesError = cur.result === "errored" && a.result !== "errored";
    if (!supersedesError && (a.at < cur.at || (a.at === cur.at && RESULT_RANK[a.result] < RESULT_RANK[cur.result]))) return;
    if (a.result === "errored" && cur.result !== "errored") {
      attempts.set(key, { ...cur, detail: a.detail ?? cur.detail, logEntryId: a.logEntryId ?? cur.logEntryId });
      return;
    }
    attempts.set(key, {
      ...cur,
      result: a.result,
      at: a.at,
      port: a.port ?? cur.port,
      detail: a.detail ?? cur.detail,
      logEntryId: a.logEntryId ?? cur.logEntryId,
    });
  };
  const keptCred = (rawId: string) => byId.get(credIdMap.get(rawId) ?? "");
  for (const raw of arr(b?.credAttempts)) {
    const credRaw = isObj(raw) ? optText(raw.credId) : null;
    const result = isObj(raw)
      ? (oneOf<AttemptResult>(RESULTS, raw.result) ?? (typeof raw.result === "string" ? LEGACY_RESULTS[raw.result] : undefined))
      : undefined;
    if (!isObj(raw) || !hasText(raw.id) || !credRaw || !hasText(raw.machineId) || !result) {
      skip("badAttempt");
      continue;
    }
    const c = keptCred(credRaw);
    if (!c) {
      // Only an attempt that belonged to this import is counted; others are simply not selected.
      if (skippedCreds.has(credRaw) || isImportedHost(raw.machineId)) skip("attemptCredMissing");
      continue;
    }
    if (!hostIn(c.engagementId, raw.machineId)) {
      skip("attemptHostMissing");
      continue;
    }
    let usernameId: string | null = null;
    if (hasText(raw.usernameId)) {
      const u = userById.get(userIdMap.get(raw.usernameId) ?? "");
      if (!u || u.engagementId !== c.engagementId) {
        skip("attemptUsernameMissing");
        continue;
      }
      usernameId = u.id;
    }
    const port = raw.port;
    upsert({
      id: raw.id.trim(),
      engagementId: c.engagementId,
      credId: c.id,
      usernameId,
      hostId: raw.machineId,
      service: oneOf<AttemptService>(SERVICES, raw.service) ?? "other",
      port: typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
      result,
      authMode: oneOf<AuthMode>(AUTH_MODES, raw.authMode) ?? (credScope.get(credRaw) === "local" ? "local" : "domain"),
      detail: optText(raw.detail),
      logEntryId: logLink(c.engagementId, raw.logEntryId),
      at: toMs(raw.at, now),
    });
  }
  for (const { rawId, credId, scope, createdAt, v } of verifications) {
    const result = typeof v.status === "string" ? VERIFICATION_RESULTS[v.status] : undefined;
    const c = byId.get(credId);
    if (!result || !c || !hasText(v.machineId)) continue;
    if (!hostIn(c.engagementId, v.machineId)) {
      skip("attemptHostMissing");
      continue;
    }
    upsert({
      id: `${rawId}:verification:${v.machineId}`,
      engagementId: c.engagementId,
      credId: c.id,
      usernameId: null,
      hostId: v.machineId,
      service: oneOf<AttemptService>(SERVICES, v.protocol) ?? "smb",
      port: null,
      result,
      authMode: scope === "local" ? "local" : "domain",
      detail: null,
      logEntryId: null,
      at: toMs(v.updatedAt, createdAt),
    });
  }
  plan.credAttempts.push(...attempts.values());
}
