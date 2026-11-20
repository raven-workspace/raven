import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { RuledOut } from "../../../types/notes";
import { cx } from "../../../lib/cx";
import { IconButton, labelClass } from "../../../ui/index";
import { SCROLL_PANE } from "../../../ui/controlStyles";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useRuledOutDelete } from "../queries";
import "./RuledOutList.scss";

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
    <section aria-label="Ruled out" className={cx("ruled-out-list", SCROLL_PANE)}>
      <h3 className={labelClass}>
        Ruled out <span className="ruled-out-list__count">{items.length}</span>
      </h3>
      <ul className="ruled-out-list__items">
        {items.map((r) => (
          <li key={r.id} className="ruled-out-list__item">
            <span className="ruled-out-list__body">
              <span className="ruled-out-list__head">
                <span className="ruled-out-list__text" title={r.text}>{r.text}</span>
                {r.private && <span className="ruled-out-list__meta">Private</span>}
              </span>
              {r.reason && <span className="ruled-out-list__meta ruled-out-list__meta--truncate" title={r.reason}>{r.reason}</span>}
            </span>
            {r.sourceKind ? (
              <span className="ruled-out-list__meta">{FROM_VERDICT[r.sourceKind]}</span>
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
