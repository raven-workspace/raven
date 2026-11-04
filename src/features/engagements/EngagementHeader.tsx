import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import type { Engagement, EngagementStatus } from "../../types/engagement";
import { dropPendingNotes } from "../notes/useNotesStore";
import { Button, Chip, Dialog, Field, Input } from "../../ui";
import { EngagementDialog } from "./EngagementDialog";
import { KIND_LABEL, scopeSummary } from "./format";

export function EngagementHeader({ engagement: e }: { engagement: Engagement }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = scopeSummary(e.scopeCidrs);
  const archived = e.status === "archived";

  const setStatus = useMutation({
    mutationFn: (status: EngagementStatus) => api.engagementSetStatus(e.id, status),
    onSuccess: (saved) => {
      setError(null);
      qc.setQueryData(["engagement", saved.id], saved);
      void qc.invalidateQueries({ queryKey: ["engagements"] });
    },
    onError: (err) => setError(err.message),
  });

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-line px-6 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="m-0 truncate text-xl font-semibold tracking-[-0.01em] text-fg">{e.name}</h1>
        <Chip>{KIND_LABEL[e.kind]}</Chip>
        {e.subLabel && <Chip>{e.subLabel}</Chip>}
        {archived && <Chip>archived</Chip>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(archived ? "active" : "archived")}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>
      {(e.client || scope || e.domain) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          {e.client && <span className="text-muted-2">{e.client}</span>}
          {scope && (
            <ul aria-label="Scope" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {e.scopeCidrs.map((c) => (
                <li key={c}>
                  <Chip mono className="border-line text-muted-2">
                    {c}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          {e.domain && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10.5px] tracking-[0.12em] text-faint uppercase">Domain</span>
              <span className="font-mono text-[11.5px] text-fg-2">{e.domain}</span>
            </span>
          )}
        </div>
      )}
      {error && <p className="m-0 text-xs text-warn">{error}</p>}
      <EngagementDialog open={editing} onOpenChange={setEditing} engagement={e} />
      {deleting && (
        <DeleteDialog
          engagement={e}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            qc.removeQueries({ queryKey: ["engagement", e.id] });
            void qc.invalidateQueries({ queryKey: ["engagements"] });
            void navigate("/");
          }}
        />
      )}
    </header>
  );
}


function DeleteDialog({
  engagement: e,
  onClose,
  onDeleted,
}: {
  engagement: Engagement;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const del = useMutation({
    mutationFn: () => api.engagementDelete(e.id),
    onSuccess: () => {
      // Its notes are gone: unsaved text for them can never be saved.
      dropPendingNotes(e.id);
      onDeleted();
    },
  });
  const match = typed === e.name;
  const confirm = () => match && !del.isPending && del.mutate();

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Delete engagement"
      description="This removes it and everything in it. It can't be undone; backups still hold older copies."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!match || del.isPending} onClick={confirm}>
            Delete engagement
          </Button>
        </>
      }
    >
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          confirm();
        }}
      >
        <Field
          label={
            <>
              Type the engagement name to confirm:{" "}
              <span className="normal-case tracking-normal text-fg-2">{e.name}</span>
            </>
          }
          error={del.isError ? del.error.message : undefined}
        >
          <Input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(ev) => setTyped(ev.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
