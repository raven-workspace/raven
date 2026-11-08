import { useMemo } from "react";
import { buildPayload } from "../../engines/payloads/build";
import { PASTE_CONTEXTS, type PasteContext } from "../../engines/payloads/context";
import { inferContext, inferSituation, rankPayloads } from "../../engines/payloads/fit";
import { staleBaked } from "../../engines/payloads/memory";
import { MSFVENOM } from "../../engines/payloads/msfvenom";
import { REVERSE_SHELLS } from "../../engines/payloads/reverseShells";
import type { BuiltPayload, GeneratorId, PayloadDef } from "../../engines/payloads/types";
import { UPGRADE } from "../../engines/payloads/upgrade";
import { useFillBase } from "../palette/fillData";
import { usePayloadsStore } from "./usePayloadsStore";

export type Os = "linux" | "windows";
export interface Ranked { fits: PayloadDef[]; misfits: { def: PayloadDef; reason: string }[]; ordered: boolean }

export const OS_LABEL: Record<Os, string> = { linux: "Linux", windows: "Windows" };
export const contextLabel = (c: PasteContext) => PASTE_CONTEXTS.find((p) => p.id === c)?.label ?? c;

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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

  const ranked = useMemo<Record<"shell" | "msfvenom" | "upgrade", Ranked>>(() => ({
    shell: { ...rankPayloads(REVERSE_SHELLS, situation, context), ordered: false },
    // msfvenom runs at your own bash prompt: where the target pastes things does not apply.
    msfvenom: { ...rankPayloads(MSFVENOM, situation, null), ordered: false },
    // Upgrade steps run in order, whatever the host.
    upgrade: { fits: UPGRADE, misfits: [], ordered: true },
  }), [situation, context]);

  /** Built with the paste context when the def works there, else the first context it declares. */
  const build = (def: PayloadDef, extra: Record<string, string> = {}): BuiltPayload => {
    const ctx = context && def.contexts.includes(context) ? context : def.contexts[0]!;
    return buildPayload(def, ctx, { ...extra, LHOST: lhost, LPORT: port });
  };

  const staleLines = useMemo(() => {
    const out = new Map<string, string>();
    for (const s of staleBaked(d.log ?? [], { LHOST: lhost, LPORT: port })) out.set(s.payloadId, `Built at ${clock(s.at)} with ${s.was}; rebuild it`);
    return out;
  }, [d.log, lhost, port]);

  return {
    d, host: host ?? null, hostKey, engagement, os, context, dbEngine, port, settingsPort, lhost, settingsLhost, lhostInput, portInput,
    evidence, ranked, build, staleLines,
  };
}

export type PayloadFit = ReturnType<typeof usePayloadFit>;
export type RankedGenerator = Extract<GeneratorId, "shell" | "msfvenom" | "upgrade">;
export const isRanked = (g: GeneratorId): g is RankedGenerator => g === "shell" || g === "msfvenom" || g === "upgrade";
