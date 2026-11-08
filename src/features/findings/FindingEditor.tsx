import { CaretDownIcon, CaretRightIcon, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isCveId, nvdFill, scoreCvss, scoreToSeverity, type NvdFillResult } from "../../engines/findings";
import { api } from "../../lib/api";
import { copyPlain } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import type { Finding, FindingInput, FindingStatus, NvdRecord, Severity } from "../../types/findings";
import { Button, Chip, Dialog, Field, Input, Select, Textarea, Toggle, labelClass } from "../../ui";
import { hostLabel } from "../credentials/AccessGrants";
import { useLog } from "../log/queries";
import { CvssBuilder } from "./CvssBuilder";
import { FindingFiles, type FileFormDraft } from "./FindingFiles";
import { FindingSteps, liveSteps } from "./FindingSteps";
import { useFindingMutations } from "./queries";
import { RefSuggestions } from "./RefSuggestions";
import { ServicePicker } from "./ServicePicker";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEVERITY_OPTIONS = [{ value: "none", label: "Unrated" }, ...SEVERITIES.map((s) => ({ value: s, label: s }))];
const STATUSES: FindingStatus[] = ["draft", "confirmed", "reported"];
/** A CVE added to the references is looked up once typing settles. */
const NVD_DEBOUNCE_MS = 400;

export interface Draft {
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
  /** Typed into "Add reference" but not added yet. */
  newRef: string;
  /** The file form while open (a file is saved on its own, not with the finding): kept so no close path loses it. */
  fileForm: FileFormDraft | null;
  /** The finding's `updatedAt` when this draft was opened; null for a new finding. */
  baseUpdatedAt: number | null;
}

/**
 * True when the draft holds something the user typed. An open file form counts only while it holds unsaved
 * input (`fileDirty`, reported by the form itself).
 */
export function draftChanged(d: Draft, base: Draft, fileDirty: boolean): boolean {
  return fileDirty || JSON.stringify({ ...d, fileForm: null }) !== JSON.stringify({ ...base, fileForm: null });
}

/** The draft for `f`, or a new one on `hostId` (the host page it was opened from). */
export const toDraft = (f?: Finding, hostId?: string | null): Draft => ({
  title: f?.title ?? "",
  severity: f?.severity ?? null,
  status: f?.status ?? "draft",
  cvssVector: f?.cvssVector ?? "",
  hostIds: f?.hostIds ?? (hostId ? [hostId] : []),
  serviceIds: f?.serviceIds ?? [],
  refs: f?.refs ?? [],
  description: f?.description ?? "",
  impact: f?.impact ?? "",
  remediation: f?.remediation ?? "",
  exploitNotes: f?.exploitNotes ?? "",
  lessons: f?.lessons ?? "",
  stepEntryIds: f?.stepEntryIds ?? [],
  newRef: "",
  fileForm: null,
  baseUpdatedAt: f?.updatedAt ?? null,
});

const isUrl = (s: string) => /^https?:\/\//i.test(s);

const FIELD_NAME: Record<NvdFillResult["diffs"][number]["field"], string> = {
  cvssVector: "CVSS vector",
  description: "description",
};

/** One quiet line for a failed lookup. Saving is never blocked by it. */
function lookupLine(cve: string, e: unknown): string {
  const err = RavenError.from(e);
  switch (err.code) {
    case "no_key":
      return "Add an NVD API key in Settings to look up CVEs · use the builder";
    case "offline":
      return "No connection · use the builder";
    case "key_rejected":
      return err.message || "NVD rejected the key";
    case "not_found":
      return "CVE not found on NVD";
    default:
      return `Couldn't look up ${cve}: ${err.message}`;
  }
}

/** Copies a reference URL (there is no opener plugin to open it in a browser). */
function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void copyPlain(value).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  };
  return <Button size="sm" aria-label={`Copy ${value}`} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>;
}

/**
 * NVD lookups for CVEs added in this editing session: debounced, merged through `nvdFill` (empty fields fill,
 * typed ones get a diff), failures reduced to one line. A stale answer after the editor closes is dropped.
 */
function useNvdLookup(draft: Draft, update: (fn: (d: Draft) => Draft) => void) {
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });
  const records = useRef(new Map<string, NvdRecord>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const live = useRef(true);
  // Each result remembers the CVEs it came from, so removing one of them from the refs removes it from view.
  const [diffs, setDiffs] = useState<{ cves: string[]; items: NvdFillResult["diffs"] }>({ cves: [], items: [] });
  const [line, setLine] = useState<{ cve: string; text: string }>();
  const [looking, setLooking] = useState<string>();
  useEffect(() => {
    live.current = true;
    const t = timers.current;
    return () => {
      live.current = false;
      for (const id of t.values()) clearTimeout(id);
    };
  }, []);

  const run = (cve: string) => {
    setLooking(cve);
    api.nvdLookup(cve).then(
      (rec) => {
        if (!live.current) return;
        records.current.set(cve, rec);
        const d = latest.current;
        // Only CVEs still in the references count (one removed meanwhile no longer competes for the vector).
        const keptIds = [...records.current.keys()].filter((id) => d.refs.includes(id));
        const kept = keptIds.flatMap((id) => records.current.get(id) ?? []);
        const { apply, diffs: next } = nvdFill({ cvssVector: d.cvssVector, description: d.description, refs: d.refs }, kept);
        update((p) => ({ ...p, ...apply, refs: apply.refs ? [...p.refs, ...apply.refs.filter((r) => !p.refs.includes(r))] : p.refs }));
        setDiffs({ cves: keptIds, items: next });
        setLine(undefined);
        setLooking((c) => (c === cve ? undefined : c));
      },
      (e: unknown) => {
        reportError(e);
        if (!live.current) return;
        setLine({ cve, text: lookupLine(cve, e) });
        setLooking((c) => (c === cve ? undefined : c));
      },
    );
  };

  const lookup = (cve: string) => {
    clearTimeout(timers.current.get(cve));
    timers.current.set(cve, setTimeout(() => run(cve), NVD_DEBOUNCE_MS));
  };
  const present = (cve: string) => draft.refs.includes(cve);
  // A diff whose field now holds NVD's text (taken, or typed the same) is settled; one from a removed CVE is gone.
  const open = diffs.cves.every(present) ? diffs.items.filter((df) => draft[df.field].trim() !== df.nvd.trim()) : [];
  return {
    lookup,
    diffs: open,
    line: line && present(line.cve) ? line.text : undefined,
    looking: looking && present(looking) ? looking : undefined,
  };
}

/**
 * The finding form, inline in the split. The draft is owned by the split (it outlives the form); this edits it.
 * ⌘↵ saves; the split's Esc closes and keeps the draft.
 */
export function FindingEditor({ eid, hosts, servicesByHost, servicesError, edit, hostName, draft: d, base, update, onSaved, onClose, onDiscard, onFileDirty, draftKey, onBusy, notice }: {
  eid: string;
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  servicesError?: string;
  /** The finding being edited; undefined for a new one. */
  edit?: Finding;
  /** The host page it was opened from, for the heading. */
  hostName?: string;
  draft: Draft;
  /** The draft as opened, to tell whether anything changed. */
  base: Draft;
  update: (fn: (d: Draft) => Draft) => void;
  onSaved: () => void;
  onClose: () => void;
  onDiscard: () => void;
  /** A file is pasted or typed but not saved yet (it is not part of the draft). */
  onFileDirty: (dirty: boolean) => void;
  /** The kept draft this form edits; a save drops it even if the form is gone by then. */
  draftKey?: string;
  /** A save is in flight (or has finished). */
  onBusy?: (busy: boolean) => void;
  /** One quiet line above the form, e.g. why a kept draft did not come back. */
  notice?: string;
}) {
  const { create, update: updateFinding } = useFindingMutations(eid, { draftKey });
  const log = useLog(eid);
  const newRef = d.newRef;
  const setNewRef = (v: string) => update((p) => ({ ...p, newRef: v }));
  const [titleError, setTitleError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [builder, setBuilder] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  const [fileDirty, setFileDirtyState] = useState(false);
  const setFileDirty = useCallback((dirty: boolean) => {
    setFileDirtyState(dirty);
    onFileDirty(dirty);
  }, [onFileDirty]);
  const flushFile = useRef<(() => Promise<boolean>) | null>(null);
  const registerFlush = useCallback((fn: (() => Promise<boolean>) | null) => {
    flushFile.current = fn;
  }, []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => update((p) => ({ ...p, [k]: v }));
  const nvd = useNvdLookup(d, update);

  const dirty = draftChanged(d, base, fileDirty);
  const vector = d.cvssVector.trim();
  const score = vector === "" ? null : scoreCvss(vector);
  const suggested = score === null ? null : scoreToSeverity(score);
  const affected = d.hostIds.flatMap((id) => hosts.find((h) => h.id === id) ?? []);
  const title = edit ? "Edit finding" : "New finding";

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
      onSuccess: onSaved,
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
      if (edit) updateFinding.mutate({ id: edit.id, input }, opts);
      else create.mutate(input, opts);
    })();
  }

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog (capture, a confirmation) is up: its own ⌘↵ is meant.
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.defaultPrevented || isDialogOpen()) return;
      e.preventDefault();
      saveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function addRef(raw: string) {
    const r = isCveId(raw) ? raw.trim().toUpperCase() : raw.trim();
    if (r === "") return;
    if (!d.refs.includes(r)) {
      set("refs", [...d.refs, r]);
      if (isCveId(r)) nvd.lookup(r);
    }
  }

  const toggleHost = (id: string) =>
    update((p) => {
      if (p.hostIds.includes(id)) {
        // The host's services go with it.
        const gone = new Set((servicesByHost.get(id) ?? []).map((s) => s.id));
        return { ...p, hostIds: p.hostIds.filter((x) => x !== id), serviceIds: p.serviceIds.filter((s) => !gone.has(s)) };
      }
      return { ...p, hostIds: [...p.hostIds, id] };
    });

  return (
    <form aria-label={title} onSubmit={(e) => e.preventDefault()} className="flex flex-col">
      <header className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line bg-bg pb-2">
        <h2 className={`m-0 truncate ${labelClass}`}>
          {title}
          {hostName && <span className="font-normal normal-case tracking-normal text-muted"> · {hostName}</span>}
        </h2>
        <span className="flex items-center gap-1.5">
          {dirty && (
            <Button size="sm" onClick={() => setConfirmDiscard(true)}>Discard changes</Button>
          )}
          <Button size="sm" variant="primary" disabled={busy} title="Save (⌘↵)" onClick={save}>Save</Button>
          <Button size="sm" aria-label="Close" title="Close, keeping the draft (Esc)" disabled={busy} onClick={onClose}>
            <X size={14} weight="light" aria-hidden />
          </Button>
        </span>
      </header>

      <div className="flex flex-col gap-3.5 pt-3">
        {notice && <p role="status" className="m-0 text-xs text-muted">{notice}</p>}
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

        <div role="group" aria-label="Affected hosts" className="flex flex-col gap-1.5">
          <span className={labelClass}>Affected hosts</span>
          <div className="flex flex-wrap gap-1.5">
            {hosts.map((h) => (
              <Toggle key={h.id} on={d.hostIds.includes(h.id)} title={hostLabel(h)} onChange={() => toggleHost(h.id)}>
                {shortHostName(hostLabel(h))}
              </Toggle>
            ))}
            {hosts.length === 0 && <span className="text-xs text-muted">No hosts yet</span>}
          </div>
        </div>

        <ServicePicker hosts={affected} servicesByHost={servicesByHost} error={servicesError} value={d.serviceIds} onChange={(ids) => set("serviceIds", ids)} />

        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>References</span>
          {d.refs.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {d.refs.map((r) => (
                <li key={r} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                  {/* No opener plugin: a link would be a dead click in the desktop app, so a URL is copied instead. */}
                  <span className="truncate font-mono text-xs text-fg">{r}</span>
                  <span className="flex gap-1.5">
                    {isUrl(r) && <CopyRef value={r} />}
                    <Button size="sm" aria-label={`Remove ${r}`} onClick={() => set("refs", d.refs.filter((x) => x !== r))}>Remove</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              mono
              aria-label="Add reference"
              value={newRef}
              placeholder="CVE-2017-0144, EDB-42315 or a URL"
              onChange={(e) => setNewRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  addRef(newRef);
                  setNewRef("");
                }
              }}
            />
            <Button onClick={() => { addRef(newRef); setNewRef(""); }}>Add</Button>
          </div>
          <RefSuggestions eid={eid} hostIds={d.hostIds} added={d.refs} onAdd={addRef} />
          <span aria-live="polite" className="text-xs text-muted">
            {nvd.looking ? `Looking up ${nvd.looking} on NVD…` : nvd.line ?? ""}
          </span>
          {nvd.diffs.map((df) => (
            <p key={df.field} className="m-0 flex flex-wrap items-center gap-2 text-xs text-fg-2">
              NVD has a different {FIELD_NAME[df.field]} ·
              <Button size="sm" onClick={() => set(df.field, df.nvd)}>use NVD</Button>
            </p>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Field
            label="CVSS vector"
            error={vector !== "" && score === null ? "Not a valid CVSS 3.1 or 4.0 vector" : undefined}
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
            <Input mono value={d.cvssVector} onChange={(e) => set("cvssVector", e.target.value)} placeholder="CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N" />
          </Field>
          <button
            type="button"
            aria-expanded={builder}
            title={builder ? "Fold the CVSS builder" : "Build the vector metric by metric"}
            onClick={() => setBuilder(!builder)}
            className="inline-flex cursor-default items-center gap-1 self-start text-xs text-fg-2 hover:text-fg"
          >
            {builder ? <CaretDownIcon size={12} weight="light" aria-hidden /> : <CaretRightIcon size={12} weight="light" aria-hidden />}
            CVSS builder
          </button>
          {builder && <CvssBuilder value={d.cvssVector} onChange={(v) => set("cvssVector", v)} />}
        </div>

        <Field label="Description"><Textarea rows={4} value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="Impact"><Textarea rows={3} value={d.impact} onChange={(e) => set("impact", e.target.value)} /></Field>
        <Field label="Remediation"><Textarea rows={3} value={d.remediation} onChange={(e) => set("remediation", e.target.value)} /></Field>
        <Field label="Exploit notes"><Textarea mono rows={4} value={d.exploitNotes} onChange={(e) => set("exploitNotes", e.target.value)} /></Field>

        <FindingSteps eid={eid} hostIds={d.hostIds} value={d.stepEntryIds} onChange={(ids) => set("stepEntryIds", ids)} />
        {edit ? (
          <FindingFiles
            findingId={edit.id}
            form={d.fileForm}
            onForm={(f) => set("fileForm", f)}
            onDirty={setFileDirty}
            register={registerFlush}
          />
        ) : (
          <p className="m-0 text-xs text-muted">Save the finding to attach files.</p>
        )}

        <Field label={<span className="inline-flex items-center gap-2">Lessons <Chip>Private</Chip></span>} hint="Never included in an export or report.">
          <Textarea rows={3} value={d.lessons} onChange={(e) => set("lessons", e.target.value)} />
        </Field>

        {formError && <p role="alert" className="m-0 text-xs text-warn">{formError}</p>}
      </div>
      {confirmDiscard && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirmDiscard(false)}
          title="Discard unsaved changes?"
          footer={
            <>
              <Button onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
              <Button variant="danger" onClick={onDiscard}>Discard</Button>
            </>
          }
        />
      )}
    </form>
  );
}
