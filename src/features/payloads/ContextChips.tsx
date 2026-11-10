import { useId, useRef, useState, type Ref } from "react";
import { PASTE_CONTEXTS } from "../../engines/payloads/context";
import { filterChoices, type FilterId } from "../../engines/payloads/filters";
import { ChipPicker, type ChipOption, type ChipPickerHandle } from "../arsenal/ChipPicker";
import { HostChip, type HostChipHandle } from "../arsenal/HostChip";
import { Input } from "../../ui";
import { ToolsPicker } from "./ToolsPicker";
import { contextLabel, FILTER_LABEL, OS_LABEL, type PayloadFit } from "./usePayloadFit";
import { usePayloadsStore, type PayloadOverride } from "./usePayloadsStore";

const SUGGESTED_PORTS = ["443", "80"];
/** The Port chip's last option: opens an inline field for any port. */
const OTHER_PORT = "__other";
/** A port you can listen on: 1–65535, digits only. */
const validPort = (p: string) => /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;

function Chip({ name, value, options, current, onPick, onMousePick, warn, title, ref }: {
  name: string; value: string | null; options: ChipOption[]; current: string | null; onPick: (id: string) => void;
  onMousePick?: (id: string | null) => void; warn?: boolean; title?: string; ref?: Ref<ChipPickerHandle>;
}) {
  return (
    <ChipPicker
      ref={ref} options={options} value={current} onPick={(id) => id !== null && onPick(id)} {...(onMousePick ? { onMousePick } : {})}
      label={`${name}: ${value ?? "not set"}`} listLabel={name} title={title ?? `${name} (inferred; pick to override for this host)`} align="start"
      prefix={name} {...(value ? { shown: value } : {})} {...(warn ? { warn } : {})}
    />
  );
}

/**
 * The drawer's context pickers: host (⌥H) on its own line, then OS (⌥O), where you paste it (⌥W) and the listener port
 * (443, 80, Settings', or "Other…": an inline numeric field, ↵ sets it, Esc drops it),
 * then, for Shell and msfvenom, Callbacks (⌥B), Filter (⌥F, Shell only, where the payload goes through an injection point) and Tools (⌥T), each
 * overridable for this host (session only), then one muted line saying where each value came from. Unknown values say
 * an amber "Pick one". A callback clue turns the Callbacks value amber and shows in that line; it never flips the
 * chip. All are Tab stops.
 */
export function ContextChips({ fit, engagementId, onHost, onDone, toggleRow, filterChip, hostRef, osRef, contextRef, portRef, callbacksRef, filterRef, toolsRef }: {
  fit: PayloadFit; engagementId: string; onHost: (id: string | null) => void;
  /** After a mouse pick or a typed port: focus back to the payload, so ↵ copies instead of reopening the chip. */
  onDone?: () => void;
  /** Show Callbacks, Filter and Tools (the Shell and msfvenom generators). */
  toggleRow: boolean;
  /** Show Filter in that row (Shell, where the filter applies). */
  filterChip: boolean;
  hostRef?: Ref<HostChipHandle>; osRef?: Ref<ChipPickerHandle>; contextRef?: Ref<ChipPickerHandle>; portRef?: Ref<ChipPickerHandle>;
  callbacksRef?: Ref<ChipPickerHandle>; filterRef?: Ref<ChipPickerHandle>; toolsRef?: Ref<ChipPickerHandle>;
}) {
  const { os, context, port, settingsPort, evidence, hostKey, toggles, callbackClue, filter } = fit;
  const set = (patch: PayloadOverride) => usePayloadsStore.getState().override(hostKey, patch);
  const contexts = PASTE_CONTEXTS.filter((c) => !os || c.os === "any" || c.os === os);
  const ports = [...new Set([...SUGGESTED_PORTS, ...(settingsPort ? [settingsPort] : []), ...(port ? [port] : [])])];
  const mouse = onDone ? { onMousePick: () => onDone() } : {};
  // The "Other…" port field, open while you type: ↵ sets a valid port (stored without leading zeros) and goes back to the
  // payload; ↵ on an empty or out-of-range one keeps the field open, marked with an amber "1–65535". Esc drops what was
  // typed and goes back to the chip; leaving it for anything else sets a valid port and leaves focus where it went.
  // The field belongs to the host it was opened for: another host closes it, so it never sets that host's port.
  const [customState, setCustomState] = useState<{ host: string; text: string; invalid: boolean } | null>(null);
  if (customState && customState.host !== hostKey) setCustomState(null);
  const field = customState?.host === hostKey ? customState : null;
  const custom = field?.text ?? null;
  const setCustom = (text: string | null) => setCustomState(text === null ? null : { host: hostKey, text, invalid: false });
  const noteId = useId();
  /** Set while ↵ or Esc moves focus away, so the field's own blur does not act a second time. */
  const closing = useRef(false);
  const portChip = () => (portRef && "current" in portRef ? portRef.current : null);
  const closeCustom = (keep: boolean) => {
    if (keep && custom !== null && validPort(custom)) set({ port: String(Number(custom)) });
    setCustom(null);
  };

  const why = [
    evidence.os ? `OS ${evidence.os}` : "OS not known: pick one",
    evidence.context ? `paste context ${evidence.context}` : "paste context not known: pick one",
    evidence.port ? `port ${evidence.port}` : "port not set",
  ];
  const clue = toggleRow && !toggles.callbacksBlocked ? callbackClue : null;
  return (
    <div className="grid gap-2 border-b border-line px-4 py-3">
      {/* The host on its own line, so a long name reads instead of being squeezed to nothing beside the other three. */}
      <div className="grid grid-cols-[minmax(0,max-content)] justify-start">
        {engagementId ? (
          <HostChip ref={hostRef} hosts={fit.d.hosts} value={fit.host?.id ?? null} onChange={onHost} align="start" className="max-w-full" {...mouse} />
        ) : (
          <span className="py-1 text-meta text-muted">No host</span>
        )}
      </div>
      {/* OS, paste context and port read in full; the "Other…" port field opens under the Port chip, in its column, so the
          row never grows wider than the drawer (beside it, a long paste context pushed the field and the list past 560px). */}
      <div className="grid grid-cols-[repeat(3,max-content)] items-start justify-start gap-2">
        <Chip
          ref={osRef} name="OS" value={os ? OS_LABEL[os] : null} current={os}
          options={(["linux", "windows"] as const).map((o) => ({ id: o, name: OS_LABEL[o] }))}
          onPick={(id) => set({ os: id as "linux" | "windows" })} {...mouse}
        />
        <Chip
          ref={contextRef} name="Paste into" value={context ? contextLabel(context) : null} current={context}
          options={contexts.map((c) => ({ id: c.id, name: c.label }))}
          onPick={(id) => set({ context: id as (typeof contexts)[number]["id"] })} {...mouse}
        />
        <div className="grid content-start gap-1">
          <Chip
            ref={portRef} name="Port" value={port || null} current={port || null}
            options={[
              ...ports.map((p) => ({ id: p, name: p, detail: p === settingsPort ? "Settings" : SUGGESTED_PORTS.includes(p) ? "egress-friendly" : "" })),
              { id: OTHER_PORT, name: "Other…", detail: "type a port" },
            ]}
            onPick={(id) => (id === OTHER_PORT ? setCustom("") : set({ port: id }))}
            // "Other…" leaves focus to the field it opens.
            {...(onDone ? { onMousePick: (id: string | null) => id !== OTHER_PORT && onDone() } : {})}
          />
          {field && (
            <div className="grid w-24 content-start gap-1">
              <Input
                mono autoFocus aria-label="Custom port" placeholder="port" inputMode="numeric" value={field.text} data-own-esc=""
                {...(field.invalid ? { "aria-invalid": true, "aria-describedby": noteId } : {})}
                title="Any port to listen on: ↵ sets it for this host, Esc drops it"
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 5))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== "Escape") return;
                  e.preventDefault();
                  e.stopPropagation();
                  // Not a port: the field stays, marked, and nothing moves (the next ↵ must not copy with the old port).
                  if (e.key === "Enter" && !validPort(field.text)) return setCustomState({ ...field, invalid: true });
                  closing.current = true;
                  closeCustom(e.key === "Enter");
                  if (e.key === "Enter" && onDone) onDone();
                  else portChip()?.focus();
                  closing.current = false;
                }}
                onBlur={() => !closing.current && closeCustom(true)}
              />
              {field.invalid && <span id={noteId} className="text-meta text-warn">1–65535</span>}
            </div>
          )}
        </div>
      </div>
      {/* What gets out and what the box has: callbacks, a filter wrapper where it applies, the tools. */}
      {toggleRow && (
        <div className={`grid ${filterChip ? "grid-cols-[repeat(3,max-content)]" : "grid-cols-[repeat(2,max-content)]"} justify-start gap-2`}>
          <Chip
            ref={callbacksRef} name="Callbacks" value={toggles.callbacksBlocked ? "blocked" : "allowed"} current={toggles.callbacksBlocked ? "blocked" : "allowed"}
            options={[{ id: "allowed", name: "allowed" }, { id: "blocked", name: "blocked", detail: "binds first" }]}
            onPick={(id) => set({ callbacksBlocked: id === "blocked" })} warn={clue !== null} {...mouse}
            title="Whether a reverse shell can call back to Kali (pick for this host)"
          />
          {filterChip && (
            <Chip
              ref={filterRef} name="Filter" value={FILTER_LABEL[filter]} current={filter}
              options={filterChoices(os).map((f) => ({ id: f, name: FILTER_LABEL[f] }))}
              onPick={(id) => set({ filter: id as FilterId })} {...mouse}
              title="A wrapper that hides the payload's characters from a filtered injection point (pick for this host)"
            />
          )}
          <ToolsPicker ref={toolsRef} own={toggles.tools} log={fit.logTools} onChange={(tools) => set({ tools })} />
        </div>
      )}
      {/* One span per value, so each source reads on its own and a narrow drawer wraps between them first. */}
      <p className="m-0 text-meta text-muted">
        {why.map((w) => <span key={w} className="mr-4 inline-block last:mr-0">{w}</span>)}
        {clue && <span className="inline-block text-warn">{clue}</span>}
      </p>
    </div>
  );
}
