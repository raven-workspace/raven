import { useEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";
import { ChipSet } from "../../ui";
import { SCROLL_PANE } from "../../ui/controlStyles";
import { TAB_MARK } from "../../ui/shadcn/tabs";
import { TabMarker, usePanelFade } from "../../ui/TabMarker";
import type { Host } from "../../types/host";
import { shortHostName } from "../../lib/hostName";
import { hostLabel } from "../credentials/AccessGrants";
import { FactsColumn } from "../hosts/facts/FactsColumn";
import { LogEntryRow } from "../log/LogEntryRow";
import { useLog } from "../log/queries";
import { byOrder, useLogOrder } from "../log/useLogOrder";
import { NoteEditor } from "../notes/NoteEditor";

export type ContextTab = "log" | "facts" | "notes";
const TABS: { id: ContextTab; label: string; title: string }[] = [
  { id: "log", label: "Log", title: "Log: click an entry to add it as a step" },
  { id: "facts", label: "Facts", title: "Facts" },
  { id: "notes", label: "Notes", title: "Notes (N)" },
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
    <div className={cx("grid min-h-0 gap-3", affected.length > 1 ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]")}>
      {affected.length > 1 && (
        <ChipSet role="group" aria-label="Host">
          {affected.map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={h.id === activeId}
              title={hostLabel(h)}
              onClick={() => setChosen(h.id)}
              className={cx(
                "inline-grid h-7 cursor-default items-center rounded-sm border px-2 text-meta",
                h.id === activeId ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:text-fg",
              )}
            >
              {shortHostName(hostLabel(h))}
            </button>
          ))}
        </ChipSet>
      )}
      <div role="tablist" aria-label="Finding context" className="relative isolate grid grid-flow-col auto-cols-max justify-start gap-2">
        <TabMarker className={TAB_MARK} />
        {TABS.map((t) => {
          const disabled = t.id === "facts" && !active;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              disabled={disabled}
              title={disabled ? "Pick an affected host to see its facts" : t.title}
              onClick={() => onTab(t.id)}
              className={cx(
                "h-7 cursor-default rounded-[var(--radius-sm)] px-3 text-body disabled:opacity-40",
                tab === t.id ? "font-semibold text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        ref={panelRef}
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === tab)!.label}
        className={`@container/ctx grid grid-rows-[minmax(min-content,1fr)] border-t border-line ${SCROLL_PANE}`}
      >
        {tab === "log" ? (
          log.isError ? (
            <p role="alert" className="text-meta text-warn">Couldn't load the log: {log.error.message}</p>
          ) : entries.length === 0 && log.data ? (
            <p className="text-meta text-muted">Nothing logged {active ? "on this host" : "yet"}. Press L to capture.</p>
          ) : (
            <ul className="m-0 list-none p-0">
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
          <NoteEditor key={activeId ?? ""} target={{ engagementId: eid, hostId: activeId }} textRef={notesRef} className="min-h-[16rem] py-2" />
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
          <p className="text-meta text-muted">Pick an affected host to see its facts.</p>
        )}
      </div>
    </div>
  );
}
