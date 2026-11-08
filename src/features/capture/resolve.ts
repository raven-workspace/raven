import { buildDraft, detectKind, findFlagInPaste, flagTitle, noteTitle, screenshotFileName, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { OS_LABELS } from "../hosts/columns";
import { KIND_LABELS } from "../log/kindLabels";
import type { BoardColumn, Host, HostOs } from "../../types/host";
import type { FlagKind, LogContent, LogKind } from "../../types/log";
import type { CaptureEdits } from "./saveCapture";
import type { PanelDraft } from "./useCaptureStore";

export const KINDS: { kind: LogKind; label: string }[] = [
  { kind: "command", label: "Command" },
  { kind: "screenshot", label: "Screenshot" },
  { kind: "http", label: "HTTP" },
  { kind: "note", label: KIND_LABELS.note },
  { kind: "flag", label: "Flag" },
];

const COLUMNS: BoardColumn[] = [
  "information-gathering", "vulnerability-detection", "initial-foothold", "privilege-escalation", "post-exploitation", "reporting",
];

/** Flags default to `proof` once the host is at Privilege escalation or later. */
export function defaultFlagKind(host: Host | null): FlagKind {
  return host && COLUMNS.indexOf(host.boardColumn) >= COLUMNS.indexOf("privilege-escalation") ? "proof" : "local";
}

export interface CaptureContext {
  hosts: Host[];
  scope: string[];
  domain: string;
  machines: string[];
  lastRanOn: string | null;
  /** Host preselected because capture was opened from its view. */
  presetHostId: string | null;
}

export interface Resolved {
  draft: CaptureDraft;
  /** What `draft` was built from; saving re-runs it once new hosts exist. */
  draftInput: DraftInput;
  edits: CaptureEdits;
  /** Title Raven would use; the placeholder when the user clears the field. */
  autoTitle: string;
  /** What the title field shows: the user's text once edited, else the suggestion. */
  titleInput: string;
  /** The host the flag, screenshot name and title refer to: the first linked one. */
  selectedHost: Host | null;
  servicesLine: string | null;
  flagKind: FlagKind;
  canSave: boolean;
}

/** Turns the panel's input plus the engine's suggestions into the fields that will be saved. */
export function resolveCapture(pd: PanelDraft, ctx: CaptureContext): Resolved {
  const { hosts } = ctx;
  const kind = pd.kind ?? detectKind(pd.text, pd.image !== null);
  const draftInput: DraftInput = {
    text: kind === "screenshot" ? pd.caption : pd.text,
    image: pd.image ? { mime: pd.image.mime } : null,
    kind,
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, ip: h.ip, column: h.boardColumn })),
    scope: ctx.scope,
    domain: ctx.domain,
    machines: ctx.machines,
    lastRanOn: ctx.lastRanOn,
  };
  const draft = buildDraft(draftInput);

  const known = new Set(hosts.map((h) => h.id));
  const preset = ctx.presetHostId && known.has(ctx.presetHostId) ? [ctx.presetHostId] : [];
  const hostIds = (pd.hostIds ?? (draft.hostIds.length ? draft.hostIds : preset)).filter((id) => known.has(id));
  const selectedHost = hosts.find((h) => h.id === hostIds[0]) ?? null;
  // A pasted proof block names its file; that beats the guess from the host's board column.
  const found = kind === "flag" ? findFlagInPaste(pd.text) : null;
  const flagKind = pd.flagKind ?? found?.flagKind ?? defaultFlagKind(selectedHost);

  let content: LogContent = draft.content;
  let autoTitle = draft.title;
  if (content.kind === "flag") {
    content = { ...content, flagKind, value: found?.value ?? pd.text.trim(), proof: found ? pd.text.trim() : null };
    autoTitle = flagTitle(flagKind);
  } else if (content.kind === "screenshot") {
    const fileName = screenshotFileName({
      ip: selectedHost?.ip ?? null,
      hostName: selectedHost?.name ?? null,
      column: selectedHost?.boardColumn ?? null,
      caption: pd.caption,
      mime: pd.image?.mime ?? "image/png",
    });
    content = { ...content, caption: pd.caption.trim(), fileName };
    autoTitle = noteTitle(pd.caption) || "Screenshot";
  }

  const userTitle = pd.titleEdited && pd.title.trim() !== "";
  const scan = draft.scan;
  const scanHost = scan && hostIds.includes(scan.hostId) ? hosts.find((h) => h.id === scan.hostId) : undefined;
  const ports = (list: { port: number }[]) => list.map((p) => p.port).join(", ");
  // Saving sets the OS only on a host that has none, so the line says so before it happens.
  // Each host is its own sentence; a newly learnt OS is a second one ("OS: Linux."), never a " · " join.
  const osPart = (os: HostOs | null, current: HostOs | null) => (os && !current ? ` OS: ${OS_LABELS[os]}.` : "");
  let servicesLine =
    scan && scanHost ? `Updates services on ${scanHost.name}: ${ports(scan.ports)}.${osPart(scan.os, scanHost.os)}` : null;
  if (!scan && kind === "command") {
    // First scan of a new box: the scan's open ports prove the IP, which becomes a host on save.
    const lines = newHostScans(draft, draftInput).map(({ ip, scan: s }) => `Updates services on ${ip}: ${ports(s.ports)}.${osPart(s.os, null)}`);
    if (lines.length) servicesLine = lines.join(" ");
  }

  return {
    draft,
    draftInput,
    autoTitle,
    titleInput: pd.titleEdited ? pd.title : autoTitle,
    selectedHost,
    flagKind,
    servicesLine,
    canSave: kind === "screenshot" ? pd.image !== null : pd.text.trim() !== "",
    edits: {
      kind,
      title: userTitle ? pd.title : autoTitle,
      titleEdited: userTitle,
      hostIds,
      ranOn: pd.ranOn ?? draft.ranOn,
      observations: pd.observations,
      returnedNothing: kind === "command" && pd.returnedNothing,
      private: pd.private,
      content,
    },
  };
}

const OPEN_STATES = new Set(["open", "open|filtered"]);

/**
 * The scans of a command's IPs that aren't hosts yet and show an open port (which proves the host; it is made on
 * save). Each IP is tried alone, so a multi-host scan gives each new IP its own section.
 */
export function newHostScans(
  draft: CaptureDraft,
  draftInput: DraftInput,
): { ip: string; scan: NonNullable<CaptureDraft["scan"]> }[] {
  if (draft.scan) return [];
  return draft.unknownScopeIps.flatMap((ip) => {
    const pending = { id: `new:${ip}`, name: ip, ip, column: "information-gathering" as const };
    const scan = buildDraft({ ...draftInput, kind: "command", hosts: [...draftInput.hosts, pending] }).scan;
    return scan?.hostId === pending.id && scan.ports.some((p) => OPEN_STATES.has(p.state.toLowerCase())) ? [{ ip, scan }] : [];
  });
}
