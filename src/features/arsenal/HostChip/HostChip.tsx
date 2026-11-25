import { useImperativeHandle, useRef, type Ref } from "react";
import { cx } from "../../../lib/cx";
import { shortHostName } from "../../../lib/hostName";
import type { Host } from "../../../types/host";
import { Button } from "../../../ui/index";
import type { HostsError } from "../../commands/fillData";
import { ChipPicker } from "../ChipPicker/ChipPicker";
import type { ChipOption, ChipPickerHandle } from "../ChipPicker/ChipPicker";
import "./HostChip.scss";

export type HostChipHandle = ChipPickerHandle;

/**
 * The host picker: a bordered "Host  dc01" trigger in the Tab order. A click, Enter or ⌥H (see `isHostPickKey`, `ref.open()`) opens a listbox of "No host" plus each host with its IP.
 * `engagementName` is added to the tooltip when the engagement is not the route's (full-screen Arsenal).
 */
export function HostChip({ hosts, value, onChange, onMousePick, engagementName, align = "end", className = "host-chip--share", loadError, ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string;
  /** The hosts failed to load: the chip says so and offers a retry instead of a list (`useEngagementFillData().hostsError`). */
  loadError?: HostsError | null;
  /** After a click on a host (not a key): where focus goes next (ChipPicker's `onMousePick`). */
  onMousePick?: (id: string | null) => void;
  /** Which edge of the chip the list lines up with; "end" for a chip at the right edge of a bar. */
  align?: "start" | "end";
  /** Width limits for the chip as a whole (a share of its row by default). */
  className?: string; ref?: Ref<HostChipHandle>;
}) {
  if (loadError) return <HostsLoadError error={loadError} className={cx("host-chip", className)} ref={ref} />;
  const current = value ? hosts.find((h) => h.id === value) : undefined;
  const shortName = current ? shortHostName(current.name) : "";
  const shown = current ? (engagementName ? `${shortName} in ${engagementName}` : shortName) : "No host";
  const options: ChipOption[] = [{ id: null, name: "No host" }, ...hosts.map((h) => ({ id: h.id, name: h.name, detail: h.ip ?? "" }))];
  return (
    <div className={cx("host-chip", className)}>
      <ChipPicker
        ref={ref}
        options={options}
        value={value}
        onPick={onChange}
        {...(onMousePick ? { onMousePick } : {})}
        // Named for what picking does, as its list is; the chip itself shows the short "Host dc01".
        label={current ? `Fill for host ${shown}` : "Fill for host"}
        listLabel="Fill for host"
        title={`${current ? current.name : "No host"}${engagementName ? ` in ${engagementName}` : ""}: fill for another host (⌥H)`}
        align={align}
        prefix={current ? "Host" : ""}
        shown={shown}
      />
    </div>
  );
}

/**
 * In place of a host picker when the hosts failed to load: "Couldn't load hosts" and Retry. ⌥H (`ref.open()`) retries
 * too, and `ref.focus()` lands on Retry.
 */
export function HostsLoadError({ error, className, ref }: { error: HostsError; className?: string; ref?: Ref<HostChipHandle> }) {
  const button = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => ({ open: error.retry, focus: () => button.current?.focus() }), [error]);
  return (
    <div role="group" aria-label="Hosts" className={cx("host-load-error", className)}>
      <span className="host-load-error__text">Couldn't load hosts</span>
      <Button ref={button} size="sm" onClick={error.retry}>Retry</Button>
    </div>
  );
}

/** ⌥H: by key code, since macOS turns ⌥H into "˙". */
export const isHostPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyH" || e.key.toLowerCase() === "h");
