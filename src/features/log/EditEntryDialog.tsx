import { useId, useState, type FormEvent } from "react";
import type { Host } from "../../types/host";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, Dialog, Field, Input, Select, Textarea, Toggle, Toolbar } from "../../ui";
import { HostChips } from "../capture/HostChips";
import { useLogMutations } from "./queries";

const NONE = "__none";
const NO_MACHINES: string[] = [];

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
  // Only a command can come back empty.
  const isCommand = entry.content.kind === "command";
  const [text, setText] = useState(entry.content.kind === "note" ? entry.content.text : "");
  const [error, setError] = useState<string>();
  const [titleError, setTitleError] = useState<string>();
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const ranOnOptions = Array.from(new Set([...machines, ...hosts.map((h) => h.name), ...(entry.ranOn ? [entry.ranOn] : []), ...(ranOn ? [ranOn] : [])]));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (update.isPending) return;
    const t = title.trim();
    if (t === "") {
      setTitleError("Give it a title");
      return;
    }
    setTitleError(undefined);
    setError(undefined);
    const input: LogEntryInput = {
      title: t,
      titleEdited: entry.titleEdited || t !== entry.title,
      ranOn: ranOn === "" ? null : ranOn,
      hostIds,
      observations: observations.trim() === "" ? null : observations.trim(),
      returnedNothing: isCommand && nothing,
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
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4">
        <Field label="Title" error={titleError}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-2">
          <span className="text-meta text-muted-2">Hosts</span>
          <HostChips hosts={hosts} linked={hostIds} onLinked={setHostIds} />
        </div>
        <Field label="Ran on">
          <Select
            value={ranOn === "" ? NONE : ranOn}
            onValueChange={(v) => setRanOn(v === NONE ? "" : v)}
            options={[{ value: NONE, label: "Not set" }, ...ranOnOptions.map((v) => ({ value: v, label: v }))]}
          />
        </Field>
        {entry.content.kind === "note" && (
          <Field label="Text">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </Field>
        )}
        <Field label="Observations">
          <Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={3} />
        </Field>
        <Toolbar>
          <Toggle on={isPrivate} onChange={setPrivate}>
            Private
          </Toggle>
          {isCommand && (
            <Toggle on={nothing} onChange={setNothing}>
              Returned nothing
            </Toggle>
          )}
        </Toolbar>
        {error && <p role="alert" className="m-0 text-meta text-warn">{error}</p>}
      </form>
    </Dialog>
  );
}
