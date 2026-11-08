import { useEffect, useRef, useState, type DragEvent } from "react";
import { useParams } from "react-router";
import type { BoardColumn, Host } from "../../types/host";
import { Button, EmptyState, labelClass } from "../../ui";
import { cx } from "../../lib/cx";
import { COLUMN_LABELS } from "../hosts/columns";
import { HostDialog } from "../hosts/HostDialog";
import { useHostMutations, useHosts } from "../hosts/queries";
import { BoardCard } from "./BoardCard";

const ORDER: BoardColumn[] = [
  "information-gathering",
  "vulnerability-detection",
  "initial-foothold",
  "privilege-escalation",
  "post-exploitation",
  "reporting",
];

export function Board() {
  const { id = "" } = useParams();
  const hosts = useHosts(id);
  const { move } = useHostMutations(id);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [adding, setAdding] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const refocus = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // A moved card remounts in its new column; give it focus back.
  useEffect(() => {
    const hostId = refocus.current;
    if (!hostId) return;
    const el = root.current?.querySelector<HTMLElement>(
      `[data-host-id="${hostId}"]`,
    );
    if (el) {
      el.focus();
      refocus.current = null;
    }
  }, [hosts.data]);

  const list = hosts.data ?? [];
  if (hosts.isSuccess && list.length === 0) {
    return (
      <>
        <EmptyState
          title="No hosts yet"
          body="Hosts are added from single IPs in the scope, from capture, or by hand."
          action={<Button onClick={() => setAdding(true)}>Add host</Button>}
        />
        <HostDialog open={adding} onOpenChange={setAdding} engagementId={id} />
      </>
    );
  }

  function moveHost(host: Host, column: BoardColumn) {
    move.mutate(
      { id: host.id, column },
      {
        onSuccess: () => setMoveError(null),
        onError: (e) => {
          // The card stays put, so a later refetch must not pull focus back to it.
          if (refocus.current === host.id) refocus.current = null;
          setMoveError(`Couldn't move ${host.name}: ${e.message}`);
        },
      },
    );
  }

  function shift(host: Host, delta: -1 | 1) {
    const next = ORDER[ORDER.indexOf(host.boardColumn) + delta];
    if (!next) return;
    refocus.current = host.id;
    moveHost(host, next);
  }

  function onDrop(e: DragEvent, column: BoardColumn) {
    e.preventDefault();
    setOver(null);
    const hostId = e.dataTransfer.getData("text/plain");
    const host = list.find((h) => h.id === hostId);
    if (host && host.boardColumn !== column) moveHost(host, column);
  }

  return (
    <div
      className="grid h-full gap-2"
      style={{ gridTemplateRows: moveError ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)" }}
    >
      {moveError && (
        <p role="alert" className="m-0 text-meta text-warn">
          {moveError}
        </p>
      )}
      {/* Lanes share two rows (DESIGN.md Layout rule 5): every header sits in row 1, so a title that wraps makes
          the whole header row taller and every lane's first card still starts on the same line. */}
      <div
        ref={root}
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${ORDER.length}, minmax(0, 1fr))`,
          gridTemplateRows: "auto 1fr",
        }}
      >
        {ORDER.map((col) => {
          const cards = list.filter((h) => h.boardColumn === col);
          return (
            <section
              key={col}
              aria-label={COLUMN_LABELS[col]}
              data-over={over === col ? "true" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(col);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOver(null);
              }}
              onDrop={(e) => onDrop(e, col)}
              style={{ gridRow: "span 2", gridTemplateRows: "subgrid" }}
              className={cx(
                "grid min-h-40 min-w-0 gap-2 rounded border p-2",
                over === col ? "border-accent" : "border-line",
              )}
            >
              {/* Narrow lanes (under 144px inside, i.e. below about 1200px wide) put the count under the title, so
                  "Vulnerability" never collides with it; wider lanes keep it beside. The shared row absorbs both. */}
              <header className="@container">
                <div className="grid items-start gap-x-2 @min-[144px]:grid-cols-[minmax(0,1fr)_auto]">
                  <span className={cx(labelClass, "break-words")}>{COLUMN_LABELS[col]}</span>
                  <span className="text-meta tabular-nums text-muted">{cards.length}</span>
                </div>
              </header>
              <div data-lane-body className="grid min-w-0 content-start gap-2">
                {cards.map((h) => (
                  <BoardCard key={h.id} host={h} onShift={shift} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
