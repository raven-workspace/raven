import * as RD from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { metasploitHostIds, metasploitWarning } from "../../../engines/checklist/index";
import { useLibrary } from "../../../engines/library/store";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import { KeyIcon, XIcon } from "@phosphor-icons/react";
import { Button, Chip, Field, IconButton, Input, Kbd, Select, Textarea, Toggle, Toolbar } from "../../../ui/index";
import { useHosts } from "../../hosts/queries";
import { useLog } from "../../log/queries";
import { HostChips } from "../HostChips/HostChips";
import { clipboardImage, readImage, releaseImage } from "../imagePaste";
import { KindChips } from "../KindChips/KindChips";
import { KindFields } from "../KindFields/KindFields";
import { PasteArea } from "../PasteArea/PasteArea";
import { KINDS, resolveCapture } from "../resolve";
import { saveCapture } from "../saveCapture";
import { EntryChangeError } from "../../log/entryChange";
import { EMPTY_DRAFT, useCaptureStore, type PanelDraft } from "../useCaptureStore";
import { useSettings } from "../../settings/queries";
import { RavenError } from "../../../types/errors";
import "./CaptureForm.scss";

const NO_HOSTS: Host[] = [];
const NO_MACHINES: string[] = [];

export function CaptureForm({ engagement, pasteRef }: { engagement: Engagement; pasteRef: RefObject<HTMLElement | null> }) {
  const id = engagement.id;
  const qc = useQueryClient();
  const hostsQ = useHosts(id);
  const listed = hostsQ.data ?? NO_HOSTS;
  const machines = useSettings().data?.machines ?? NO_MACHINES;
  const library = useLibrary();
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
        library: library.commands,
        presetHostId,
        log,
      }),
    [pd, hosts, machines, engagement, presetHostId, log, library],
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

  async function save() {
    if (saving || !r.canSave) return;
    setSaving(true);
    setError(null);
    const store = useCaptureStore.getState();
    const image = pd.image && (kind === "screenshot" || kind === "flag") ? { mime: pd.image.mime, dataBase64: pd.image.dataBase64 } : null;
    // The save reports its own store change, summary and errors (the entry change); this form shows what's left.
    try {
      await saveCapture(qc, {
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
      store.discard(id);
      store.close();
    } catch (e) {
      if (e instanceof EntryChangeError) {
        // The entry is saved: the draft goes, so Save does not create it twice.
        store.discard(id);
        store.setNotice(e.message);
      } else {
        // Nothing was saved; the draft stays for a retry.
        setError(RavenError.from(e).message);
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

  /** The form's chords (⌘ on macOS, Ctrl on Linux); other modifiers with them do nothing. */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const n = SHORTCUTS.captureKinds.findIndex((sc) => matches(sc, e));
    if (n >= 0 && n < KINDS.length) set({ kind: KINDS[n]!.kind });
    else if (matches(SHORTCUTS.capturePrivate, e)) set({ private: !pd.private });
    else if (matches(SHORTCUTS.captureReturnedNothing, e) && kind === "command") set({ returnedNothing: !pd.returnedNothing });
    else if (matches(SHORTCUTS.captureAsNote, e) && r.credentials.length) set({ asNote: !pd.asNote });
    else if (matches(SHORTCUTS.captureSave, e)) void save();
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
    <div className="capture-form" onKeyDown={onKeyDown}>
      <header className="capture-form__header">
        <div className="capture-form__heading">
          <RD.Title className="capture-form__title">Add to log</RD.Title>
          {pd.private && <Chip>Private, not in reports</Chip>}
        </div>
        <RD.Close asChild>
          <IconButton icon={XIcon} label="Close" shortcut="Esc" />
        </RD.Close>
      </header>

      <div className="capture-form__body">
        {notice && <p className="capture-form__notice">{notice}</p>}
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

        <HostChips
          hosts={hosts} linked={r.edits.hostIds} onLinked={(hostIds) => set({ hostIds })}
          loadError={hostsQ.isError ? { retry: () => void hostsQ.refetch() } : null}
        />
        {r.servicesLine && <p className="capture-form__services">{r.servicesLine}</p>}
        {r.credentialsLine && (
          // The only cue that saving writes credential rows: foreground text with a key, unlike the services line.
          <p className="capture-form__credentials">
            <KeyIcon size={16} weight="regular" aria-hidden className="capture-form__key" />
            <span className="capture-form__credentials-text">{r.credentialsLine}</span>
          </p>
        )}
        <Field label="Ran on">
          <Select
            value={r.edits.ranOn}
            onValueChange={(ranOn) => set({ ranOn })}
            placeholder="Machine"
            options={ranOnOptions.map((v) => ({ value: v, label: v }))}
            className="capture-form__ran-on"
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
            <Toggle on={pd.returnedNothing} keys={SHORTCUTS.captureReturnedNothing} onChange={() => set({ returnedNothing: !pd.returnedNothing })}>
              Returned nothing
            </Toggle>
          )}
          {r.credentials.length > 0 && (
            <Toggle on={!pd.asNote} keys={SHORTCUTS.captureAsNote} onChange={() => set({ asNote: !pd.asNote })}>
              Add as {r.credentials.length === 1 ? "credential" : "credentials"}
            </Toggle>
          )}
          <Toggle on={pd.private} keys={SHORTCUTS.capturePrivate} onChange={() => set({ private: !pd.private })}>
            Private
          </Toggle>
        </Toolbar>
      </div>

      {msfWarning && <p className="capture-form__warning">{msfWarning}</p>}
      <footer className="capture-form__footer">
        <Button onClick={discard}>Discard</Button>
        <p role="alert" className="capture-form__error">
          {error}
        </p>
        <Button variant="primary" onClick={() => void save()} disabled={!r.canSave || saving}>
          Save <Kbd variant="inline" aria-hidden>↵</Kbd>
        </Button>
      </footer>
    </div>
  );
}
