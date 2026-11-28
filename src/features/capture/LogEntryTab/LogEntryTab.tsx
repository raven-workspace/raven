import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { boardRoute, LOG_ENTRY_KEY, routeKey } from "../../../engines/tabs";
import type { Engagement } from "../../../types/engagement";
import { Button, fieldLabelClass, Kbd } from "../../../ui/index";
import { useEngagement } from "../../engagements/queries";
import { tabId } from "../../workspace/EditorTabs/EditorTabs";
import { useEditorTabsStore } from "../../workspace/useEditorTabsStore";
import { LogEntryFields, LogEntryToggles } from "../LogEntryFields/LogEntryFields";
import { KindChips } from "../KindChips/KindChips";
import { PasteArea } from "../PasteArea/PasteArea";
import { useLogEntryForm } from "../useLogEntryForm";
import { useLogEntryStore } from "../useLogEntryStore";
import { LOG_ENTRY_TAB_ID } from "./logEntryTabId";
import "./LogEntryTab.scss";

/**
 * Closes the log entry tab and goes back to the tab that was active when it opened, focusing that tab; if that one has
 * closed since, the tab beside it, as ⌘W picks.
 */
function useLeaveTab(engagementId: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = `${location.pathname}${location.search}${location.hash}`;
  return () => {
    const tabs = useEditorTabsStore.getState();
    const next = tabs.close(engagementId, LOG_ENTRY_KEY, route);
    const from = useLogEntryStore.getState().returnRoute;
    const fromKey = from ? routeKey(engagementId, from) : null;
    const back = useEditorTabsStore.getState().byEngagement[engagementId]?.find((t) => t.key === fromKey);
    const to = back?.route ?? next ?? boardRoute(engagementId);
    void navigate(to);
    const key = routeKey(engagementId, to);
    if (key) requestAnimationFrame(() => document.getElementById(tabId(key))?.focus());
  };
}

function LogEntryTabForm({ engagement }: { engagement: Engagement }) {
  const pasteRef = useRef<HTMLElement | null>(null);
  const leave = useLeaveTab(engagement.id);
  const form = useLogEntryForm({ engagement, pasteRef, onSaved: leave, onDiscarded: leave });
  const { pd, r, kind, notice, error, saving, msfWarning, set } = form;

  // The paste area has focus when the tab opens, so ⌘V lands there and only there.
  useEffect(() => {
    pasteRef.current?.focus();
  }, []);

  return (
    <section id={LOG_ENTRY_TAB_ID} aria-label="New log entry" className="log-entry-tab" onKeyDown={form.onKeyDown}>
      <div className="log-entry-tab__head">
        <div className="log-entry-tab__top">
          <KindChips kind={kind} onChange={(k) => set({ kind: k })} />
          <p role="alert" className="log-entry-tab__error">
            {error}
          </p>
          <LogEntryToggles form={form} />
          <Button size="sm" onClick={form.discard}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={() => void form.save()} disabled={!r.canSave || saving}>
            Save <Kbd variant="inline" aria-hidden>↵</Kbd>
          </Button>
        </div>
        {msfWarning && <p className="log-entry-tab__warning">{msfWarning}</p>}
        {notice && <p className="log-entry-tab__warning">{notice}</p>}
      </div>

      <div className="log-entry-tab__body">
        <div className="log-entry-tab__paste">
          <span className={fieldLabelClass} aria-hidden>
            Paste
          </span>
          <PasteArea
            fill
            kind={kind}
            text={pd.text}
            image={pd.image}
            bindRef={form.bindPaste}
            onText={(text) => set({ text })}
            onPaste={form.onPaste}
            onDragOver={form.onDragOver}
            onDrop={form.onDrop}
            onKeyDown={kind === "note" ? form.noteEnter : form.enterSaves}
            onRemoveImage={form.removeImage}
          />
        </div>
        <div className="log-entry-tab__fields">
          <LogEntryFields form={form} labelHosts />
        </div>
      </div>
    </section>
  );
}

/**
 * The log entry tab, "New log entry" (`/e/:id/log-entry`, design §2.5): where the owner pastes or types a log entry by
 * hand. One per engagement; its draft lives in the log entry store, so closing the tab (⌘W) keeps it and Discard
 * clears it. Save writes the entry, closes the tab and goes back to the tab that was active before.
 */
export function LogEntryTab() {
  const { id = "" } = useParams();
  const engagement = useEngagement(id).data;
  return engagement ? <LogEntryTabForm engagement={engagement} /> : null;
}
