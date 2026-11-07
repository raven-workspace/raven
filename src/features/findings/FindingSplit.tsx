import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cx } from "../../lib/cx";
import { isDialogOpen, isFreeKey, isTypingTarget } from "../../lib/keys";
import type { Finding } from "../../types/findings";
import { Button, Dialog } from "../../ui";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useEngagementServices } from "../checklist/queries";
import { hostLabel } from "../credentials/AccessGrants";
import { useHosts } from "../hosts/queries";
import { useNotesStore } from "../notes/useNotesStore";
import { FindingEditor, toDraft, type Draft } from "./FindingEditor";
import { SplitLeftPane, type ContextTab } from "./SplitLeftPane";
import { draftKey, useFindingDraftStore } from "./useFindingDraftStore";

type Pane = "context" | "editor";

/** ⌘\ by character, or by the physical key where layouts put "\" elsewhere. */
const isFlipChord = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "\\" || e.code === "Backslash");

/**
 * Adding or editing a finding, in place: the host's Log, Facts and Notes stay live on the left while the form
 * is on the right. A temporary mode, never a modal. The draft outlives closing (Esc, ×, H, navigating away) in
 * memory only, and comes back when the same finding (or "Add finding" on the same host) opens again.
 *
 * Narrow (below the host page's two-column width) one pane shows at a time and ⌘\ flips between them.
 */
export function FindingSplit({ eid, hostId, edit, onClose }: {
  eid: string;
  hostId: string | null;
  edit: Finding | "new";
  onClose(): void;
}) {
  const hosts = useHosts(eid);
  const { servicesByHost, query: servicesQ } = useEngagementServices(eid);
  const finding = edit === "new" ? undefined : edit;
  const key = draftKey(eid, hostId, finding?.id ?? null);
  const [base] = useState(() => toDraft(finding, hostId));
  const [d, setD] = useState<Draft>(() => useFindingDraftStore.getState().get(key) ?? base);
  const [pane, setPane] = useState<Pane>("editor");
  const [tab, setTab] = useState<ContextTab>("log");
  const rootRef = useRef<HTMLDivElement>(null);
  // A pasted file is not part of the draft: closing with one unsaved asks first.
  const [fileDirty, setFileDirty] = useState(false);
  const [confirmFile, setConfirmFile] = useState(false);
  const requestClose = () => (fileDirty ? setConfirmFile(true) : onClose());

  // Keep the draft while it differs from what was opened; an untouched one leaves nothing behind.
  useEffect(() => {
    const store = useFindingDraftStore.getState();
    if (JSON.stringify(d) === JSON.stringify(base)) store.drop(key);
    else store.set(key, d);
  }, [d, base, key]);

  const closeRef = useRef(requestClose);
  useEffect(() => {
    closeRef.current = requestClose;
  });

  // Capture phase, so these win over the shell's own N and Esc whatever the mount order.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isDialogOpen()) return;
      if (isFlipChord(e)) {
        e.preventDefault();
        setPane((p) => (p === "editor" ? "context" : "editor"));
      } else if ((e.key === "n" || e.key === "N") && isFreeKey(e)) {
        // N: the left pane's notes, not the notes panel.
        e.preventDefault();
        setTab("notes");
        setPane("context");
      } else if (e.key === "Escape" && !rootRef.current?.contains(e.target as Node) && !isTypingTarget(e.target)) {
        // Esc from inside the split is handled on the way back up (below), so a field's own Esc goes first.
        // A drawer over the page (Arsenal, notes) closes before the split does.
        if (useArsenalStore.getState().open || useNotesStore.getState().open) return;
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
    // An open select list closes first.
    if ((e.target as Element).closest('[role="listbox"]')) return;
    e.preventDefault();
    requestClose();
  };

  const allHosts = hosts.data ?? [];
  const pageHost = allHosts.find((h) => h.id === hostId);
  const discard = () => {
    useFindingDraftStore.getState().drop(key);
    onClose();
  };

  if (!hosts.data) return null;
  return (
    <div
      ref={rootRef}
      data-testid="finding-split"
      data-pane={pane}
      onKeyDown={onKeyDown}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 @min-[760px]/host:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] @min-[760px]/host:grid-rows-1 @min-[760px]/host:gap-6"
    >
      <div className="@min-[760px]/host:hidden">
        <Button size="sm" title="Flip between the finding and the host (⌘\)" onClick={() => setPane(pane === "editor" ? "context" : "editor")}>
          {pane === "editor" ? "Show the host's log, facts and notes" : "Back to the finding"}
        </Button>
      </div>
      <section
        aria-label="Host context"
        className={cx("min-h-0 min-w-0 flex-col", pane === "context" ? "flex" : "hidden", "@min-[760px]/host:flex")}
      >
        <SplitLeftPane
          eid={eid}
          hosts={allHosts}
          hostIds={d.hostIds}
          preferredHostId={hostId}
          tab={tab}
          onTab={setTab}
          steps={d.stepEntryIds}
          onPick={(id) => setD((p) => (p.stepEntryIds.includes(id) ? p : { ...p, stepEntryIds: [...p.stepEntryIds, id] }))}
        />
      </section>
      <section
        aria-label="Finding"
        className={cx("min-h-0 min-w-0 overflow-y-auto pr-3 [scrollbar-gutter:stable]", pane === "editor" ? "block" : "hidden", "@min-[760px]/host:block")}
      >
        <FindingEditor
          eid={eid}
          hosts={allHosts}
          servicesByHost={servicesByHost}
          servicesError={servicesQ.error?.message}
          edit={finding}
          hostName={pageHost ? hostLabel(pageHost) : undefined}
          draft={d}
          base={base}
          update={setD}
          onSaved={discard}
          onClose={requestClose}
          onDiscard={discard}
          onFileDirty={setFileDirty}
        />
      </section>
      {confirmFile && (
        <Dialog
          open
          onOpenChange={(o) => !o && setConfirmFile(false)}
          title="Discard the unsaved file?"
          description="The finding's draft is kept; the file you pasted is not saved yet."
          footer={
            <>
              <Button onClick={() => setConfirmFile(false)}>Keep editing</Button>
              <Button variant="danger" onClick={onClose}>Discard file</Button>
            </>
          }
        />
      )}
    </div>
  );
}
