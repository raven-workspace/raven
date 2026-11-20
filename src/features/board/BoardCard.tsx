import { Fragment, type DragEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { Host } from "../../types/host";
import { cx } from "../../lib/cx";
import { BrandIcon, Chip } from "../../ui";
import { OS_LABELS } from "../hosts/columns";
import { ThreadDot } from "../notes/ThreadDot";
import { useThreadCounts } from "../notes/useThreadCounts";
import "./BoardCard.scss";

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
      className="board-card"
    >
      {/* Two groups, spaced apart: who it is (name, IP), then what it is and what's held (OS, access). */}
      <span className="board-card__who">
        <span className={cx("board-card__name-row", msf && "board-card__name-row--msf")}>
          <span title={host.name} className="board-card__name">{host.name}</span>
          {msf && (
            // The exam's one Metasploit host, so it's never used on a second box by mistake. Sits on the name's first line.
            <span role="img" aria-label="Metasploit host" title="Metasploit host" className="board-card__msf">
              <BrandIcon brand="metasploit" />
            </span>
          )}
          <ThreadDot count={threads} />
        </span>
        {host.ip && (
          // One line wherever the window can be; in a lane narrower than the address it breaks only after a dot, never mid-octet.
          <span className="board-card__ip">
            {host.ip.split(".").map((part, i, all) => (
              <Fragment key={i}>{part}{i < all.length - 1 && <>.<wbr /></>}</Fragment>
            ))}
          </span>
        )}
      </span>
      {(host.os || host.access !== "none") && (
        // Wide enough (a lane body of 156px: "Windows" and a "root" or "user" chip need about 130px inside 12px padding), the access
        // chip ends the OS row; narrower, it sits under the OS. Either way every card in a lane has the same shape.
        <div className="board-card__what">
          {host.os && (
            // OS is metadata, not state: the brand icon and its name as text (DESIGN.md Chips).
            <span
              className={cx("board-card__os", host.os === "other" && "board-card__os--other")}
            >
              {host.os !== "other" && <BrandIcon brand={host.os} />}
              <span className="board-card__os-name">{OS_LABELS[host.os]}</span>
            </span>
          )}
          {host.access !== "none" && <Chip variant="accent">{host.access}</Chip>}
        </div>
      )}
    </Link>
  );
}
