import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SCROLL_PANE } from "../../../ui/controlStyles";
import { shortHostName, hostLabel } from "../../../lib/hostName";
import { isDialogOpen, isFreeKey, isTypingTarget } from "../../../lib/keys";
import { keyLabel, matches, SHORTCUTS } from "../../../lib/shortcuts";
import type { Finding } from "../../../types/findings";
import { Button } from "../../../ui/index";
import { useEngagementServices } from "../../services/queries";
import { useHosts } from "../../hosts/queries";
import { draftChanged, FindingEditor, toDraft, type Draft } from "../FindingEditor/FindingEditor";
import { SplitLeftPane, type ContextTab } from "../SplitLeftPane/SplitLeftPane";
import { draftKey, useFindingDraftStore } from "../useFindingDraftStore";
import { anyDrawerOpen } from "../../drawers";
import "./FindingSplit.scss";

type Pane = "context" | "editor";

/** ⌘\ by character, or by the physical key where layouts put "\" elsewhere. */
const isFlipChord = (e: KeyboardEvent) => matches(SHORTCUTS.flipSplit, e);

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
  // A kept draft comes back, unless the finding was saved since it was opened (from another host page, say):
  // then the saved finding wins and the stale draft is dropped.
  const [{ restored, replaced }] = useState(() => {
    const store = useFindingDraftStore.getState();
    const kept = store.get(key);
    if (kept && finding && (kept.baseUpdatedAt ?? 0) < finding.updatedAt) {
      store.drop(key);
      return { restored: undefined, replaced: true };
    }
    return { restored: kept, replaced: false };
  });
  // A save that failed after its form was gone (H, navigating away) is reported once, on the draft that comes back.
  const [saveError] = useState(() => useFindingDraftStore.getState().takeSaveError(key));
  const [d, setD] = useState<Draft>(() => restored ?? base);
  const [pane, setPane] = useState<Pane>("editor");
  const [tab, setTab] = useState<ContextTab>("log");
  const rootRef = useRef<HTMLDivElement>(null);
  // Whether the open file form holds unsaved text (only kept drafts with such a form are stored with it).
  const [fileDirty, setFileDirty] = useState(() => restored?.fileForm != null);

  // Keep the draft while it differs from what was opened; an untouched one leaves nothing behind.
  useEffect(() => {
    const store = useFindingDraftStore.getState();
    if (!draftChanged(d, base, fileDirty)) store.drop(key);
    else store.set(key, fileDirty ? d : { ...d, fileForm: null });
  }, [d, base, key, fileDirty]);

  // While a save is in flight the split stays open: closing then would leave the draft behind its own save.
  const savingRef = useRef(false);
  const onBusy = useCallback((busy: boolean) => {
    savingRef.current = busy;
  }, []);
  const close = () => {
    if (!savingRef.current) onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Capture phase, so these win over the shell's own N and Esc whatever the mount order.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isDialogOpen()) return;
      if (isFlipChord(e)) {
        e.preventDefault();
        setPane((p) => (p === "editor" ? "context" : "editor"));
      } else if ((e.key === "n" || e.key === "N") && isFreeKey(e) && !anyDrawerOpen("notes")) {
        // N: the left pane's notes, not the notes panel (left alone while the Arsenal drawer is up).
        e.preventDefault();
        setTab("notes");
        setPane("context");
      } else if (e.key === "Escape" && !rootRef.current?.contains(e.target as Node) && !isTypingTarget(e.target)) {
        // Esc from inside the split is handled on the way back up (below), so a field's own Esc goes first.
        // A drawer over the page (Arsenal, notes) closes before the split does.
        if (anyDrawerOpen()) return;
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
    close();
  };

  const allHosts = hosts.data ?? [];
  const pageHost = allHosts.find((h) => h.id === hostId);
  const discard = () => {
    useFindingDraftStore.getState().drop(key);
    onClose();
  };
  const saved = () => {
    // Every kept draft of this finding is now older than what was saved.
    if (finding) useFindingDraftStore.getState().dropFinding(finding.id);
    discard();
  };

  if (!hosts.data) return null;
  return (
    <div
      ref={rootRef}
      data-testid="finding-split"
      data-pane={pane}
      onKeyDown={onKeyDown}
      className="finding-split"
    >
      <div className="finding-split__flip">
        <Button size="sm" title={`Flip between the finding and the host (${keyLabel(SHORTCUTS.flipSplit)})`} onClick={() => setPane(pane === "editor" ? "context" : "editor")}>
          {pane === "editor" ? "Show the host's log, facts and notes" : "Back to the finding"}
        </Button>
      </div>
      <section
        aria-label="Host context"
        className="finding-split__context"
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
        className={`finding-split__editor ${SCROLL_PANE}`}
      >
        <FindingEditor
          eid={eid}
          hosts={allHosts}
          servicesByHost={servicesByHost}
          servicesError={servicesQ.error?.message}
          edit={finding}
          hostName={pageHost ? shortHostName(hostLabel(pageHost)) : undefined}
          draft={d}
          base={base}
          update={setD}
          onSaved={saved}
          onClose={close}
          onDiscard={discard}
          onFileDirty={setFileDirty}
          draftKey={key}
          onBusy={onBusy}
          notice={
            saveError
              ? `The last save didn't go through: ${saveError}`
              : replaced
                ? "Your unsaved draft was replaced by a newer save."
                : undefined
          }
        />
      </section>
    </div>
  );
}
