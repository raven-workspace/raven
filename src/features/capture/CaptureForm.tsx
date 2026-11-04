import * as RD from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { metasploitHostIds, metasploitWarning } from "../../engines/checklist";
import { api } from "../../lib/api";
import type { Engagement } from "../../types/engagement";
import type { Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { Button, Chip, Field, Input, Kbd, Select, Textarea } from "../../ui";
import { useHosts } from "../hosts/queries";
import { credAttemptsKey, credentialsKey, useCredentials, useUsernames, usernamesKey } from "../credentials/queries";
import { HostChips } from "./HostChips";
import { clipboardImage, readImage, releaseImage } from "./imagePaste";
import { KindChips } from "./KindChips";
import { KindFields } from "./KindFields";
import { PasteArea } from "./PasteArea";
import { Toggle } from "./Toggle";
import { IntakePreview } from "./IntakePreview";
import { intakePlanFor, KINDS, resolveCapture } from "./resolve";
import { PartialSaveError, saveCapture } from "./saveCapture";
import { reportError } from "../../lib/lockSignal";
import { EMPTY_DRAFT, useCaptureStore, type PanelDraft } from "./useCaptureStore";

const NO_HOSTS: Host[] = [];
const NO_MACHINES: string[] = [];
const NO_CREDENTIALS: Credential[] = [];
const NO_USERNAMES: Username[] = [];

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
      }),
    [pd, hosts, machines, engagement, presetHostId],
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
  // nxc intake: the credentials and usernames are read only once the paste has nxc results or roast hashes.
  const hasIntake = useMemo(
    () => intakePlanFor(r.edits, { engagementId: id, hosts, credentials: NO_CREDENTIALS, usernames: NO_USERNAMES }) !== null,
    [r.edits, id, hosts],
  );
  const credsQ = useCredentials(id, { enabled: hasIntake });
  const usersQ = useUsernames(id, { enabled: hasIntake });
  const intake = useMemo(
    () =>
      hasIntake && credsQ.data && usersQ.data
        ? intakePlanFor(r.edits, { engagementId: id, hosts, credentials: credsQ.data, usernames: usersQ.data })
        : null,
    [hasIntake, credsQ.data, usersQ.data, r.edits, id, hosts],
  );
  const set = (patch: Partial<PanelDraft>) => useCaptureStore.getState().update(id, patch);

  // After an image paste the caption is the next thing to type.
  useEffect(() => {
    if (focusCaption.current && captionRef.current) {
      focusCaption.current = false;
      captionRef.current.focus();
    }
  }, [pd.image]);

  function refresh() {
    for (const key of [["log", id], ["hosts", id], ["services"], ["services", "engagement", id], ["checklist", id], ["progress"], ["engagement", id], ["engagements"], credentialsKey(id), usernamesKey(id), credAttemptsKey(id)]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  async function save() {
    if (saving || !r.canSave) return;
    setSaving(true);
    setError(null);
    const store = useCaptureStore.getState();
    const image = pd.image && (kind === "screenshot" || kind === "flag") ? { mime: pd.image.mime, dataBase64: pd.image.dataBase64 } : null;
    // The lists the preview showed (read now if it hasn't loaded yet). Nothing is saved when they can't be read.
    let intakeLists: { credentials: Credential[]; usernames: Username[] } | undefined;
    if (hasIntake) {
      try {
        const [credentials, usernames] = await Promise.all([
          qc.ensureQueryData({ queryKey: credentialsKey(id), queryFn: () => api.credentialsList(id) }),
          qc.ensureQueryData({ queryKey: usernamesKey(id), queryFn: () => api.usernamesList(id) }),
        ]);
        intakeLists = { credentials, usernames };
      } catch (e) {
        reportError(e);
        setError(`Couldn't read the credentials: ${e instanceof Error ? e.message : String(e)}`);
        setSaving(false);
        return;
      }
    }
    try {
      await saveCapture({
        engagementId: id,
        draft: r.draft,
        draftInput: r.draftInput,
        edits: r.edits,
        addIps: pd.addIps,
        image,
        hosts,
        intake: intakeLists && { ...intakeLists, toggles: pd.intakeToggles },
        onHostCreated: (h) => {
          const cur = useCaptureStore.getState().drafts[id]?.created ?? [];
          set({ created: [...cur, h] });
        },
      });
      refresh();
      store.discard(id);
      store.close();
    } catch (e) {
      // A `locked` rejection must reach the vault gate, as query and mutation errors do.
      reportError(e instanceof PartialSaveError ? e.reason : e);
      if (e instanceof PartialSaveError) {
        refresh();
        store.discard(id);
        store.setNotice(e.message);
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
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <RD.Title className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-fg">Add to log</RD.Title>
          {pd.private && <Chip>Private · not in reports</Chip>}
        </div>
        <RD.Close aria-label="Close" className="shrink-0 rounded-sm border border-transparent p-0.5 hover:border-line-2">
          <Kbd>esc</Kbd>
        </RD.Close>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
        {notice && <p className="m-0 rounded-sm border border-warn px-2.5 py-2 text-[13px] text-warn">{notice}</p>}
        <KindChips kind={kind} onChange={(k) => set({ kind: k })} />

        <PasteArea
          kind={kind}
          text={pd.text}
          image={pd.image}
          bindRef={bindPaste}
          onText={(text) => set({ text, intakeToggles: {} })}
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
          hosts={hosts}
          linked={r.edits.hostIds}
          addIps={pd.addIps}
          unknownIps={r.unknownIps}
          onLinked={(hostIds) => set({ hostIds })}
          onAddIps={(addIps) => set({ addIps })}
        />
        {r.servicesLine && <p className="m-0 font-mono text-xs text-muted">{r.servicesLine}</p>}
        {intake && (
          <IntakePreview
            plan={intake}
            hosts={hosts}
            toggles={pd.intakeToggles}
            onToggle={(key, on) => set({ intakeToggles: { ...pd.intakeToggles, [key]: on } })}
          />
        )}
        {hasIntake && (credsQ.error ?? usersQ.error) && (
          <p role="alert" className="m-0 text-xs text-warn">
            Couldn't read the credentials: {(credsQ.error ?? usersQ.error)!.message}
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

        <div className="flex flex-wrap gap-1.5">
          {kind === "command" && (
            <Toggle on={pd.returnedNothing} keys="⌘." onClick={() => set({ returnedNothing: !pd.returnedNothing })}>
              Returned nothing
            </Toggle>
          )}
          <Toggle on={pd.private} keys="⌘P" onClick={() => set({ private: !pd.private })}>
            Private
          </Toggle>
        </div>
      </div>

      {msfWarning && <p className="m-0 shrink-0 border-t border-line px-4 pt-2.5 text-xs text-warn">{msfWarning}</p>}
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        <Button onClick={discard}>Discard</Button>
        <p role="alert" className="m-0 min-w-0 flex-1 truncate text-xs text-warn">
          {error}
        </p>
        <Button variant="primary" onClick={() => void save()} disabled={!r.canSave || saving}>
          Save <Kbd aria-hidden>↵</Kbd>
        </Button>
      </footer>
    </div>
  );
}
