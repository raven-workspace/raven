import * as RD from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { metasploitHostIds, metasploitWarning } from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { KeyIcon, XIcon } from "@phosphor-icons/react";
import { Button, Chip, Field, IconButton, Input, Kbd, Select, Textarea, Toggle, Toolbar } from "../../ui";
import { useHosts } from "../hosts/queries";
import { invalidateAfterSave } from "../log/extractions";
import { useLog } from "../log/queries";
import { HostChips } from "./HostChips";
import { clipboardImage, readImage, releaseImage } from "./imagePaste";
import { KindChips } from "./KindChips";
import { KindFields } from "./KindFields";
import { PasteArea } from "./PasteArea";
import { KINDS, resolveCapture } from "./resolve";
import { useSaveSummaryStore } from "./useSaveSummaryStore";
import { PartialSaveError, saveCapture } from "./saveCapture";
import { reportError } from "../../lib/lockSignal";
import { EMPTY_DRAFT, useCaptureStore, type PanelDraft } from "./useCaptureStore";

const NO_HOSTS: Host[] = [];
const NO_MACHINES: string[] = [];

export function CaptureForm({ engagement, pasteRef }: { engagement: Engagement; pasteRef: RefObject<HTMLElement | null> }) {
  const id = engagement.id;
  const qc = useQueryClient();
  const listed = useHosts(id).data ?? NO_HOSTS;
  const machines = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet }).data?.machines ?? NO_MACHINES;
  const pd = useCaptureStore((s) => s.drafts[id]) ?? EMPTY_DRAFT;
  // Hosts a failed save already created count as known, even before the list refetches.
  const hosts = useMemo(
    () => (pd.created.length ? [...listed, ...pd.created.filter((c) => !listed.some((h) => h.id === c.id))] : listed),
    [listed, pd.created],
  );
  const presetHostId = useCaptureStore((s) => s.hostId);
  const log = useLog(id).data;
  const notice = useCaptureStore((s) => s.notice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const focusCaption = useRef(false);

  const r = useMemo(
    () =>
      resolveCapture(pd, {
        hosts,
        scope: engagement.scopeCidrs,
        domain: engagement.domain ?? "",
        machines,
        lastRanOn: engagement.lastRanOn,
        presetHostId,
        log,
      }),
    [pd, hosts, machines, engagement, presetHostId, log],
  );
  const kind = r.edits.kind;
  // Exam sims: warn (without blocking) when this entry uses Metasploit off the locked host.
  const msfWarning = useMemo(() => {
    if (engagement.kind !== "exam-sim" || !engagement.msfHostId) return null;
    const draft: LogEntry = {
      id: "", engagementId: id, kind: r.edits.kind, title: "", titleEdited: false, ranOn: r.edits.ranOn || null,
      hostIds: r.edits.hostIds, observations: null, returnedNothing: false, private: false, content: r.edits.content,
      at: 0, createdAt: 0, updatedAt: 0,
    };
    return metasploitWarning(draft, engagement, metasploitHostIds(draft, engagement, hosts));
  }, [engagement, hosts, id, r.edits]);
  const set = (patch: Partial<PanelDraft>) => useCaptureStore.getState().update(id, patch);

  // After an image paste the caption is the next thing to type.
  useEffect(() => {
    if (focusCaption.current && captionRef.current) {
      focusCaption.current = false;
      captionRef.current.focus();
    }
  }, [pd.image]);

  const refresh = () => invalidateAfterSave(qc, id);

  async function save() {
    if (saving || !r.canSave) return;
    setSaving(true);
    setError(null);
    const store = useCaptureStore.getState();
    const image = pd.image && (kind === "screenshot" || kind === "flag") ? { mime: pd.image.mime, dataBase64: pd.image.dataBase64 } : null;
    try {
      const saved = await saveCapture({
        engagementId: id,
        draft: r.draft,
        draftInput: r.draftInput,
        edits: r.edits,
        image,
        hosts,
        onHostCreated: (h) => {
          const cur = useCaptureStore.getState().drafts[id]?.created ?? [];
          set({ created: [...cur, h] });
        },
      });
      refresh();
      store.discard(id);
      store.close();
      useSaveSummaryStore.getState().show(saved.entry.id, saved.summary);
    } catch (e) {
      // A `locked` rejection must reach the vault gate, as query and mutation errors do.
      for (const reason of e instanceof PartialSaveError ? e.reasons : [e]) reportError(reason);
      if (e instanceof PartialSaveError) {
        refresh();
        store.discard(id);
        store.setNotice(e.message);
        // The extraction was stored all the same: its summary (and Undo) still shows.
        useSaveSummaryStore.getState().show(e.entry.id, e.summary);
      } else {
        void qc.invalidateQueries({ queryKey: ["hosts", id] });
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  }

  /** Enter saves; Shift+Enter is a newline. */
  function enterSaves(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void save();
  }

  /** In a note, Enter saves only while the text is one line (R9). */
  function noteEnter(e: KeyboardEvent<HTMLElement>) {
    if (!pd.text.trim().includes("\n")) enterSaves(e);
  }

  /** ⌘ shortcuts; Ctrl, Shift or Alt with them does nothing. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= KINDS.length) set({ kind: KINDS[n - 1]!.kind });
    else if (e.key.toLowerCase() === "p") set({ private: !pd.private });
    else if (e.key === "." && kind === "command") set({ returnedNothing: !pd.returnedNothing });
    else if (e.key.toLowerCase() === "j" && r.credentials.length) set({ asNote: !pd.asNote });
    else if (e.key === "Enter") void save();
    else return;
    e.preventDefault();
  }

  function onPaste(e: ClipboardEvent<HTMLElement>) {
    const file = clipboardImage(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const keep = kind === "flag" ? ("flag" as const) : null;
    readImage(file).then(
      (image) => {
        releaseImage(useCaptureStore.getState().drafts[id]?.image);
        // The caption is the next thing to type, once this is a screenshot.
        focusCaption.current = keep === null;
        set({ image, kind: keep });
      },
      (err: Error) => setError(err.message),
    );
  }

  function removeImage() {
    releaseImage(pd.image);
    set({ image: null });
    pasteRef.current?.focus();
  }

  function discard() {
    useCaptureStore.getState().discard(id);
    useCaptureStore.getState().setNotice(null);
    setError(null);
    pasteRef.current?.focus();
  }

  const ranOnOptions = Array.from(new Set([...machines, ...hosts.map((h) => h.name), r.edits.ranOn].filter(Boolean)));
  const bindPaste = (el: HTMLElement | null) => {
    pasteRef.current = el;
  };

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto_auto]" onKeyDown={onKeyDown}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3">
        <div className="grid min-w-0 grid-flow-col auto-cols-max items-center justify-start gap-2">
          <RD.Title className="m-0 text-heading text-fg">Add to log</RD.Title>
          {pd.private && <Chip>Private, not in reports</Chip>}
        </div>
        <RD.Close asChild>
          <IconButton icon={XIcon} label="Close" shortcut="Esc" />
        </RD.Close>
      </header>

      <div className="grid min-h-0 content-start gap-4 overflow-y-auto px-4 py-4">
        {notice && <p className="m-0 rounded-sm border border-warn px-3 py-2 text-meta text-warn">{notice}</p>}
        <KindChips kind={kind} onChange={(k) => set({ kind: k })} />

        <PasteArea
          kind={kind}
          text={pd.text}
          image={pd.image}
          bindRef={bindPaste}
          onText={(text) => set({ text })}
          onPaste={onPaste}
          onKeyDown={kind === "note" ? noteEnter : enterSaves}
          onRemoveImage={removeImage}
        />

        <Field label="Title">
          <Input
            value={r.titleInput}
            placeholder={r.autoTitle}
            onChange={(e) => set({ title: e.target.value, titleEdited: true })}
            onKeyDown={enterSaves}
          />
        </Field>

        <KindFields
          content={r.edits.content}
          caption={pd.caption}
          onCaption={(caption) => set({ caption })}
          flagKind={r.flagKind}
          onFlagKind={(flagKind) => set({ flagKind })}
          onKeyDown={enterSaves}
          captionRef={captionRef}
        />

        <HostChips hosts={hosts} linked={r.edits.hostIds} onLinked={(hostIds) => set({ hostIds })} />
        {r.servicesLine && <p className="m-0 text-code text-muted">{r.servicesLine}</p>}
        {r.credentialsLine && (
          // The only cue that saving writes credential rows: foreground text with a key, unlike the services line.
          <p className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-code text-fg">
            <KeyIcon size={16} weight="regular" aria-hidden className="text-accent" />
            <span className="min-w-0">{r.credentialsLine}</span>
          </p>
        )}
        <Field label="Ran on">
          <Select
            value={r.edits.ranOn}
            onValueChange={(ranOn) => set({ ranOn })}
            placeholder="Machine"
            options={ranOnOptions.map((v) => ({ value: v, label: v }))}
            className="w-56"
          />
        </Field>

        <Field label="Observations">
          <Textarea
            rows={2}
            value={pd.observations}
            placeholder="Tentative notes, not proven facts"
            onChange={(e) => set({ observations: e.target.value })}
            onKeyDown={enterSaves}
          />
        </Field>

        <Toolbar>
          {kind === "command" && (
            <Toggle on={pd.returnedNothing} keys="⌘." onChange={() => set({ returnedNothing: !pd.returnedNothing })}>
              Returned nothing
            </Toggle>
          )}
          {r.credentials.length > 0 && (
            <Toggle on={!pd.asNote} keys="⌘J" onChange={() => set({ asNote: !pd.asNote })}>
              Add as {r.credentials.length === 1 ? "credential" : "credentials"}
            </Toggle>
          )}
          <Toggle on={pd.private} keys="⌘P" onChange={() => set({ private: !pd.private })}>
            Private
          </Toggle>
        </Toolbar>
      </div>

      {msfWarning && <p className="m-0 border-t border-line px-4 pt-3 text-meta text-warn">{msfWarning}</p>}
      <footer className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t border-line px-4 py-3">
        <Button onClick={discard}>Discard</Button>
        <p role="alert" className="m-0 min-w-0 truncate text-meta text-warn">
          {error}
        </p>
        <Button variant="primary" onClick={() => void save()} disabled={!r.canSave || saving}>
          Save <Kbd variant="inline" aria-hidden>↵</Kbd>
        </Button>
      </footer>
    </div>
  );
}
