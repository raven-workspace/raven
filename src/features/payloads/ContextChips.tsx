import type { Ref } from "react";
import { PASTE_CONTEXTS } from "../../engines/payloads/context";
import { ChipPicker, type ChipOption, type ChipPickerHandle } from "../arsenal/ChipPicker";
import { HostChip, type HostChipHandle } from "../arsenal/HostChip";
import { contextLabel, OS_LABEL, type PayloadFit } from "./usePayloadFit";
import { usePayloadsStore, type PayloadOverride } from "./usePayloadsStore";

const SUGGESTED_PORTS = ["443", "80"];

function Chip({ name, value, options, current, onPick, ref }: {
  name: string; value: string | null; options: ChipOption[]; current: string | null; onPick: (id: string) => void; ref?: Ref<ChipPickerHandle>;
}) {
  return (
    <ChipPicker
      ref={ref} options={options} value={current} onPick={(id) => id !== null && onPick(id)}
      label={`${name}: ${value ?? "not set"}`} listLabel={name} title={`${name} (inferred; pick to override for this host)`} align="start"
      prefix={name} {...(value ? { shown: value } : {})}
    />
  );
}

/**
 * The drawer's context row: host (⌥H), OS (⌥O), where you paste it (⌥W), and the listener port, each overridable for
 * this host (session only), then one muted line saying where each value came from. Unknown values are empty and amber.
 * OS, paste context and port are Tab stops.
 */
export function ContextChips({ fit, engagementId, onHost, hostRef, osRef, contextRef, portRef }: {
  fit: PayloadFit; engagementId: string; onHost: (id: string | null) => void;
  hostRef?: Ref<HostChipHandle>; osRef?: Ref<ChipPickerHandle>; contextRef?: Ref<ChipPickerHandle>; portRef?: Ref<ChipPickerHandle>;
}) {
  const { os, context, port, settingsPort, evidence, hostKey } = fit;
  const set = (patch: PayloadOverride) => usePayloadsStore.getState().override(hostKey, patch);
  const contexts = PASTE_CONTEXTS.filter((c) => !os || c.os === "any" || c.os === os);
  const ports = [...new Set([...SUGGESTED_PORTS, ...(settingsPort ? [settingsPort] : []), ...(port ? [port] : [])])];

  const why = [
    evidence.os ? `OS ${evidence.os}` : "OS not known: pick one",
    evidence.context ? `paste context ${evidence.context}` : "paste context not known: pick one",
    evidence.port ? `port ${evidence.port}` : "port not set",
  ];
  return (
    <div className="grid gap-2 border-b border-line px-4 py-3">
      {/* OS, paste context and port read in full; the host chip gives way (it truncates) when the row is short. */}
      <div className="grid grid-cols-[minmax(0,max-content)_repeat(3,max-content)] justify-start gap-1">
        {engagementId ? (
          <HostChip ref={hostRef} hosts={fit.d.hosts} value={fit.host?.id ?? null} onChange={onHost} align="start" className="max-w-48" />
        ) : (
          <span className="px-2 py-1 text-meta text-muted">no host</span>
        )}
        <Chip
          ref={osRef} name="OS" value={os ? OS_LABEL[os] : null} current={os}
          options={(["linux", "windows"] as const).map((o) => ({ id: o, name: OS_LABEL[o] }))}
          onPick={(id) => set({ os: id as "linux" | "windows" })}
        />
        <Chip
          ref={contextRef} name="Paste into" value={context ? contextLabel(context) : null} current={context}
          options={contexts.map((c) => ({ id: c.id, name: c.label }))}
          onPick={(id) => set({ context: id as (typeof contexts)[number]["id"] })}
        />
        <Chip
          ref={portRef} name="Port" value={port || null} current={port || null}
          options={ports.map((p) => ({ id: p, name: p, detail: p === settingsPort ? "Settings" : SUGGESTED_PORTS.includes(p) ? "egress-friendly" : "" }))}
          onPick={(id) => set({ port: id })}
        />
      </div>
      <p className="m-0 px-2 text-meta text-muted">{why.join(" · ")}</p>
    </div>
  );
}
