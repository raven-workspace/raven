import { useId, useRef, useState, type Ref } from "react";
import { PASTE_CONTEXTS } from "../../../engines/payloads/context";
import { filterChoices, type FilterId } from "../../../engines/payloads/filters";
import { ChipPicker, type ChipOption, type ChipPickerHandle } from "../../arsenal/ChipPicker/ChipPicker";
import { HostChip, type HostChipHandle } from "../../arsenal/HostChip/HostChip";
import { ChipSet, Input } from "../../../ui/index";
import { ToolsPicker } from "../ToolsPicker/ToolsPicker";
import { contextLabel, FILTER_LABEL, OS_LABEL, type PayloadFit } from "../usePayloadFit";
import { usePayloadsStore, type PayloadOverride } from "../usePayloadsStore";
import "./ContextChips.scss";

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
 * overridable for this host (session only), in two borderless runs; where each value came from is in its tooltip. Unknown values say
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

  // Where each value came from, for its picker's tooltip.
  const why = {
    os: evidence.os ? `OS ${evidence.os}` : "OS not known",
    context: evidence.context ? `Paste context ${evidence.context}` : "Paste context not known",
    port: evidence.port ? `Port ${evidence.port}` : "Port not set",
  };
  const clue = toggleRow && !toggles.callbacksBlocked ? callbackClue : null;
  return (
    <div className="context-chips">
      {/* Not a table: labelled settings, mostly inferred, read at a glance. Like the status strip they flow as runs of
          "Label value ⌄", borderless (the background shows on hover), 24px apart, wrapping only when the drawer is too
          narrow: the target (host, OS, paste context, port), then what gets out and what the box has. The runs sit 8px
          out so each label lines up with the text below. */}
      <div className="context-chips__runs">
      <ChipSet className="context-chips__run">
        {engagementId ? (
          <HostChip ref={hostRef} hosts={fit.d.hosts} loadError={fit.d.hostsError} value={fit.host?.id ?? null} onChange={onHost} align="start" className="context-chips__host" {...mouse} />
        ) : (
          <span className="context-chips__no-host">No host</span>
        )}
        <Chip
          ref={osRef} name="OS" value={os ? OS_LABEL[os] : null} current={os}
          options={(["linux", "windows"] as const).map((o) => ({ id: o, name: OS_LABEL[o] }))}
          onPick={(id) => set({ os: id as "linux" | "windows" })} {...mouse}
          title={`${why.os}. Pick to override for this host (⌥O)`}
        />
        <Chip
          ref={contextRef} name="Paste into" value={context ? contextLabel(context) : null} current={context}
          options={contexts.map((c) => ({ id: c.id, name: c.label }))}
          onPick={(id) => set({ context: id as (typeof contexts)[number]["id"] })} {...mouse}
          title={`${why.context}. Pick to override for this host (⌥W)`}
        />
        <div className="context-chips__port">
          <Chip
            ref={portRef} name="Port" value={port || null} current={port || null}
            title={`${why.port}. Pick to override for this host`}
            options={[
              ...ports.map((p) => ({ id: p, name: p, detail: p === settingsPort ? "Settings" : SUGGESTED_PORTS.includes(p) ? "egress-friendly" : "" })),
              { id: OTHER_PORT, name: "Other…", detail: "type a port" },
            ]}
            onPick={(id) => (id === OTHER_PORT ? setCustom("") : set({ port: id }))}
            // "Other…" leaves focus to the field it opens.
            {...(onDone ? { onMousePick: (id: string | null) => id !== OTHER_PORT && onDone() } : {})}
          />
          {field && (
            <div className="context-chips__custom">
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
              {field.invalid && <span id={noteId} className="context-chips__invalid">1–65535</span>}
            </div>
          )}
        </div>
      {/* What gets out and what the box has: callbacks, a filter wrapper where it applies, the tools. */}
      </ChipSet>
        {toggleRow && (
          <ChipSet className="context-chips__run">
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
          </ChipSet>
        )}
      </div>
      {/* Where each value came from is in its picker's tooltip; only a callback clue earns a line, in amber. */}
      {clue && <p className="context-chips__clue">{clue}</p>}
    </div>
  );
}
