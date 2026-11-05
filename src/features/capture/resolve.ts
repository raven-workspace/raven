import { buildDraft, detectKind, findFlagInPaste, flagTitle, screenshotFileName, type CaptureDraft, type DraftInput } from "../../engines/capture";
import { planCredentialIntake, type CredentialIntakePlan, type PendingCredential } from "../../engines/credentials";
import { OS_LABELS } from "../hosts/columns";
import { KIND_LABELS } from "../log/kindLabels";
import type { Credential, Username } from "../../types/credentials";
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

const COLUMNS: BoardColumn[] = ["enumerate", "foothold", "privesc", "loot", "done"];

/** Flags default to `proof` once the host is at Privesc or later. */
export function defaultFlagKind(host: Host | null): FlagKind {
  return host && COLUMNS.indexOf(host.boardColumn) >= COLUMNS.indexOf("privesc") ? "proof" : "local";
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
  unknownIps: string[];
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
    autoTitle = flagTitle(flagKind, selectedHost);
  } else if (content.kind === "screenshot") {
    const fileName = screenshotFileName({
      ip: selectedHost?.ip ?? null,
      hostName: selectedHost?.name ?? null,
      column: selectedHost?.boardColumn ?? null,
      caption: pd.caption,
      mime: pd.image?.mime ?? "image/png",
    });
    content = { ...content, caption: pd.caption.trim(), fileName };
    autoTitle = selectedHost ? `Screenshot · ${selectedHost.name}` : "Screenshot";
  }

  const userTitle = pd.titleEdited && pd.title.trim() !== "";
  const scan = draft.scan;
  const scanHost = scan && hostIds.includes(scan.hostId) ? hosts.find((h) => h.id === scan.hostId) : undefined;
  const ports = (list: { port: number }[]) => list.map((p) => p.port).join(", ");
  // Saving sets the OS only on a host that has none, so the line says so before it happens.
  const osPart = (os: HostOs | null, current: HostOs | null) => (os && !current ? ` · OS: ${OS_LABELS[os]}` : "");
  let servicesLine =
    scan && scanHost ? `Updates services on ${scanHost.name}: ${ports(scan.ports)}${osPart(scan.os, scanHost.os)}` : null;
  if (!scan && kind === "command" && pd.addIps.length) {
    // First scan of a new box: the scan belongs to an IP that becomes a host on save.
    const pending = pd.addIps.map((ip) => ({ id: `new:${ip}`, name: ip, ip, column: "enumerate" as const }));
    const provisional = buildDraft({ ...draftInput, hosts: [...draftInput.hosts, ...pending] }).scan;
    const ip = provisional?.hostId.startsWith("new:") ? provisional.hostId.slice(4) : null;
    if (provisional && ip) servicesLine = `Updates services on ${ip}: ${ports(provisional.ports)}${osPart(provisional.os, null)}`;
  }

  return {
    draft,
    draftInput,
    autoTitle,
    titleInput: pd.titleEdited ? pd.title : autoTitle,
    selectedHost,
    flagKind,
    unknownIps: draft.unknownScopeIps.filter((ip) => !pd.addIps.includes(ip)),
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

/**
 * The credential intake of a command entry: what its nxc output would record against the engagement's
 * credentials, usernames and hosts. Null for any other kind, or when the output has no nxc results or roast hashes.
 */
export function intakePlanFor(
  edits: Pick<CaptureEdits, "kind" | "content">,
  ctx: { engagementId: string; hosts: Host[]; credentials: Credential[]; usernames: Username[] },
): CredentialIntakePlan | null {
  if (edits.kind !== "command" || edits.content.kind !== "command") return null;
  return planCredentialIntake({
    blocks: edits.content.blocks,
    engagement: { id: ctx.engagementId },
    hosts: ctx.hosts,
    credentials: ctx.credentials,
    usernames: ctx.usernames,
  });
}

/** Id of the host an IP ticked "+ add as host" becomes on save (as the scan preview does). */
export const provisionalHostId = (ip: string) => `new:${ip}`;

/**
 * The hosts plus a provisional host (`new:<ip>`) for each IP the user ticked to add, so the intake preview offers the
 * pairs on it (Ruling F-R2). An IP already a host (a retry after a failed save) adds nothing.
 */
export function withProvisionalHosts(hosts: Host[], engagementId: string, addIps: string[]): Host[] {
  const fresh = addIps.filter((ip) => !hosts.some((h) => h.ip === ip));
  if (fresh.length === 0) return hosts;
  return [
    ...hosts,
    ...fresh.map((ip): Host => ({
      id: provisionalHostId(ip), engagementId, name: ip, ip, os: null, boardColumn: "enumerate", boardManual: false,
      access: "none", createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null,
    })),
  ];
}

/**
 * A preview key (or toggle key) with its provisional host id swapped for the created host's id. Only a local
 * credential's key names a host (`…|local:<hostId>`).
 */
export function realIntakeKey(key: string, created: Map<string, string>): string {
  return key.replace(/\|local:(new:[^|]+)$/, (whole, pid: string) => {
    const id = created.get(pid);
    return id ? `|local:${id}` : whole;
  });
}

/** A pending credential is added when the operator turned it on; by default a success is, a failed-only pair isn't. */
export function isAccepted(p: PendingCredential, toggles: Record<string, boolean>): boolean {
  return toggles[p.key] ?? !p.failedOnly;
}
