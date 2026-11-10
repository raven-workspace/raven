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
  /** This host holds the exam's one Metasploit lock. */
  msf?: boolean;
}

export function BoardCard({ host, onShift, msf = false }: BoardCardProps) {
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
      className="grid min-w-0 gap-3 rounded border border-line-2 bg-bg p-2 text-fg no-underline transition-colors duration-100 hover:border-line-strong @min-[150px]:p-3"
    >
      {/* Two groups, spaced apart: who it is (name, IP), then what it is and what's held (OS, access). */}
      <span className="grid min-w-0 gap-1">
        <span className={cx("grid min-w-0 items-start gap-1", msf ? "grid-cols-[minmax(0,1fr)_16px_8px]" : "grid-cols-[minmax(0,1fr)_8px]")}>
          <span title={host.name} className="line-clamp-2 break-words text-body font-semibold">{host.name}</span>
          {msf && (
            // The exam's one Metasploit host, so it's never used on a second box by mistake. Sits on the name's first line.
            <span role="img" aria-label="Metasploit host" title="Metasploit host" className="grid h-5 items-center">
              <BrandIcon brand="metasploit" />
            </span>
          )}
          <ThreadDot count={threads} />
        </span>
        {host.ip && <span className="whitespace-nowrap font-mono text-code text-muted-2 [overflow-wrap:anywhere]">{host.ip}</span>}
      </span>
      {(host.os || host.access !== "none") && (
        // Wide enough (a lane body of 150px: "Windows" and a chip need about 124px inside 12px padding), the access
        // chip ends the OS row; narrower, it sits under the OS. Either way every card in a lane has the same shape.
        <div className="grid min-w-0 items-center justify-items-start gap-x-2 gap-y-1 @min-[150px]:grid-cols-[minmax(0,1fr)_auto]">
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
