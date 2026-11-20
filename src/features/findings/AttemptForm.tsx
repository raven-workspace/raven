import { useState } from "react";
import type { FailedAttempt, FailedAttemptInput, Finding, ReasonKind } from "../../types/findings";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, ChipSet, Dialog, Field, Input, Select, Toggle, fieldLabelClass } from "../../ui";
import { hostLabel } from "../credentials/AccessGrants";
import { useFailedAttemptMutations } from "./queries";
import { RavenError } from "../../types/errors";

export const REASON_LABELS: Record<ReasonKind, string> = {
  control: "Blocked by a control",
  precondition: "Missing precondition",
  access: "Insufficient access",
  operator: "Operator error or inexperience (private)",
};
const REASONS = Object.keys(REASON_LABELS) as ReasonKind[];
const NONE = "none";

const withNone = (label: string, rest: { value: string; label: string }[]) => [{ value: NONE, label }, ...rest];

/** Add or edit one failed attempt. `private` is never sent: the server derives it from the reason kind. */
export function AttemptForm({ eid, hosts, findings, log, edit, defaultHostId, onClose }: {
  eid: string;
  hosts: Host[];
  findings: Finding[];
  log: LogEntry[];
  edit?: FailedAttempt;
  defaultHostId?: string;
  onClose: () => void;
}) {
  const { create, update } = useFailedAttemptMutations(eid);
  const [title, setTitle] = useState(edit?.title ?? "");
  const [hostId, setHostId] = useState<string | null>(edit ? edit.hostId : (defaultHostId ?? null));
  const [findingId, setFindingId] = useState<string | null>(edit?.findingId ?? null);
  const [logEntryId, setLogEntryId] = useState<string | null>(edit?.logEntryId ?? null);
  const [kind, setKind] = useState<ReasonKind | null>(edit?.reasonKind ?? null);
  const [reason, setReason] = useState(edit?.reason ?? "");
  const [errors, setErrors] = useState<{ title?: string; reason?: string; kind?: string; form?: string }>({});
  const pending = create.isPending || update.isPending;

  const pick = (v: string) => (v === NONE ? null : v);
  const logOptions = [...log].sort((a, b) => b.at - a.at).map((e) => ({ value: e.id, label: e.title }));

  function save() {
    if (pending) return;
    const next = {
      title: title.trim() === "" ? "Say what was tried" : undefined,
      reason: reason.trim() === "" ? "Say why it failed" : undefined,
      kind: kind === null ? "Pick why it failed" : undefined,
    };
    setErrors(next);
    if (next.title || next.reason || next.kind || kind === null) return;
    const input: FailedAttemptInput = { title: title.trim(), reason: reason.trim(), reasonKind: kind, hostId, findingId, logEntryId };
    const opts = {
      onSuccess: onClose,
      onError: (e: Error) => {
        const field = RavenError.from(e).field;
        if (field === "title" || field === "reason") setErrors({ [field]: e.message });
        else if (field === "reasonKind") setErrors({ kind: e.message });
        else setErrors({ form: e.message });
      },
    };
    if (edit) update.mutate({ id: edit.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={edit ? "Edit attempt" : "Add attempt"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="What was tried" error={errors.title}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host">
            <Select
              options={withNone("No host", hosts.map((h) => ({ value: h.id, label: hostLabel(h) })))}
              value={hostId ?? NONE}
              onValueChange={(v) => setHostId(pick(v))}
            />
          </Field>
          <Field label="Finding">
            <Select
              options={withNone("No finding", findings.map((f) => ({ value: f.id, label: f.title })))}
              value={findingId ?? NONE}
              onValueChange={(v) => setFindingId(pick(v))}
            />
          </Field>
        </div>
        <Field label="Log entry">
          <Select options={withNone("No log entry", logOptions)} value={logEntryId ?? NONE} onValueChange={(v) => setLogEntryId(pick(v))} />
        </Field>
        <div role="radiogroup" aria-label="Why it failed" className="grid gap-2">
          <span className={fieldLabelClass}>Why it failed</span>
          <ChipSet>
            {REASONS.map((r) => (
              <Toggle key={r} role="radio" aria-checked={kind === r} aria-pressed={undefined} on={kind === r} onChange={() => setKind(r)}>
                {REASON_LABELS[r]}
              </Toggle>
            ))}
          </ChipSet>
          {errors.kind && <p className="m-0 text-meta text-warn">{errors.kind}</p>}
          {kind === "operator" && <p className="m-0 text-meta text-muted">Never appears in a report</p>}
        </div>
        <Field label="Reason" error={errors.reason}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {errors.form && <p role="alert" className="m-0 text-meta text-warn">{errors.form}</p>}
      </div>
    </Dialog>
  );
}
