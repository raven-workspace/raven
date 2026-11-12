import { Check, Copy, PencilSimple, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { FindingFile } from "../../types/findings";
import { ActionCell, Button, Field, IconButton, Input, Select, Textarea, Toggle, fieldLabelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { CodeView, guessLanguage, LANGUAGES } from "./CodeView";
import { useFindingFileMutations, useFindingFiles } from "./queries";
import { copyPlain } from "../../lib/clipboard";

const MAX_BYTES = 1024 * 1024;
const AUTO = "auto";
const LANGUAGE_OPTIONS = [{ value: AUTO, label: "Auto (from name)" }, ...LANGUAGES.map((l) => ({ value: l, label: l }))];
const bytes = (s: string) => new TextEncoder().encode(s).length;

interface Draft {
  name: string;
  /** "auto" follows the file name's extension. */
  language: string;
  content: string;
  /** An exploit adapted from a public one; the original is kept beside it. */
  modified: boolean;
  originalUrl: string;
  originalContent: string;
}

/** The open file form, held by the finding's draft so closing the split never loses pasted text. */
export interface FileFormDraft extends Draft {
  /** The file being edited; null while adding one. */
  fileId: string | null;
}

/** The form's fields as they start for `file` (or a new one). */
function initialFields(file?: FindingFile): Draft {
  return {
    name: file?.name ?? "",
    language: file?.language && file.language !== guessLanguage(file.name) ? file.language : AUTO,
    content: file?.content ?? "",
    modified: file?.modified ?? false,
    originalUrl: file?.originalUrl ?? "",
    originalContent: file?.originalContent ?? "",
  };
}

/** Add or edit one file: paste its text, or choose a local text file. */
function FileForm({ findingId, file, value, onChange, onDone, onDirty, register }: {
  findingId: string;
  file?: FindingFile;
  value: Draft;
  onChange: (d: Draft) => void;
  onDone: () => void;
  /** Reports whether the form holds unsaved changes. */
  onDirty: (dirty: boolean) => void;
  /** Hands the parent a function that saves the pending draft (true when saved). */
  register: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const { create, update } = useFindingFileMutations(findingId);
  const [initial] = useState<Draft>(() => initialFields(file));
  const d = value;
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const setD = (next: Draft) => onChange(next);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function choose(f: File) {
    setError(undefined);
    if (f.size > MAX_BYTES) {
      setError(`${f.name} is over 1 MiB`);
      return;
    }
    let text: string;
    try {
      text = await f.text();
    } catch {
      setError(`Couldn't read ${f.name}`);
      return;
    }
    if (text.includes("\0")) {
      setError(`${f.name}: text files only`);
      return;
    }
    const p = latest.current;
    setD({ ...p, name: p.name.trim() === "" ? f.name : p.name, content: text });
  }

  async function submit(): Promise<boolean> {
    const name = d.name.trim();
    if (name === "") return fail("Give the file a name");
    if (bytes(d.content) > MAX_BYTES) return fail("The content is over 1 MiB");
    if (d.modified && bytes(d.originalContent) > MAX_BYTES) return fail("The original code is over 1 MiB");
    setError(undefined);
    setBusy(true);
    const input = {
      name,
      language: d.language === AUTO ? guessLanguage(name) : d.language,
      content: d.content,
      modified: d.modified,
      // Blank clears. Unmodified sends neither, so the backend keeps the stored original for when the toggle goes back on.
      originalUrl: d.modified ? d.originalUrl.trim() : undefined,
      originalContent: d.modified ? d.originalContent : undefined,
    };
    try {
      if (file) await update.mutateAsync({ id: file.id, input });
      else await create.mutateAsync(input);
    } catch (e) {
      setBusy(false);
      return fail(e instanceof Error ? e.message : "Couldn't save the file");
    }
    onDone();
    return true;
  }
  function fail(message: string) {
    setError(message);
    return false;
  }

  const dirty = d.name !== initial.name || d.language !== initial.language || d.content !== initial.content
    || d.modified !== initial.modified || d.originalUrl !== initial.originalUrl || d.originalContent !== initial.originalContent;
  // An untouched form has nothing to save: the finding's Save must not be blocked by it.
  const flush = async () => (dirty ? submit() : true);
  const submitRef = useRef(flush);
  useEffect(() => {
    submitRef.current = flush;
  });
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    register(() => submitRef.current());
    return () => {
      register(null);
      onDirty(false);
    };
  }, [register, onDirty]);

  return (
    <div className="grid gap-3 rounded-sm border border-line-2 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="File name">
          <Input mono value={d.name} placeholder="poc.lua" onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <Field label="Language">
          <Select options={LANGUAGE_OPTIONS} value={d.language} onValueChange={(v) => setD({ ...d, language: v })} />
        </Field>
      </div>
      <Field label="File content">
        <Textarea mono rows={8} wrap="off" value={d.content} onChange={(e) => setD({ ...d, content: e.target.value })} />
      </Field>
      <div className="grid justify-items-start">
        <Toggle on={d.modified} onChange={(modified) => setD({ ...d, modified })}>Modified exploit</Toggle>
      </div>
      {d.modified && (
        <>
          <Field label="Original URL">
            <Input mono value={d.originalUrl} placeholder="https://www.exploit-db.com/exploits/50000" onChange={(e) => setD({ ...d, originalUrl: e.target.value })} />
          </Field>
          <Field label="Original code">
            <Textarea mono rows={6} wrap="off" value={d.originalContent} onChange={(e) => setD({ ...d, originalContent: e.target.value })} />
          </Field>
        </>
      )}
      <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content_max-content] items-center gap-2">
        <input
          ref={picker}
          type="file"
          aria-label="Choose a file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void choose(f);
          }}
        />
        <Button size="sm" onClick={() => picker.current?.click()}>Choose file</Button>
        <span className="truncate text-meta text-muted">Text only, up to 1 MiB.</span>
        <Button size="sm" aria-label="Cancel file" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => { if (!busy) void submit(); }}>Save file</Button>
      </div>
      {error && <p role="alert" className="m-0 text-meta text-warn">{error}</p>}
    </div>
  );
}

function FileRow({ findingId, file, onEdit }: { findingId: string; file: FindingFile; onEdit: () => void }) {
  const { remove } = useFindingFileMutations(findingId);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  return (
    <li className="grid gap-2 border-b border-line py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_max-content_max-content] items-center gap-3">
        <span className="truncate font-mono text-code text-fg" title={file.name}>{file.name}</span>
        <span className="grid grid-flow-col gap-2 text-meta text-muted">
          {file.modified && <span className="text-accent">Modified</span>}
          <span>{file.language ?? guessLanguage(file.name)}</span>
        </span>
        <ActionCell>
          <IconButton
            icon={copied ? Check : Copy}
            label={`Copy ${file.name}`}
            onClick={() => copyPlain(file.content).then(
              () => {
                setCopyError(undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => setCopyError("Couldn't copy to the clipboard"),
            )}
          />
          <IconButton icon={PencilSimple} label={`Edit ${file.name}`} onClick={onEdit} />
          <IconButton icon={Trash} tone="destructive" label={`Delete ${file.name}`} onClick={() => setDeleting(true)} />
        </ActionCell>
      </div>
      {copyError && <p role="alert" className="m-0 text-meta text-warn">{copyError}</p>}
      <CodeView code={file.content} language={file.language ?? guessLanguage(file.name)} />
      {deleting && (
        <ConfirmDelete
          title={`Delete ${file.name}?`}
          label="Delete file"
          pending={remove.isPending}
          error={remove.error?.message}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate(file.id, { onSuccess: () => setDeleting(false) })}
        />
      )}
    </li>
  );
}

/** A saved finding's files (exploit code and the like). They save on their own, not with the finding form. */
export function FindingFiles({ findingId, form, onForm, onDirty, register }: {
  findingId: string;
  /** The open file form, or null; owned by the finding's draft. */
  form: FileFormDraft | null;
  onForm: (form: FileFormDraft | null) => void;
  onDirty: (dirty: boolean) => void;
  register: (flush: (() => Promise<boolean>) | null) => void;
}) {
  const files = useFindingFiles(findingId);
  const formFile = form?.fileId ? files.data?.find((f) => f.id === form.fileId) : undefined;
  // Editing a file: wait for the list, so the form knows what "unchanged" means. A file deleted meanwhile becomes a new one.
  const formReady = form !== null && (form.fileId === null || files.data !== undefined);
  const open = (file?: FindingFile) => onForm({ fileId: file?.id ?? null, ...initialFields(file) });
  return (
    <div role="group" aria-label="Finding files" className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <span className={fieldLabelClass}>Files</span>
        {!form && <Button size="sm" onClick={() => open()}>Add file</Button>}
      </div>
      {files.isError && <p role="alert" className="m-0 text-meta text-warn">Couldn't load files: {files.error.message}</p>}
      {formReady && (
        <FileForm
          key={formFile?.id ?? "new"}
          findingId={findingId}
          file={formFile}
          value={form}
          onChange={(d) => onForm({ ...d, fileId: formFile?.id ?? null })}
          onDone={() => onForm(null)}
          onDirty={onDirty}
          register={register}
        />
      )}
      {files.data && files.data.length === 0 && !form && <p className="m-0 text-meta text-muted">No files yet. Paste exploit code or choose a file.</p>}
      {files.data && files.data.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {files.data.map((f) => <FileRow key={f.id} findingId={findingId} file={f} onEdit={() => open(f)} />)}
        </ul>
      )}
    </div>
  );
}
