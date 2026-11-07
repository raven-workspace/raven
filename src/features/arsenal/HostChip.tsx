import type { Ref } from "react";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import { ChipPicker } from "./ChipPicker";
import type { ChipOption, ChipPickerHandle } from "./ChipPicker";

export type HostChipHandle = ChipPickerHandle;

/**
 * The host scope at the right edge of the search bar: a compact muted "for <host> ⌄" button with no Tab stop.
 * A click or ⌥H (see `isHostPickKey`, `ref.open()`) opens a listbox of "No host" plus each host with its IP.
 * `engagementName` is shown when the engagement is not the route's (full-screen Arsenal).
 */
export function HostChip({ hosts, value, onChange, engagementName, align = "end", ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string;
  /** Which edge of the chip the list lines up with; "end" for a chip at the right edge of a bar. */
  align?: "start" | "end"; ref?: Ref<HostChipHandle>;
}) {
  const current = value ? hosts.find((h) => h.id === value) : undefined;
  const shortName = current ? shortHostName(current.name) : "no host";
  const options: ChipOption[] = [{ id: null, name: "No host" }, ...hosts.map((h) => ({ id: h.id, name: h.name, detail: h.ip ?? "" }))];
  return (
    <div className="grid min-w-0 max-w-2/5">
      <ChipPicker
        ref={ref}
        options={options}
        value={value}
        onPick={onChange}
        label={`Fill for host: ${shortName}`}
        listLabel="Fill for host"
        title={engagementName ? `${engagementName} · fill for another host (⌥H)` : "Fill for another host (⌥H)"}
        align={align}
      >
        {engagementName ? <span className="min-w-0 truncate">{engagementName} ·</span> : null}
        <span>for</span>
        <b className="max-w-36 truncate font-medium text-fg-2">{shortName}</b>
        <span aria-hidden="true" className="text-[10px] opacity-70">⌄</span>
      </ChipPicker>
    </div>
  );
}

/** ⌥H: by key code, since macOS turns ⌥H into "˙". */
export const isHostPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyH" || e.key.toLowerCase() === "h");
