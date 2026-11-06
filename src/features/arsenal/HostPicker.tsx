import type { Ref } from "react";
import type { Host } from "../../types/host";

/**
 * The "for <host>" chip, as a picker: another host of the engagement, or No host. ⌥H focuses it (see `isHostPickKey`).
 * `engagementName` is shown when the engagement is not the route's (full-screen Arsenal).
 */
export function HostPicker({ hosts, value, onChange, engagementName, ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string; ref?: Ref<HTMLSelectElement>;
}) {
  return (
    <label className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line-strong py-px pl-2 pr-1 text-[11px] leading-4 whitespace-nowrap text-fg-2">
      {engagementName ? `${engagementName} · for` : "for"}
      <select
        ref={ref}
        aria-label="Fill for host"
        title="Fill for another host (⌥H)"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="max-w-36 cursor-default bg-transparent text-[11px] text-fg outline-none"
      >
        <option value="">No host</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>
    </label>
  );
}

/** ⌥H: by key code, since macOS turns ⌥H into "˙". */
export const isHostPickKey = (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }): boolean =>
  e.altKey && !e.metaKey && !e.ctrlKey && (e.code === "KeyH" || e.key.toLowerCase() === "h");

/** Focuses the picker and opens its list where the platform allows. */
export function openPicker(el: HTMLSelectElement | null): void {
  if (!el) return;
  el.focus();
  try {
    el.showPicker?.();
  } catch {
    /* not allowed or not supported: focus is enough, arrows change the host */
  }
}
