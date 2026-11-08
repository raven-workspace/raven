import type { DragEvent, KeyboardEvent } from "react";
import { Link } from "react-router";
import type { Host } from "../../types/host";
import { cx } from "../../lib/cx";
import { BrandIcon, Chip } from "../../ui";
import { OS_LABELS } from "../hosts/columns";
import { ThreadDot } from "../notes/ThreadDot";
import { useThreadCounts } from "../notes/useThreadCounts";

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
      className="grid min-w-0 gap-1 rounded border border-line bg-bg px-1.5 py-2 text-fg no-underline hover:border-line-strong focus-visible:outline-1 focus-visible:outline-accent"
    >
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_8px] items-start gap-1">
        <span title={host.name} className="line-clamp-2 break-words text-body font-semibold">{host.name}</span>
        <ThreadDot count={threads} />
      </span>
      {host.ip && <span className="whitespace-nowrap font-mono text-code text-muted-2 [overflow-wrap:anywhere]">{host.ip}</span>}
      {(host.os || host.access !== "none") && (
        // OS on its own row, the access chip on its own row: every card has the same shape, whatever the widths.
        <div className="grid min-w-0 justify-items-start gap-1">
          {host.os && (
            // OS is metadata, not state: the brand icon and its name as text (DESIGN.md Chips).
            <span
              className={cx(
                "grid min-w-0 max-w-full items-center gap-1 text-meta text-fg-2",
                host.os === "other" ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[16px_minmax(0,1fr)]",
              )}
            >
              {host.os !== "other" && <BrandIcon brand={host.os} />}
              <span className="truncate">{OS_LABELS[host.os]}</span>
            </span>
          )}
          {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
        </div>
      )}
    </Link>
  );
}
