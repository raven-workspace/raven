import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { RuledOut } from "../../types/notes";
import { cx } from "../../lib/cx";
import { IconButton, labelClass } from "../../ui";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useRuledOutDelete } from "./queries";

const FROM_VERDICT: Record<NonNullable<RuledOut["sourceKind"]>, string> = {
  service: "From a service's dead-end verdict",
  vector: "From a ruled-out vector",
};

/**
 * What this note's scope ruled out, private items included. A hand-written item (a thread closed as a dead end) can be
 * deleted here; one a verdict made goes when that verdict is undone, so it only says where it came from.
 */
export function RuledOutList({ engagementId, items }: { engagementId: string; items: RuledOut[] }) {
  const remove = useRuledOutDelete(engagementId);
  const [deleting, setDeleting] = useState<RuledOut>();
  if (items.length === 0) return null;
  return (
    <section aria-label="Ruled out" className={cx("grid max-h-40 content-start gap-1", SCROLL_PANE)}>
      <h3 className={cx(labelClass, "m-0")}>
        Ruled out <span className="tabular-nums">{items.length}</span>
      </h3>
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((r) => (
          <li key={r.id} className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <span className="grid min-w-0">
              <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                <span className="truncate text-body text-fg-2" title={r.text}>{r.text}</span>
                {r.private && <span className="text-meta text-muted">Private</span>}
              </span>
              {r.reason && <span className="truncate text-meta text-muted" title={r.reason}>{r.reason}</span>}
            </span>
            {r.sourceKind ? (
              <span className="text-meta text-muted">{FROM_VERDICT[r.sourceKind]}</span>
            ) : (
              <IconButton icon={Trash} tone="destructive" label={`Delete ruled-out item: ${r.text}`} onClick={() => setDeleting(r)} />
            )}
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDelete
          title={`Delete "${deleting.text}" from ruled out?`}
          detail="It leaves the report's ruled-out list. The ✗ line in your notes stays."
          label="Delete"
          pending={remove.isPending}
          error={remove.error?.message}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
    </section>
  );
}
