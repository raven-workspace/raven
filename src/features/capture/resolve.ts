import { buildDraft, detectKind, flagTitle, screenshotFileName, type CaptureDraft } from "../../engines/capture";
import type { BoardColumn, Host } from "../../types/host";
import type { FlagKind, LogContent, LogKind } from "../../types/log";
import type { CaptureEdits } from "./saveCapture";
import type { PanelDraft } from "./useCaptureStore";

export const KINDS: { kind: LogKind; label: string }[] = [
  { kind: "command", label: "Command" },
  { kind: "screenshot", label: "Screenshot" },
  { kind: "http", label: "HTTP" },
  { kind: "note", label: "Note" },
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
  const draft = buildDraft({
    text: kind === "screenshot" ? pd.caption : pd.text,
    image: pd.image ? { mime: pd.image.mime } : null,
    kind,
    hosts: hosts.map((h) => ({ id: h.id, name: h.name, ip: h.ip, column: h.boardColumn })),
    scope: ctx.scope,
    domain: ctx.domain,
    machines: ctx.machines,
    lastRanOn: ctx.lastRanOn,
  });

  const known = new Set(hosts.map((h) => h.id));
  const preset = ctx.presetHostId && known.has(ctx.presetHostId) ? [ctx.presetHostId] : [];
  const hostIds = (pd.hostIds ?? (draft.hostIds.length ? draft.hostIds : preset)).filter((id) => known.has(id));
  const selectedHost = hosts.find((h) => h.id === hostIds[0]) ?? null;
  const flagKind = pd.flagKind ?? defaultFlagKind(selectedHost);

  let content: LogContent = draft.content;
  let autoTitle = draft.title;
  if (content.kind === "flag") {
    content = { ...content, flagKind, value: pd.text.trim() };
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
  const servicesLine =
    scan && scanHost ? `Updates services on ${scanHost.name}: ${scan.ports.map((p) => p.port).join(", ")}` : null;

  return {
    draft,
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
