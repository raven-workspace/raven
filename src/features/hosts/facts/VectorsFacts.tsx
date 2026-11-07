import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { cx } from "../../../lib/cx";
import type { PrivescVector, VectorStatus } from "../../../types/hostFacts";
import type { Host } from "../../../types/host";
import { Button, Input } from "../../../ui";
import { ConfirmDelete } from "../../checklist/ConfirmDelete";
import { useHostFactsMutations, useVectors } from "../queries";
import { FactGroup } from "./FactGroup";

const STATUS_LABEL: Record<VectorStatus, string> = { try: "try", untested: "untested", ruled_out: "ruled out" };
const STATUS_TONE: Record<VectorStatus, string> = {
  try: "border-accent text-accent",
  untested: "border-line-strong text-fg-2",
  ruled_out: "border-line text-muted line-through",
};
const ORDER: Record<VectorStatus, number> = { try: 0, untested: 1, ruled_out: 2 };

/** One line of text, Enter saves and Esc cancels: adding a vector, or the reason it's ruled out. */
function LineInput({ label, placeholder, pending, onSave, onCancel }: {
  label: string;
  placeholder: string;
  pending: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="col-span-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending && text.trim() !== "") onSave(text.trim());
      }}
    >
      <Input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          onCancel();
        }}
        className="h-7 text-xs"
      />
    </form>
  );
}

function VectorRow({ v, engagementId, hostId }: { v: PrivescVector; engagementId: string; hostId: string }) {
  const { setVectorStatus, removeVector } = useHostFactsMutations(engagementId, hostId);
  const [ruling, setRuling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ruledOut = v.status === "ruled_out";
  return (
    <li className="col-span-3 grid grid-cols-subgrid items-center gap-y-1 border-b border-line py-1">
      <span className={cx("min-w-0 truncate text-[13px]", ruledOut ? "text-muted" : "text-fg")} title={v.title}>{v.title}</span>
      {ruledOut ? (
        <button
          type="button"
          title="Reopen as untested"
          aria-label={`Reopen ${v.title}`}
          onClick={() => setVectorStatus.mutate({ id: v.id, status: "untested" })}
          className={cx("cursor-default rounded-sm border px-1.5 text-[11px] leading-4", STATUS_TONE[v.status])}
        >
          {STATUS_LABEL[v.status]}
        </button>
      ) : (
        <button
          type="button"
          title={v.status === "try" ? "Mark untested" : "Mark worth trying"}
          aria-label={`${v.title}: ${STATUS_LABEL[v.status]}`}
          onClick={() => setVectorStatus.mutate({ id: v.id, status: v.status === "try" ? "untested" : "try" })}
          className={cx("cursor-default rounded-sm border px-1.5 text-[11px] leading-4", STATUS_TONE[v.status])}
        >
          {STATUS_LABEL[v.status]}
        </button>
      )}
      <span className="flex items-center gap-1">
        {!ruledOut && (
          <Button size="sm" onClick={() => setRuling(true)} aria-label={`Rule out ${v.title}`}>Rule out</Button>
        )}
        <Button size="sm" variant="danger" className="w-6 px-0!" aria-label={`Delete ${v.title}`} title="Delete vector" onClick={() => setDeleting(true)}>
          <Trash size={12} weight="light" aria-hidden />
        </Button>
      </span>
      {ruling && (
        <LineInput
          label={`Why is ${v.title} ruled out?`}
          placeholder="Why is it ruled out? Enter saves, Esc cancels"
          pending={setVectorStatus.isPending}
          onCancel={() => setRuling(false)}
          onSave={(reason) => setVectorStatus.mutate({ id: v.id, status: "ruled_out", reason }, { onSuccess: () => setRuling(false) })}
        />
      )}
      {setVectorStatus.error && <p role="alert" className="col-span-3 m-0 text-xs text-warn">{setVectorStatus.error.message}</p>}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${v.title}?`}
          detail={ruledOut ? "Its ruled-out item stays in the report." : undefined}
          pending={removeVector.isPending}
          error={removeVector.error?.message}
          label="Delete vector"
          onCancel={() => setDeleting(false)}
          onConfirm={() => removeVector.mutate(v.id, { onSuccess: () => setDeleting(false) })}
        />
      )}
    </li>
  );
}

/** Privesc vectors on this host, worth trying first; ruled out ones stay listed, struck through. */
export function VectorsFacts({ engagementId, host, open, onToggle }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
}) {
  const vectorsQ = useVectors(host.id);
  const { upsertVector } = useHostFactsMutations(engagementId, host.id);
  const [adding, setAdding] = useState(false);
  const vectors = [...(vectorsQ.data ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.createdAt - b.createdAt);
  const count = (s: VectorStatus) => vectors.filter((v) => v.status === s).length;
  const parts = [count("try") && `${count("try")} try`, count("untested") && `${count("untested")} untested`].filter(Boolean);
  const summary = vectorsQ.isError
    ? "Privesc vectors · couldn't load"
    : !vectorsQ.data
      ? "Privesc vectors"
      : `Privesc vectors · ${parts.length > 0 ? parts.join(" · ") : vectors.length > 0 ? "all ruled out" : "none yet"}`;

  return (
    <FactGroup
      title="Privesc vectors"
      summary={summary}
      open={open}
      onToggle={onToggle}
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={12} weight="light" aria-hidden /> Add vector
        </Button>
      }
    >
      {vectorsQ.isError ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load the vectors: {vectorsQ.error.message}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2 p-0">
          {vectors.map((v) => <VectorRow key={v.id} v={v} engagementId={engagementId} hostId={host.id} />)}
          {adding && (
            <li className="col-span-3 grid grid-cols-subgrid py-1">
              <LineInput
                label="New privesc vector"
                placeholder="Unquoted service path… Enter adds, Esc cancels"
                pending={upsertVector.isPending}
                onCancel={() => setAdding(false)}
                onSave={(title) => upsertVector.mutate({ title, status: "untested", source: "manual" }, { onSuccess: () => setAdding(false) })}
              />
            </li>
          )}
          {vectors.length === 0 && !adding && (
            <li className="col-span-3 text-xs text-muted">None yet. Notable privileges from whoami or id add them, or add one.</li>
          )}
        </ul>
      )}
      {upsertVector.error && <p role="alert" className="m-0 text-xs text-warn">Couldn't add the vector: {upsertVector.error.message}</p>}
    </FactGroup>
  );
}
