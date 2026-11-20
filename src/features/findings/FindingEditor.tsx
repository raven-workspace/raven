import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isCveId, nvdFill, scoreCvss, scoreToSeverity, type NvdFillResult } from "../../engines/findings";
import { api } from "../../lib/api";
import { copyPlain } from "../../lib/clipboard";
import { CopySecretButton } from "../credentials/MaskedSecret";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { RavenError } from "../../types/errors";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import type { Finding, FindingInput, FindingStatus, NvdRecord, Severity } from "../../types/findings";
import { ActionCell, Button, Chip, ChipSet, Dialog, Disclosure, Field, IconButton, Input, Select, Textarea, Toggle, fieldLabelClass } from "../../ui";
import { hostLabel } from "../credentials/AccessGrants";
import { useLog } from "../log/queries";
import { CvssBuilder } from "./CvssBuilder";
import { FindingFiles, type FileFormDraft } from "./FindingFiles";
import { FindingSteps, liveSteps } from "./FindingSteps";
import { useFindingMutations } from "./queries";
import { useFindingDraftStore } from "./useFindingDraftStore";
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
  /** CVEs added whose NVD lookup has not answered: closing within the debounce, or mid-lookup, resumes on reopen. */
  nvdPending: string[];
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
  return fileDirty || JSON.stringify({ ...d, fileForm: null, nvdPending: [] }) !== JSON.stringify({ ...base, fileForm: null, nvdPending: [] });
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
  nvdPending: [],
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
      return "Add an NVD API key in Settings to look up CVEs. Use the builder.";
    case "offline":
      return "No connection. Use the builder.";
    case "nvd_busy":
      return "NVD is busy right now. Try again in a moment, or use the builder.";
    case "key_rejected":
      return err.message || "NVD rejected the key";
    case "not_found":
      return "CVE not found on NVD";
    default:
      return `Couldn't look up ${cve}: ${err.message}`;
  }
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
        // The merge runs against the draft as it is when the update lands, not a snapshot from before the await.
        const merge = (p: Draft): Draft => {
          const kept = [...records.current.keys()].filter((id) => p.refs.includes(id)).flatMap((id) => records.current.get(id) ?? []);
          const { apply } = nvdFill({ cvssVector: p.cvssVector, description: p.description, refs: p.refs }, kept);
          return {
            ...p,
            ...apply,
            refs: apply.refs ? [...p.refs, ...apply.refs.filter((r) => !p.refs.includes(r))] : p.refs,
            nvdPending: p.nvdPending.filter((c) => c !== cve),
          };
        };
        const d = latest.current;
        const keptIds = [...records.current.keys()].filter((id) => d.refs.includes(id));
        const { diffs: next } = nvdFill({ cvssVector: d.cvssVector, description: d.description, refs: d.refs }, keptIds.flatMap((id) => records.current.get(id) ?? []));
        update(merge);
        setDiffs({ cves: keptIds, items: next });
        setLine(undefined);
        setLooking((c) => (c === cve ? undefined : c));
      },
      (e: unknown) => {
        reportError(e);
        if (!live.current) return;
        update((p) => (p.nvdPending.includes(cve) ? { ...p, nvdPending: p.nvdPending.filter((c) => c !== cve) } : p));
        setLine({ cve, text: lookupLine(cve, e) });
        setLooking((c) => (c === cve ? undefined : c));
      },
    );
  };

  const schedule = (cve: string) => {
    clearTimeout(timers.current.get(cve));
    timers.current.set(cve, setTimeout(() => run(cve), NVD_DEBOUNCE_MS));
  };
  const lookup = (cve: string) => {
    // Kept in the draft until answered, so an editor closed before the debounce fires still looks it up on reopen.
    update((p) => (p.nvdPending.includes(cve) ? p : { ...p, nvdPending: [...p.nvdPending, cve] }));
    schedule(cve);
  };
  // A kept draft that comes back resumes the lookups it had not finished.
  useEffect(() => {
    for (const cve of latest.current.nvdPending) schedule(cve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        // Shown here, so the store's after-close record is not needed.
        if (draftKey) useFindingDraftStore.getState().takeSaveError(draftKey);
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
    <form aria-label={title} onSubmit={(e) => e.preventDefault()} className="grid">
      <header className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3 border-b border-line bg-bg pb-2">
        <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-2">
          <h2 className="m-0 truncate text-heading text-fg">{title}</h2>
          {hostName && <span className="truncate text-meta text-muted" title={hostName}>{hostName}</span>}
        </div>
        <ActionCell>
          {dirty && (
            <Button size="sm" onClick={() => setConfirmDiscard(true)}>Discard changes</Button>
          )}
          <Button size="sm" variant="primary" disabled={busy} title="Save (⌘↵)" onClick={save}>Save</Button>
          <IconButton icon={X} label="Close, keeping the draft" aria-label="Close" shortcut="Esc" disabled={busy} onClick={onClose} />
        </ActionCell>
      </header>

      <div className="grid gap-4 pt-3">
        {notice && <p role="status" className="m-0 text-meta text-muted">{notice}</p>}
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

        <div role="group" aria-label="Affected hosts" className="grid gap-2">
          <span className={fieldLabelClass}>Affected hosts</span>
          <ChipSet>
            {hosts.map((h) => (
              <Toggle key={h.id} on={d.hostIds.includes(h.id)} title={hostLabel(h)} onChange={() => toggleHost(h.id)}>
                {shortHostName(hostLabel(h))}
              </Toggle>
            ))}
            {hosts.length === 0 && <span className="text-meta text-muted">No hosts yet</span>}
          </ChipSet>
        </div>

        <ServicePicker hosts={affected} servicesByHost={servicesByHost} error={servicesError} value={d.serviceIds} onChange={(ids) => set("serviceIds", ids)} />

        <div className="grid gap-2">
          <span className={fieldLabelClass}>References</span>
          {d.refs.length > 0 && (
            <ul className="m-0 grid list-none gap-1 p-0">
              {d.refs.map((r) => (
                <li key={r} className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2">
                  {/* No opener plugin: a link would be a dead click in the desktop app, so a URL is copied instead. */}
                  <span className="truncate font-mono text-code text-fg" title={r}>{r}</span>
                  <ActionCell>
                    {isUrl(r) ? <CopySecretButton secret={r} label={r} copy={copyPlain} /> : <span aria-hidden className="size-7" />}
                    <IconButton icon={X} tone="destructive" label={`Remove ${r}`} onClick={() => update((p) => ({ ...p, refs: p.refs.filter((x) => x !== r), nvdPending: p.nvdPending.filter((x) => x !== r) }))} />
                  </ActionCell>
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
          <span aria-live="polite" className="text-meta text-muted">
            {nvd.looking ? `Looking up ${nvd.looking} on NVD…` : nvd.line ?? ""}
          </span>
          {nvd.diffs.map((df) => (
            <p key={df.field} className="m-0 grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2 text-meta text-fg-2">
              <span>NVD has a different {FIELD_NAME[df.field]}</span>
              <Button size="sm" onClick={() => set(df.field, df.nvd)}>use NVD</Button>
            </p>
          ))}
        </div>

        <div className="grid gap-2">
          <Field
            label="CVSS vector"
            error={vector !== "" && score === null ? "Not a valid CVSS 3.1 or 4.0 vector" : undefined}
            hint={
              score !== null && suggested ? (
                <span className="grid grid-flow-col auto-cols-max items-center justify-start gap-2">
                  <span className="font-mono text-code text-fg">{score.toFixed(1)}</span>
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
          <Disclosure label="CVSS builder" open={builder} onOpenChange={setBuilder}>
            <CvssBuilder value={d.cvssVector} onChange={(v) => set("cvssVector", v)} />
          </Disclosure>
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
          <p className="m-0 text-meta text-muted">Save the finding to attach files.</p>
        )}

        <Field label={<span className="grid grid-flow-col auto-cols-max items-center justify-start gap-2">Lessons <Chip>Private</Chip></span>} hint="Never included in an export or report.">
          <Textarea rows={3} value={d.lessons} onChange={(e) => set("lessons", e.target.value)} />
        </Field>

        {formError && <p role="alert" className="m-0 text-meta text-warn">{formError}</p>}
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
