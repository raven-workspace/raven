import { useMemo } from "react";
import { buildPayload } from "../../engines/payloads/build";
import { PASTE_CONTEXTS, type PasteContext } from "../../engines/payloads/context";
import { FILTER_CONTEXTS, type FilterId } from "../../engines/payloads/filters";
import { callbackClue, inferContext, inferredTools, inferSituation, rankPayloads, type Toggles } from "../../engines/payloads/fit";
import { MSFVENOM } from "../../engines/payloads/msfvenom";
import { SHELLS } from "../../engines/payloads/shells";
import type { BuiltPayload, GeneratorId, PayloadDef } from "../../engines/payloads/types";
import { UPGRADE } from "../../engines/payloads/upgrade";
import { useFillBase } from "../palette/fillData";
import { usePayloadsStore } from "./usePayloadsStore";

export type Os = "linux" | "windows";
export interface Ranked {
  fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[]; ordered: boolean;
  /** Why a fit sorted down (Needs a callback, Needs python3, Failed here before), by def id; never folds it. */
  marks: Record<string, string[]>;
}
const NO_TOOLS: Toggles["tools"] = {};

export const OS_LABEL: Record<Os, string> = { linux: "Linux", windows: "Windows" };
export const FILTER_LABEL: Record<FilterId, string> = { off: "off", b64: "base64", ifs: "base64 + ${IFS}", hex: "hex", "ps-b64": "PowerShell -e" };
export const contextLabel = (c: PasteContext) => PASTE_CONTEXTS.find((p) => p.id === c)?.label ?? c;

/**
 * Everything the Payloads views need for one engagement and host: the inferred situation with this session's
 * overrides on top, the values payloads are built with, and each catalogue ranked for it.
 * The host key for overrides is the host id, or "" with no host.
 */
export function usePayloadFit(engagementId: string, hostId: string | null) {
  const { d, host, engagement } = useFillBase(engagementId, hostId);
  const hostKey = host?.id ?? "";
  const ov = usePayloadsStore((s) => s.overrides[hostKey]);
  const lhostOverride = usePayloadsStore((s) => s.lhost);
  const listenerPick = usePayloadsStore((s) => s.listenerPick);

  const inferred = useMemo(() => {
    const services = host ? (d.services ?? []).filter((s) => s.hostId === host.id) : [];
    return inferSituation({ host: host ?? null, services, entries: host ? (d.log ?? []) : [], examKind: engagement.kind === "exam-sim" });
  }, [host, d.services, d.log, engagement.kind]);

  const os: Os | null = ov?.os ?? inferred.situation.os;
  const context: PasteContext | null = ov?.context ?? inferContext(inferred.situation);
  const settingsPort = d.settings?.listenerPort ?? "";
  const settingsLhost = d.settings?.attackerIp ?? "";
  // A cleared field ("") is unset, so Settings fills it again; the field itself keeps showing what you typed.
  const port = ov?.port || settingsPort;
  const lhost = lhostOverride || settingsLhost;
  /** What the LHOST and LPORT fields show: your value, "" while cleared, else Settings'. */
  const lhostInput = lhostOverride ?? settingsLhost;
  const portInput = ov?.port ?? settingsPort;
  const situation = useMemo(() => ({ ...inferred.situation, os }), [inferred.situation, os]);

  const evidence = {
    os: ov?.os ? "set by you" : (inferred.evidence.os ?? null),
    context: ov?.context ? "set by you" : (inferred.evidence.prompt ?? inferred.evidence.webShellUrl ?? null),
    port: ov?.port ? "set by you" : settingsPort ? "from Settings" : null,
    dbEngine: ov?.sqlEngine ? "set by you" : (inferred.evidence.dbEngine ?? null),
  };
  const dbEngine = ov?.sqlEngine ?? inferred.situation.dbEngine;

  // Your toggles, session only. Raven never sets them: a clue only says so (callbackClue).
  const callbacksBlocked = ov?.callbacksBlocked ?? false;
  const ownTools = ov?.tools ?? NO_TOOLS;
  const toggles = useMemo<Toggles>(() => ({ callbacksBlocked, tools: ownTools }), [callbacksBlocked, ownTools]);
  /** What the log says about each tool, before your ticks. */
  const logTools = useMemo(() => inferredTools(situation), [situation]);
  const clue = useMemo(() => callbackClue(situation, SHELLS), [situation]);
  /** The filter applies only where the payload goes through an injection point. */
  const filterApplies = context !== null && FILTER_CONTEXTS.includes(context);
  const filter: FilterId = ov?.filter ?? "off";

  const ranked = useMemo<Record<"shell" | "msfvenom" | "upgrade", Ranked>>(() => ({
    shell: { ...rankPayloads(SHELLS, situation, context, toggles), ordered: false },
    // msfvenom runs at your own bash prompt: where the target pastes things does not apply.
    msfvenom: { ...rankPayloads(MSFVENOM, situation, null, toggles), ordered: false },
    // Upgrade steps run in order, whatever the host.
    upgrade: { fits: UPGRADE, misfits: [], marks: {}, ordered: true },
  }), [situation, context, toggles]);

  /**
   * Built with the paste context when the def works there, else the first context it declares; for the OS in view, the
   * listener you picked for it, your filter where it applies, and the host's IP for a bind shell's connect line.
   */
  const build = (def: PayloadDef, extra: Record<string, string> = {}): BuiltPayload => {
    const ctx = context && def.contexts.includes(context) ? context : def.contexts[0]!;
    const pick = listenerPick[def.id];
    return buildPayload(
      def, ctx, { ...extra, TARGET_IP: extra.TARGET_IP || (host?.ip ?? ""), LHOST: lhost, LPORT: port },
      { ...(os ? { os } : {}), ...(pick ? { listener: pick } : {}), ...(filterApplies ? { filter } : {}) },
    );
  };

  // Task 8 wires staleBuild (build memory) here; until then nothing is flagged stale.
  const staleLines = useMemo(() => new Map<string, string>(), []);

  return {
    d, host: host ?? null, hostKey, engagement, os, context, dbEngine, port, settingsPort, lhost, settingsLhost, lhostInput, portInput,
    evidence, ranked, build, staleLines, toggles, logTools, callbackClue: clue, filter, filterApplies,
  };
}

export type PayloadFit = ReturnType<typeof usePayloadFit>;
export type RankedGenerator = Extract<GeneratorId, "shell" | "msfvenom" | "upgrade">;
export const isRanked = (g: GeneratorId): g is RankedGenerator => g === "shell" || g === "msfvenom" || g === "upgrade";
