import type { DragEvent, KeyboardEvent } from "react";
import { Link } from "react-router";
import type { Host } from "../../types/host";
import { Chip } from "../../ui";
import { ThreadDot } from "../notes/ThreadDot";
import { useThreadCounts } from "../notes/useThreadCounts";
import { OS_LABELS } from "../hosts/columns";


export interface BoardCardProps {
  host: Host;
  /** Move one column (-1 left, +1 right). */
  onShift: (host: Host, delta: -1 | 1) => void;
}

export function BoardCard({ host, onShift }: BoardCardProps) {
  const threads = useThreadCounts(host.engagementId).byHost.get(host.id) ?? 0;
  function onDragStart(e: DragEvent) {
    e.dataTransfer.setData("text/plain", host.id);
    e.dataTransfer.effectAllowed = "move";
  }
  // Handled on the card itself, so it only fires while the card has focus.
  function onKeyDown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      onShift(host, e.key === "[" ? -1 : 1);
    }
  }
  return (
    <Link
      to={`/e/${host.engagementId}/h/${host.id}`}
      draggable
      data-host-id={host.id}
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1 rounded border border-line bg-bg px-3 py-2 text-fg no-underline hover:border-line-strong focus-visible:outline-1 focus-visible:outline-accent"
    >
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold">{host.name}</span>
        <ThreadDot count={threads} />
      </span>
      {host.ip && (
        <span className="font-mono text-[11px] text-muted-2">{host.ip}</span>
      )}
      {(host.os || host.access !== "none") && (
        <span className="mt-0.5 flex gap-1">
          {host.os && <Chip>{OS_LABELS[host.os]}</Chip>}
          {host.access !== "none" && (
            <Chip variant="accent">{host.access}</Chip>
          )}
        </span>
      )}
    </Link>
  );
}
