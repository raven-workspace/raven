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
  "enumerate",
  "foothold",
  "privesc",
  "loot",
  "done",
];

export function Board() {
  const { id = "" } = useParams();
  const hosts = useHosts(id);
  const { move } = useHostMutations(id);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [adding, setAdding] = useState(false);
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

  function shift(host: Host, delta: -1 | 1) {
    const next = ORDER[ORDER.indexOf(host.boardColumn) + delta];
    if (!next) return;
    refocus.current = host.id;
    move.mutate({ id: host.id, column: next });
  }

  function onDrop(e: DragEvent, column: BoardColumn) {
    e.preventDefault();
    setOver(null);
    const hostId = e.dataTransfer.getData("text/plain");
    const host = list.find((h) => h.id === hostId);
    if (host && host.boardColumn !== column)
      move.mutate({ id: host.id, column });
  }

  return (
    <div ref={root} className="grid h-full grid-cols-5 gap-3">
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
            className={cx(
              "flex min-h-40 flex-col gap-2 rounded border p-2",
              over === col ? "border-accent" : "border-line",
            )}
          >
            <header
              className={cx(
                labelClass,
                "flex items-center justify-between px-1",
              )}
            >
              <span>{COLUMN_LABELS[col]}</span>
              <span className="font-mono">{cards.length}</span>
            </header>
            {cards.map((h) => (
              <BoardCard key={h.id} host={h} onShift={shift} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
