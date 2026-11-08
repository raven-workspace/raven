import type { Ref } from "react";
import { cx } from "../../lib/cx";
import { shortHostName } from "../../lib/hostName";
import type { Host } from "../../types/host";
import { ChipPicker } from "./ChipPicker";
import type { ChipOption, ChipPickerHandle } from "./ChipPicker";

export type HostChipHandle = ChipPickerHandle;

/**
 * The host picker: a bordered "Host  dc01" trigger in the Tab order. A click, Enter or ⌥H (see `isHostPickKey`, `ref.open()`) opens a listbox of "No host" plus each host with its IP.
 * `engagementName` is added to the tooltip when the engagement is not the route's (full-screen Arsenal).
 */
export function HostChip({ hosts, value, onChange, engagementName, align = "end", className = "max-w-2/5", ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string;
  /** Which edge of the chip the list lines up with; "end" for a chip at the right edge of a bar. */
  align?: "start" | "end";
  /** Width limits for the chip as a whole (a share of its row by default). */
  className?: string; ref?: Ref<HostChipHandle>;
}) {
  const current = value ? hosts.find((h) => h.id === value) : undefined;
  const shortName = current ? shortHostName(current.name) : "no host";
  const options: ChipOption[] = [{ id: null, name: "No host" }, ...hosts.map((h) => ({ id: h.id, name: h.name, detail: h.ip ?? "" }))];
  return (
    <div className={cx("grid min-w-0", className)}>
      <ChipPicker
        ref={ref}
        options={options}
        value={value}
        onPick={onChange}
        label={`Fill for host: ${shortName}`}
        listLabel="Fill for host"
        title={`${current ? current.name : "No host"}${engagementName ? ` in ${engagementName}` : ""}: fill for another host (⌥H)`}
        align={align}
        prefix="Host"
        shown={current ? (engagementName ? `${shortName} in ${engagementName}` : shortName) : "No host"}
      />
    </div>
  );
}

/** ⌥H: by key code, since macOS turns ⌥H into "˙". */
export const isHostPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyH" || e.key.toLowerCase() === "h");
