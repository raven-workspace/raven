// Maps selected old-Raven engagements to new-model records. Every record carries an explicit id (its old id,
// or a derived one) so the Rust side inserts with INSERT OR IGNORE and re-import stays add-only.
// Never throws: a malformed record is skipped and counted in `skipped`.
import type { BoardColumn, HostAccess, HostOs } from "../../types/host";
import type { EngagementKind, EngagementStatus } from "../../types/engagement";
import type { CommandBlock, FlagKind, LogContent, LogKind, NewAttachment } from "../../types/log";
import type { ServiceProtocol } from "../../types/service";
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

export interface ImportPlan {
  engagements: PlanEngagement[];
  hosts: PlanHost[];
  services: PlanService[];
  logEntries: PlanLogEntry[];
  notes: PlanNote[];
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
  const plan: ImportPlan = { engagements: [], hosts: [], services: [], logEntries: [], notes: [], skipped: {} };
  const skip = (reason: string, n = 1) => {
    if (n > 0) plan.skipped[reason] = (plan.skipped[reason] ?? 0) + n;
  };
  const seen = { engagement: new Set<string>(), host: new Set<string>(), service: new Set<string>(), log: new Set<string>(), note: new Set<string>() };
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

  for (const selected of new Set(Array.isArray(selectedIds) ? selectedIds : [])) {
    const c = candidates.get(selected);
    const container = byId.get(selected);
    if (!c || !container) continue;
    const isLabSel = c.kind === "lab";
    const engagementId = isLabSel ? container.id : `${container.id}#e`;
    if (!fresh("engagement", engagementId)) continue;
    plan.engagements.push({
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
    });

    // Hosts and their services.
    const boxes = isLabSel ? boxesOf(machines, container.id) : [];
    const hostRows = isLabSel ? boxes : [container];
    const hosts = new Map<string, PlanHost>();
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
      mapServices(m);
    }

    function mapServices(m: OldMachine) {
      const ports = new Set<number>();
      const add = (port: number, protocol: ServiceProtocol, state: string, svc: string | null, ver: string | null) => {
        ports.add(port);
        const id = `${m.id}:${protocol}/${port}`;
        if (fresh("service", id)) plan.services.push({ id, hostId: m.id, port, protocol, state, nmapService: svc, nmapVersion: ver });
      };
      const validPort = (p: unknown): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535;
      for (const s of arr(m.services)) {
        const protocol = isObj(s) ? (s.protocol === undefined ? "tcp" : s.protocol) : null;
        if (!isObj(s) || !validPort(s.port) || (protocol !== "tcp" && protocol !== "udp")) {
          skip("badService");
          continue;
        }
        add(s.port, protocol, textOr(s.state, "open"), textOr(s.service, null), textOr(s.version, null));
      }
      for (const p of arr(m.openPorts)) {
        if (!validPort(p)) skip("badService");
        else if (!ports.has(p)) add(p, "tcp", "open", null, null);
      }
    }

    const hostFor = (m: OldMachine): string[] => (hosts.has(m.id) ? [m.id] : []);
    const pushLog = (e: PlanLogEntry) => {
      if (fresh("log", e.id)) plan.logEntries.push(e);
    };
    const base = (id: string, title: string, hostIds: string[], at: number) =>
      ({ id, engagementId, title: title.slice(0, 300), titleEdited: true, ranOn: null, hostIds, observations: null, returnedNothing: false, private: false, at }) as const;

    // Log entries.
    const gathered = gatherLogs(container, boxes, now);
    skip("badLogEntry", gathered.bad);
    skip("duplicate", gathered.duplicate);
    for (const raw of gathered.entries) {
      const entry = mapLog(raw);
      if (entry) pushLog(entry);
      else skip("emptyLogEntry");
    }

    function mapLog(e: RawLog): PlanLogEntry | null {
      const hostIds = [...new Set(arr(e.hostIds).filter((h): h is string => typeof h === "string" && hosts.has(h)))];
      if (!isLabSel && hostIds.length === 0) hostIds.push(...hostFor(container!));
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
        ...base(e.id as string, title || fallbackTitle || "Imported entry", hostIds, toMs(e.at, now)),
        kind: content.kind,
        ranOn: hasText(e.ranOn) ? e.ranOn : null,
        observations,
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
        const data = typeof img.data === "string" ? img.data.replace(/^data:[^,]*,/, "").trim() : "";
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
    for (const m of holders) {
      const host = hosts.get(m.id) ?? null;
      const flags: [FlagKind, unknown, unknown][] = [
        ["local", m.userFlag, m.userPwnedAt],
        ["proof", m.rootFlag, m.rootPwnedAt],
      ];
      for (const [flagKind, value, at] of flags) {
        if (!hasText(value)) continue;
        pushLog({
          ...base(`${m.id}:flag:${flagKind}`, flagTitle(flagKind, host), hostFor(m), toMs(at, now)),
          kind: "flag",
          content: { kind: "flag", flagKind, value: value.trim(), attachmentId: null, proof: null },
        });
      }
    }

    // Notes.
    const pushNote = (ownerId: string, hostId: string | null, parts: string[]) => {
      const filled = parts.filter((p) => p.trim());
      if (filled.length === 0 || !fresh("note", ownerId)) return;
      const body = filled.length === 1 ? filled[0]! : filled.map((p) => p.replace(/\s+$/, "")).join("\n\n");
      plan.notes.push({ ownerId, engagementId, hostId, body, private: false });
    };
    const quick = (m: OldMachine) => (typeof m.quickNotes === "string" ? escapeThreads(m.quickNotes) : "");
    const thread = (m: OldMachine) => (hasText(m.nextMove) ? `? ${oneLine(m.nextMove)}` : "");
    const triage = (m: OldMachine): string => {
      if (!isObj(m.portTriage)) return "";
      const rows: [number, string][] = [];
      for (const [port, t] of Object.entries(m.portTriage)) {
        if (!/^\d+$/.test(port) || !isObj(t) || !hasText(t.status)) {
          skip("badPortTriage");
          continue;
        }
        const note = hasText(t.note) ? ` — ${oneLine(t.note)}` : "";
        rows.push([Number(port), `- ${port}: ${t.status.trim()}${note}`]);
      }
      if (rows.length === 0) return "";
      return ["## Port triage", ...rows.sort((x, y) => x[0] - y[0]).map((r) => r[1])].join("\n");
    };
    if (isLabSel) pushNote(engagementId, null, [quick(container), thread(container)]);
    for (const m of hostRows) {
      if (hosts.has(m.id)) pushNote(m.id, m.id, [quick(m), thread(m), triage(m)]);
    }
  }
  return plan;
}
