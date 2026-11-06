import type { Ref } from "react";
import type { Host } from "../../types/host";

/**
 * The host scope at the right edge of the search bar: a compact muted "for <host> ⌄" over a native select (another
 * host of the engagement, listed with its IP, or No host). ⌥H opens it (see `isHostPickKey`).
 * `engagementName` is shown when the engagement is not the route's (full-screen Arsenal).
 */
export function HostPicker({ hosts, value, onChange, engagementName, ref }: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void; engagementName?: string; ref?: Ref<HTMLSelectElement>;
}) {
  const current = value ? hosts.find((h) => h.id === value) : undefined;
  return (
    <label className="relative inline-flex min-w-0 shrink-0 cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap text-muted hover:bg-surface-2 focus-within:bg-surface-2 focus-within:ring-1 focus-within:ring-line-strong">
      {engagementName ? `${engagementName} · for` : "for"}
      <b className="max-w-36 truncate font-medium text-fg-2">{current?.name ?? "no host"}</b>
      <span aria-hidden="true" className="text-[10px] opacity-70">⌄</span>
      <select
        ref={ref}
        aria-label="Fill for host"
        title="Fill for another host (⌥H)"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 h-full w-full cursor-default opacity-0"
      >
        <option value="">No host</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id} label={h.ip ? `${h.name}  ${h.ip}` : h.name}>{h.name}</option>
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
