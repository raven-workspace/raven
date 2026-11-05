import { useCallback, useEffect, useRef, useState } from "react";
import { calculateCvssScore, scoreToSeverity } from "../../engines/findings";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import type { Finding, FindingInput, FindingStatus, Severity } from "../../types/findings";
import { Button, Chip, Dialog, Field, Input, Select, Textarea, Toggle } from "../../ui";
import { hostLabel } from "../credentials/AccessGrants";
import { FindingFiles } from "./FindingFiles";
import { FindingSteps, liveSteps } from "./FindingSteps";
import { useFindingMutations } from "./queries";
import { useLog } from "../log/queries";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_OPTIONS = [{ value: "none", label: "Unrated" }, ...SEVERITIES.map((s) => ({ value: s, label: s }))];
const STATUSES: FindingStatus[] = ["draft", "confirmed", "reported"];

interface Draft {
  title: string;
  severity: Severity | null;
  status: FindingStatus;
  cvssVector: string;
  hostIds: string[];
  serviceIds: string[];
  refs: string[];
  description: string;
  impact: string;
  remediation: string;
  exploitNotes: string;
  lessons: string;
  stepEntryIds: string[];
}

const toDraft = (f?: Finding): Draft => ({
  title: f?.title ?? "",
  severity: f?.severity ?? null,
  status: f?.status ?? "draft",
  cvssVector: f?.cvssVector ?? "",
  hostIds: f?.hostIds ?? [],
  serviceIds: f?.serviceIds ?? [],
  refs: f?.refs ?? [],
  description: f?.description ?? "",
  impact: f?.impact ?? "",
  remediation: f?.remediation ?? "",
  exploitNotes: f?.exploitNotes ?? "",
  lessons: f?.lessons ?? "",
  stepEntryIds: f?.stepEntryIds ?? [],
});

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** Copies a reference URL (there is no opener plugin to open it in a browser). */
function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  };
  return <Button size="sm" aria-label={`Copy ${value}`} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>;
}

export function FindingEditor({ eid, hosts, servicesByHost, edit, onClose }: {
  eid: string;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  /** Edit this finding; add when absent. */
  edit?: Finding;
  onClose: () => void;
}) {
  const { create, update } = useFindingMutations(eid);
  const log = useLog(eid);
  const [initial] = useState(() => JSON.stringify(toDraft(edit)));
  const [d, setD] = useState<Draft>(() => toDraft(edit));
  const [newRef, setNewRef] = useState("");
  const [titleError, setTitleError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileDirty, setFileDirty] = useState(false);
  const flushFile = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = useCallback((fn: (() => Promise<boolean>) | null) => {
    flushFile.current = fn;
  }, []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const dirty = JSON.stringify(d) !== initial || newRef.trim() !== "" || fileDirty;
  const vector = d.cvssVector.trim();
  const score = vector === "" ? null : calculateCvssScore(vector);
  const suggested = score === null ? null : scoreToSeverity(score);

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  function save() {
    if (busy) return;
    if (d.title.trim() === "") {
      setTitleError("Give it a title");
      return;
    }
    setTitleError(undefined);
    setFormError(undefined);
    // A typed but not yet added reference is saved too, once.
    const pending = newRef.trim();
    const refs = pending && !d.refs.includes(pending) ? [...d.refs, pending] : d.refs;
    const input: FindingInput = {
      title: d.title.trim(),
      severity: d.severity,
      status: d.status,
      cvssVector: vector === "" ? null : vector,
      cvssScore: score,
      description: d.description,
      impact: d.impact,
      remediation: d.remediation,
      exploitNotes: d.exploitNotes,
      lessons: d.lessons,
      refs,
      hostIds: d.hostIds,
      serviceIds: d.serviceIds,
      // Drop steps whose log entry has since been deleted.
      stepEntryIds: liveSteps(d.stepEntryIds, log.data),
    };
    setBusy(true);
    const opts = {
      onSuccess: onClose,
      onError: (e: Error) => {
        const field = (e as { field?: string }).field;
        if (field === "title") setTitleError(e.message);
        else setFormError(e.message);
      },
      onSettled: () => setBusy(false),
    };
    void (async () => {
      // A pasted file not yet saved is saved first; if that fails, the finding is not saved either.
      if (flushFile.current && !(await flushFile.current())) {
        setBusy(false);
        return;
      }
      if (edit) update.mutate({ id: edit.id, input }, opts);
      else create.mutate(input, opts);
    })();
  }

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (confirmClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmClose]);

  function addRef() {
    const r = newRef.trim();
    if (r === "") return;
    if (!d.refs.includes(r)) set("refs", [...d.refs, r]);
    setNewRef("");
  }

  const hostsWithServices = hosts.filter((h) => (servicesByHost.get(h.id) ?? []).length > 0);

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && requestClose()}
        size="xl"
        title={edit ? "Edit finding" : "Add finding"}
        footer={
          <>
            <Button onClick={requestClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={save}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <Field label="Title" error={titleError}>
            <Input autoFocus value={d.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <Select
                options={SEVERITY_OPTIONS}
                value={d.severity ?? "none"}
                onValueChange={(v) => set("severity", v === "none" ? null : (v as Severity))}
              />
            </Field>
            <Field label="Status">
              <Select
                options={STATUSES.map((s) => ({ value: s, label: s }))}
                value={d.status}
                onValueChange={(v) => set("status", v as FindingStatus)}
              />
            </Field>
          </div>
          <Field
            label="CVSS vector"
            error={vector !== "" && score === null ? "Not a valid CVSS v3.1 base vector" : undefined}
            hint={
              score !== null && suggested ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="font-mono text-fg">{score.toFixed(1)}</span>
                  <span>Suggested: {suggested}</span>
                  {d.severity !== suggested && (
                    <Button size="sm" onClick={() => set("severity", suggested)}>Use suggested</Button>
                  )}
                </span>
              ) : undefined
            }
          >
            <Input mono value={d.cvssVector} onChange={(e) => set("cvssVector", e.target.value)} placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" />
          </Field>

          <div role="group" aria-label="Affected hosts" className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-label text-muted">Affected hosts</span>
            <div className="flex flex-wrap gap-1.5">
              {hosts.map((h) => (
                <Toggle key={h.id} on={d.hostIds.includes(h.id)} onChange={() => set("hostIds", toggle(d.hostIds, h.id))}>
                  {hostLabel(h)}
                </Toggle>
              ))}
              {hosts.length === 0 && <span className="text-xs text-muted">No hosts yet</span>}
            </div>
          </div>

          <div role="group" aria-label="Affected services" className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-label text-muted">Affected services</span>
            {hostsWithServices.length === 0 && <span className="text-xs text-muted">No services yet</span>}
            {hostsWithServices.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 truncate text-xs text-muted">{hostLabel(h)}</span>
                {(servicesByHost.get(h.id) ?? []).map((s) => (
                  <Toggle key={s.id} on={d.serviceIds.includes(s.id)} onChange={() => set("serviceIds", toggle(d.serviceIds, s.id))}>
                    {`${s.port}/${s.protocol}${s.nmapService ? ` ${s.nmapService}` : ""}`}
                  </Toggle>
                ))}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-label text-muted">References</span>
            {d.refs.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {d.refs.map((r) => (
                  <li key={r} className="flex items-center justify-between gap-2 text-[13px]">
                    {/* No opener plugin: a link would be a dead click in the desktop app, so a URL is copied instead. */}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{r}</span>
                    <span className="flex shrink-0 gap-1.5">
                      {isUrl(r) && <CopyRef value={r} />}
                      <Button size="sm" aria-label={`Remove ${r}`} onClick={() => set("refs", d.refs.filter((x) => x !== r))}>Remove</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                mono
                aria-label="Add reference"
                value={newRef}
                placeholder="CVE-2017-0144, EDB-42315 or a URL"
                onChange={(e) => setNewRef(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    addRef();
                  }
                }}
              />
              <Button onClick={addRef}>Add</Button>
            </div>
          </div>

          <Field label="Description"><Textarea rows={4} value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Impact"><Textarea rows={3} value={d.impact} onChange={(e) => set("impact", e.target.value)} /></Field>
          <Field label="Remediation"><Textarea rows={3} value={d.remediation} onChange={(e) => set("remediation", e.target.value)} /></Field>
          <Field label="Exploit notes"><Textarea mono rows={4} value={d.exploitNotes} onChange={(e) => set("exploitNotes", e.target.value)} /></Field>

          <FindingSteps eid={eid} hostIds={d.hostIds} value={d.stepEntryIds} onChange={(ids) => set("stepEntryIds", ids)} />
          {edit ? (
            <FindingFiles findingId={edit.id} onDirty={setFileDirty} register={registerFlush} />
          ) : (
            <p className="m-0 text-xs text-muted">Save the finding to attach files.</p>
          )}

          <Field label={<span className="inline-flex items-center gap-2">Lessons <Chip>Private</Chip></span>} hint="Never included in an export or report.">
            <Textarea rows={3} value={d.lessons} onChange={(e) => set("lessons", e.target.value)} />
          </Field>

          {formError && <p role="alert" className="m-0 text-xs text-warn">{formError}</p>}
        </div>
      </Dialog>
      {confirmClose && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirmClose(false)}
          title="Discard unsaved changes?"
          footer={
            <>
              <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
              <Button variant="danger" onClick={onClose}>Discard</Button>
            </>
          }
        />
      )}
    </>
  );
}
