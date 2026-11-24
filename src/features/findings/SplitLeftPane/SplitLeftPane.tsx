import { useEffect, useRef, useState } from "react";
import { cx } from "../../../lib/cx";
import { ChipSet, queryState, Tooltip } from "../../../ui/index";
import { SCROLL_PANE } from "../../../ui/controlStyles";
import { TAB_MARK } from "../../../ui/shadcn/tabs";
import { TabMarker, usePanelFade } from "../../../ui/TabMarker";
import type { Host } from "../../../types/host";
import { shortHostName, hostLabel } from "../../../lib/hostName";
import { FactsColumn } from "../../hosts/facts/FactsColumn/FactsColumn";
import { LogEntryRow } from "../../log/LogEntryRow/LogEntryRow";
import { useLog } from "../../log/queries";
import { byOrder, useLogOrder } from "../../log/useLogOrder";
import { NoteEditor } from "../../notes/NoteEditor/NoteEditor";
import "./SplitLeftPane.scss";

export type ContextTab = "log" | "facts" | "notes";
const TABS: { id: ContextTab; label: string; title: string }[] = [
  { id: "log", label: "Log", title: "Click an entry to add it as a step" },
  { id: "facts", label: "Facts", title: "The affected host's facts" },
  { id: "notes", label: "Notes", title: "Notes" },
];

/**
 * The split's left pane: the host's Log, Facts and Notes, live while the finding is written. Clicking a Log
 * row (or Enter on it) adds it as a step. With several affected hosts a switcher picks whose context shows;
 * with none, the engagement's Log and notes.
 */
export function SplitLeftPane({ eid, hosts, hostIds, preferredHostId, tab, onTab, steps, onPick }: {
  eid: string;
  hosts: Host[];
  /** The draft's affected hosts. */
  hostIds: string[];
  /** The host page the split was opened from. */
  preferredHostId: string | null;
  tab: ContextTab;
  onTab: (tab: ContextTab) => void;
  /** The draft's step entry ids, in order. */
  steps: string[];
  onPick: (entryId: string) => void;
}) {
  const log = useLog(eid);
  const [order] = useLogOrder("oldest", true);
  const [chosen, setChosen] = useState(preferredHostId);
  const [openEntry, setOpenEntry] = useState<string>();
  // The chosen host while it is still affected; else the first affected one; with none, the engagement.
  const activeId = chosen && hostIds.includes(chosen) ? chosen : (hostIds[0] ?? null);
  const active = hosts.find((h) => h.id === activeId);
  const affected = hostIds.flatMap((id) => hosts.find((h) => h.id === id) ?? []);
  const entries = (log.data ?? []).filter((e) => !activeId || e.hostIds.includes(activeId)).sort(byOrder(order));

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = usePanelFade<HTMLDivElement>(tab);
  useEffect(() => {
    if (tab === "notes") notesRef.current?.focus();
  }, [tab, activeId]);

  return (
    <div className={cx("split-left-pane", affected.length > 1 && "split-left-pane--switcher")}>
      {affected.length > 1 && (
        <ChipSet role="group" aria-label="Host">
          {affected.map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={h.id === activeId}
              title={hostLabel(h)}
              onClick={() => setChosen(h.id)}
              className="split-left-pane__host"
            >
              {shortHostName(hostLabel(h))}
            </button>
          ))}
        </ChipSet>
      )}
      <div role="tablist" aria-label="Finding context" className="split-left-pane__tabs">
        <TabMarker className={TAB_MARK} />
        {TABS.map((t) => {
          const disabled = t.id === "facts" && !active;
          return (
            // aria-disabled, not disabled: the tab stays focusable, so its reason shows from the keyboard too.
            <Tooltip key={t.id} content={disabled ? "Pick an affected host to see its facts" : <span>{t.title}{t.id === "notes" && <span className="tooltip__key">N</span>}</span>}>
              <button
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                aria-disabled={disabled || undefined}
                onClick={() => {
                  if (!disabled) onTab(t.id);
                }}
                className="split-left-pane__tab"
              >
                {t.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div
        ref={panelRef}
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === tab)!.label}
        className={`split-left-pane__panel ${SCROLL_PANE}`}
      >
        {tab === "log" ? (
          log.isError ? (
            queryState([log], "the log")
          ) : entries.length === 0 && log.data ? (
            <p className="split-left-pane__hint">Nothing logged {active ? "on this host" : "yet"}. Press L to capture.</p>
          ) : (
            <ul>
              {entries.map((e) => {
                const n = steps.indexOf(e.id);
                return (
                  <LogEntryRow
                    key={e.id}
                    entry={e}
                    hosts={hosts}
                    currentHostId={activeId ?? undefined}
                    defaultOpen={e.id === openEntry}
                    onPick={onPick}
                    stepNumber={n === -1 ? undefined : n + 1}
                  />
                );
              })}
            </ul>
          )
        ) : tab === "notes" ? (
          <NoteEditor
            key={activeId ?? ""}
            target={{ engagementId: eid, hostId: activeId }}
            textRef={notesRef}
            className="split-left-pane__notes"
          />
        ) : active ? (
          <FactsColumn
            engagementId={eid}
            host={active}
            variant="column"
            onOpenEntry={(id) => {
              setOpenEntry(id);
              onTab("log");
            }}
          />
        ) : (
          <p className="split-left-pane__hint">Pick an affected host to see its facts.</p>
        )}
      </div>
    </div>
  );
}
