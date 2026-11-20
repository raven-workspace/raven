import { useCallback, useId, useState, type FormEvent } from "react";
import type { Host } from "../../types/host";
import type { LogEntry, LogEntryInput } from "../../types/log";
import { proofShotFlag, screenshotFileName } from "../../engines/capture";
import { Button, Dialog, Field, Input, Select, Textarea, Toggle, Toolbar } from "../../ui";
import { HostChips } from "../capture/HostChips";
import { useLog, useLogMutations } from "./queries";
import { useSettings } from "../settings/queries";
import "./EditEntryDialog.scss";

const NONE = "__none";
const NO_MACHINES: string[] = [];
const NO_LOG: LogEntry[] = [];
const EXT_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

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
  const shot = entry.content.kind === "screenshot" ? entry.content : null;
  const log = useLog(entry.engagementId).data ?? NO_LOG;
  const [caption, setCaption] = useState(shot?.caption ?? "");
  const [fileName, setFileName] = useState(shot?.fileName ?? "");
  // Once the name is typed by hand it is no longer re-derived from the caption.
  const [fileNameEdited, setFileNameEdited] = useState(false);
  // The name Raven would give this shot for a caption: same rules as capture (flag name, dedupe), so a pre-fix
  // "privesc_shot" proof can be corrected by naming the flag in the caption, without retyping the file name.
  const suggestName = useCallback(
    (cap: string): string => {
      if (!shot) return "";
      const host = hosts.find((h) => h.id === hostIds[0]) ?? null;
      const ext = shot.fileName.split(".").pop()?.toLowerCase() ?? "png";
      const taken = new Set(log.flatMap((e) => (e.id !== entry.id && e.content.kind === "screenshot" ? [e.content.fileName] : [])));
      return screenshotFileName({
        ip: host?.ip ?? null,
        hostName: host?.name ?? null,
        column: host?.boardColumn ?? null,
        caption: cap,
        mime: EXT_MIME[ext] ?? "image/png",
        flag: proofShotFlag(log, host?.id ?? null, entry.at),
        taken,
      });
    },
    [shot, hosts, hostIds, log, entry.id, entry.at],
  );
  const onCaption = (v: string) => {
    setCaption(v);
    if (!fileNameEdited) setFileName(suggestName(v));
  };
  const [error, setError] = useState<string>();
  const [titleError, setTitleError] = useState<string>();
  const machines = useSettings().data?.machines ?? NO_MACHINES;
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
      content: shot
        ? { ...shot, caption: caption.trim(), fileName: fileName.trim() || shot.fileName }
        : entry.content.kind === "note"
          ? { ...entry.content, text }
          : entry.content,
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
      <form id={formId} onSubmit={submit} noValidate className="edit-entry">
        <Field label="Title" error={titleError}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="edit-entry__hosts">
          <span className="edit-entry__label">Hosts</span>
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
        {shot && (
          <>
            <Field label="Caption">
              <Input value={caption} onChange={(e) => onCaption(e.target.value)} />
            </Field>
            <Field label="File name">
              <Input
                mono
                value={fileName}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setFileNameEdited(true);
                }}
              />
            </Field>
          </>
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
        {error && <p role="alert" className="edit-entry__error">{error}</p>}
      </form>
    </Dialog>
  );
}
