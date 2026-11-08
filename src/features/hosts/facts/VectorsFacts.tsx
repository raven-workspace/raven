import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cx } from "../../../lib/cx";
import type { PrivescVector, VectorStatus } from "../../../types/hostFacts";
import type { Host } from "../../../types/host";
import { ActionCell, Button, Chip, IconButton, Input, Tooltip, type ChipVariant } from "../../../ui";
import { ConfirmDelete } from "../../checklist/ConfirmDelete";
import { useHostFactsMutations, useVectors } from "../queries";
import { FactGroup, SummaryCell } from "./FactGroup";

const STATUS_LABEL: Record<VectorStatus, string> = { try: "try", untested: "untested", ruled_out: "ruled out" };
const STATUS_CHIP: Record<VectorStatus, ChipVariant> = { try: "accent", untested: "default", ruled_out: "default" };
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
      className="col-span-full"
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
        className="h-7"
      />
    </form>
  );
}

function VectorRow({ v, engagementId, hostId }: { v: PrivescVector; engagementId: string; hostId: string }) {
  const { setVectorStatus, removeVector } = useHostFactsMutations(engagementId, hostId);
  const [ruling, setRuling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ruledOut = v.status === "ruled_out";
  const status = (
    <Chip variant={STATUS_CHIP[v.status]} className={ruledOut ? "text-muted line-through" : undefined}>{STATUS_LABEL[v.status]}</Chip>
  );
  return (
    <li className="col-span-full grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-b border-line py-2 @min-[26rem]:col-span-3 @min-[26rem]:grid-cols-subgrid">
      <span className={cx("col-span-2 min-w-0 truncate text-meta @min-[26rem]:col-span-1", ruledOut ? "text-muted" : "text-fg")} title={v.title}>{v.title}</span>
      {/* A status chip as a toggle (DESIGN.md Chips): a 28px target, its action in a tooltip. */}
      {ruledOut ? (
        <Tooltip content="Reopen as untested">
          <button
            type="button"
            aria-label={`Reopen ${v.title}`}
            onClick={() => setVectorStatus.mutate({ id: v.id, status: "untested" })}
            className="grid min-h-7 cursor-default place-items-center justify-self-start"
          >
            {status}
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={v.status === "try" ? "Mark untested" : "Mark worth trying"}>
          <button
            type="button"
            aria-label={`${v.title}: ${STATUS_LABEL[v.status]}`}
            onClick={() => setVectorStatus.mutate({ id: v.id, status: v.status === "try" ? "untested" : "try" })}
            className="grid min-h-7 cursor-default place-items-center justify-self-start"
          >
            {status}
          </button>
        </Tooltip>
      )}
      <div className="justify-self-end"><ActionCell>
        {!ruledOut && (
          <Button size="sm" onClick={() => setRuling(true)} aria-label={`Rule out ${v.title}`}>Rule out</Button>
        )}
        <IconButton icon={TrashIcon} label={`Delete ${v.title}`} tone="destructive" onClick={() => setDeleting(true)} />
      </ActionCell></div>
      {ruling && (
        <LineInput
          label={`Why is ${v.title} ruled out?`}
          placeholder="Why is it ruled out? Enter saves, Esc cancels"
          pending={setVectorStatus.isPending}
          onCancel={() => setRuling(false)}
          onSave={(reason) => setVectorStatus.mutate({ id: v.id, status: "ruled_out", reason }, { onSuccess: () => setRuling(false) })}
        />
      )}
      {setVectorStatus.error && <p role="alert" className="col-span-full m-0 text-meta text-warn">{setVectorStatus.error.message}</p>}
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
  const summary = vectorsQ.isError ? (
    <span>couldn't load</span>
  ) : !vectorsQ.data ? undefined : count("try") + count("untested") > 0 ? (
    <>
      {count("try") > 0 && <SummaryCell label="try">{count("try")}</SummaryCell>}
      {count("untested") > 0 && <SummaryCell label="untested">{count("untested")}</SummaryCell>}
    </>
  ) : (
    <span>{vectors.length > 0 ? "all ruled out" : "none yet"}</span>
  );

  return (
    <FactGroup
      title="Privesc vectors"
      summary={summary}
      open={open}
      onToggle={onToggle}
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon size={16} weight="regular" aria-hidden /> Add vector
        </Button>
      }
    >
      {vectorsQ.isError ? (
        <p role="alert" className="m-0 text-meta text-warn">Couldn't load the vectors: {vectorsQ.error.message}</p>
      ) : (
        <ul className="@container m-0 grid list-none grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2 p-0">
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
            <li className="col-span-3 text-meta text-muted">None yet. Notable privileges from whoami or id add them, or add one.</li>
          )}
        </ul>
      )}
      {upsertVector.error && <p role="alert" className="m-0 text-meta text-warn">Couldn't add the vector: {upsertVector.error.message}</p>}
    </FactGroup>
  );
}
