import type { Ref } from "react";
import { PASTE_CONTEXTS } from "../../engines/payloads/context";
import { filterChoices, type FilterId } from "../../engines/payloads/filters";
import { ChipPicker, type ChipOption, type ChipPickerHandle } from "../arsenal/ChipPicker";
import { HostChip, type HostChipHandle } from "../arsenal/HostChip";
import { ToolsPicker } from "./ToolsPicker";
import { contextLabel, FILTER_LABEL, OS_LABEL, type PayloadFit } from "./usePayloadFit";
import { usePayloadsStore, type PayloadOverride } from "./usePayloadsStore";

const SUGGESTED_PORTS = ["443", "80"];

function Chip({ name, value, options, current, onPick, warn, title, ref }: {
  name: string; value: string | null; options: ChipOption[]; current: string | null; onPick: (id: string) => void;
  warn?: boolean; title?: string; ref?: Ref<ChipPickerHandle>;
}) {
  return (
    <ChipPicker
      ref={ref} options={options} value={current} onPick={(id) => id !== null && onPick(id)}
      label={`${name}: ${value ?? "not set"}`} listLabel={name} title={title ?? `${name} (inferred; pick to override for this host)`} align="start"
      prefix={name} {...(value ? { shown: value } : {})} {...(warn ? { warn } : {})}
    />
  );
}

/**
 * The drawer's context pickers: host (⌥H) on its own line, then OS (⌥O), where you paste it (⌥W) and the listener port,
 * then Callbacks (⌥B), Filter (⌥F, only where the payload goes through an injection point) and Tools (⌥T), each
 * overridable for this host (session only), then one muted line saying where each value came from. Unknown values say
 * an amber "Pick one". A callback clue turns the Callbacks value amber and shows in that line; it never flips the
 * chip. All are Tab stops.
 */
export function ContextChips({ fit, engagementId, onHost, hostRef, osRef, contextRef, portRef, callbacksRef, filterRef, toolsRef }: {
  fit: PayloadFit; engagementId: string; onHost: (id: string | null) => void;
  hostRef?: Ref<HostChipHandle>; osRef?: Ref<ChipPickerHandle>; contextRef?: Ref<ChipPickerHandle>; portRef?: Ref<ChipPickerHandle>;
  callbacksRef?: Ref<ChipPickerHandle>; filterRef?: Ref<ChipPickerHandle>; toolsRef?: Ref<ChipPickerHandle>;
}) {
  const { os, context, port, settingsPort, evidence, hostKey, toggles, callbackClue, filter, filterApplies } = fit;
  const set = (patch: PayloadOverride) => usePayloadsStore.getState().override(hostKey, patch);
  const contexts = PASTE_CONTEXTS.filter((c) => !os || c.os === "any" || c.os === os);
  const ports = [...new Set([...SUGGESTED_PORTS, ...(settingsPort ? [settingsPort] : []), ...(port ? [port] : [])])];

  const why = [
    evidence.os ? `OS ${evidence.os}` : "OS not known: pick one",
    evidence.context ? `paste context ${evidence.context}` : "paste context not known: pick one",
    evidence.port ? `port ${evidence.port}` : "port not set",
  ];
  const clue = !toggles.callbacksBlocked ? callbackClue : null;
  return (
    <div className="grid gap-2 border-b border-line px-4 py-3">
      {/* The host on its own line, so a long name reads instead of being squeezed to nothing beside the other three. */}
      <div className="grid grid-cols-[minmax(0,max-content)] justify-start">
        {engagementId ? (
          <HostChip ref={hostRef} hosts={fit.d.hosts} value={fit.host?.id ?? null} onChange={onHost} align="start" className="max-w-full" />
        ) : (
          <span className="py-1 text-meta text-muted">No host</span>
        )}
      </div>
      {/* OS, paste context and port read in full. */}
      <div className="grid grid-cols-[repeat(3,max-content)] justify-start gap-2">
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
      {/* What gets out and what the box has: callbacks, a filter wrapper where it applies, the tools. */}
      <div className={`grid ${filterApplies ? "grid-cols-[repeat(3,max-content)]" : "grid-cols-[repeat(2,max-content)]"} justify-start gap-2`}>
        <Chip
          ref={callbacksRef} name="Callbacks" value={toggles.callbacksBlocked ? "blocked" : "allowed"} current={toggles.callbacksBlocked ? "blocked" : "allowed"}
          options={[{ id: "allowed", name: "allowed" }, { id: "blocked", name: "blocked", detail: "binds first" }]}
          onPick={(id) => set({ callbacksBlocked: id === "blocked" })} warn={clue !== null}
          title="Whether a reverse shell can call back to Kali (pick for this host)"
        />
        {filterApplies && (
          <Chip
            ref={filterRef} name="Filter" value={FILTER_LABEL[filter]} current={filter}
            options={filterChoices(os).map((f) => ({ id: f, name: FILTER_LABEL[f] }))}
            onPick={(id) => set({ filter: id as FilterId })}
            title="A wrapper that hides the payload's characters from a filtered injection point (pick for this host)"
          />
        )}
        <ToolsPicker ref={toolsRef} own={toggles.tools} log={fit.logTools} onChange={(tools) => set({ tools })} />
      </div>
      {/* One span per value, so each source reads on its own and a narrow drawer wraps between them first. */}
      <p className="m-0 text-meta text-muted">
        {why.map((w) => <span key={w} className="mr-4 inline-block last:mr-0">{w}</span>)}
        {clue && <span className="inline-block text-warn">{clue}</span>}
      </p>
    </div>
  );
}
