import { useId, useState, type FormEvent } from "react";
import type { Host } from "../../types/host";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { Button, Dialog, Field, Input, Textarea } from "../../ui";
import { HostChips } from "../capture/HostChips";
import { useLogMutations } from "./queries";

const NO_IPS: string[] = [];

export interface EditEntryDialogProps {
  entry: LogEntry;
  hosts: Host[];
  onClose: () => void;
}

/** Mount while editing. Sends the full input from the entry plus edits; the content kind never changes. */
export function EditEntryDialog({ entry, hosts, onClose }: EditEntryDialogProps) {
  const formId = useId();
  const { update } = useLogMutations(entry.engagementId);
  const [title, setTitle] = useState(entry.title);
  const [hostIds, setHostIds] = useState(entry.hostIds);
  const [ranOn, setRanOn] = useState(entry.ranOn ?? "");
  const [observations, setObservations] = useState(entry.observations ?? "");
  const [isPrivate, setPrivate] = useState(entry.private);
  const [nothing, setNothing] = useState(entry.returnedNothing);
  const [text, setText] = useState(entry.content.kind === "note" ? entry.content.text : "");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    const t = title.trim();
    if (t === "") {
      setError("Give it a title");
      return;
    }
    const input: LogEntryInput = {
      title: t,
      titleEdited: entry.titleEdited || t !== entry.title,
      ranOn: ranOn.trim() === "" ? null : ranOn.trim(),
      hostIds,
      observations: observations.trim() === "" ? null : observations.trim(),
      returnedNothing: nothing,
      private: isPrivate,
      content: entry.content.kind === "note" ? { ...entry.content, text } : entry.content,
      at: entry.at,
    };
    update.mutate({ id: entry.id, input }, { onSuccess: onClose, onError: (err) => setError(err.message) });
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title="Edit entry"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field label="Title" error={error}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-label text-muted">Hosts</span>
          <HostChips hosts={hosts} linked={hostIds} addIps={NO_IPS} unknownIps={NO_IPS} onLinked={setHostIds} onAddIps={() => {}} />
        </div>
        <Field label="Ran on">
          <Input value={ranOn} onChange={(e) => setRanOn(e.target.value)} placeholder="Kali (VM)" />
        </Field>
        {entry.content.kind === "note" && (
          <Field label="Note">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </Field>
        )}
        <Field label="Observations">
          <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={3} />
        </Field>
        <div className="flex gap-4 text-[13px] text-fg-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
            Private
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={nothing} onChange={(e) => setNothing(e.target.checked)} />
            Returned nothing
          </label>
        </div>
      </form>
    </Dialog>
  );
}
