import { ArrowDown, ArrowUp, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../../../types/log";
import { ActionCell, Button, Collapse, IconButton, Input, Toggle, fieldLabelClass } from "../../../ui/index";
import { SCROLL_PANE } from "../../../ui/controlStyles";
import { KIND_LABELS } from "../../log/kindLabels";
import { LogEntryBody } from "../../log/LogEntryBody/LogEntryBody";
import { useLog } from "../../log/queries";
import { clockTime } from "../../engagements/format";
import "./FindingSteps.scss";


/** The ids that still name a log entry; with no log loaded yet, all of them. */
export function liveSteps(ids: string[], entries: LogEntry[] | undefined): string[] {
  if (!entries) return ids;
  const known = new Set(entries.map((e) => e.id));
  return ids.filter((id) => known.has(id));
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Ordered reproduction steps: log entries to add, reorder, expand and remove. */
export function FindingSteps({ eid, hostIds, value, onChange }: {
  eid: string;
  /** The finding's hosts: the picker starts filtered to their entries. */
  hostIds: string[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const log = useLog(eid);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [allHosts, setAllHosts] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const refocus = useRef<string>(undefined);
  const listRef = useRef<HTMLOListElement>(null);

  const byId = useMemo(() => new Map((log.data ?? []).map((e) => [e.id, e])), [log.data]);
  const steps = liveSteps(value, log.data).flatMap((id) => byId.get(id) ?? []);

  useEffect(() => {
    if (!refocus.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-step="${refocus.current}"] [data-expand]`)?.focus();
    refocus.current = undefined;
  });

  const ids = steps.map((s) => s.id);
  const reorder = (id: string, delta: number) => {
    const i = ids.indexOf(id);
    if (i < 0 || i + delta < 0 || i + delta >= ids.length) return;
    onChange(move(ids, i, i + delta));
    refocus.current = id;
  };
  const toggleOpen = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const q = query.trim().toLowerCase();
  const filterHosts = hostIds.length > 0 && !allHosts;
  const candidates = (log.data ?? [])
    .filter((e) => !ids.includes(e.id))
    .filter((e) => !filterHosts || e.hostIds.some((h) => hostIds.includes(h)))
    .filter((e) => q === "" || e.title.toLowerCase().includes(q) || KIND_LABELS[e.kind].toLowerCase().includes(q))
    .sort((a, b) => a.at - b.at);

  return (
    <div role="group" aria-label="Reproduction steps section" className="finding-steps">
      <div className="finding-steps__bar">
        <span className={fieldLabelClass}>Reproduction steps</span>
        <Button size="sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          {picking ? "Done adding" : "Add step"}
        </Button>
      </div>

      {steps.length === 0 && value.length > 0 && log.isError ? (
        <p role="alert" className="finding-steps__error">Couldn't load the log, so the steps can't be shown: {log.error.message}</p>
      ) : steps.length === 0 && value.length > 0 && !log.data ? (
        <p className="finding-steps__hint">Loading the log…</p>
      ) : steps.length === 0 ? (
        <p className="finding-steps__hint">No steps yet. Add the log entries that reproduce this finding, in order.</p>
      ) : (
        <ol ref={listRef} aria-label="Reproduction steps" className="finding-steps__list">
          {steps.map((s, i) => {
            const open = expanded.has(s.id);
            return (
              <li
                key={s.id}
                data-step={s.id}
                className="finding-steps__step"
              >
                <span className="finding-steps__number">{i + 1}</span>
                <span
                  className="finding-steps__kind"
                  title={KIND_LABELS[s.kind]}
                >
                  {KIND_LABELS[s.kind]}
                </span>
                <button
                  type="button"
                  data-expand
                  aria-expanded={open}
                  onClick={() => toggleOpen(s.id)}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                      e.preventDefault();
                      reorder(s.id, e.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                  title={s.title}
                  className="finding-steps__title"
                >
                  <span data-testid="step-title">{s.title}</span>
                </button>
                <time
                  dateTime={new Date(s.at).toISOString()}
                  className="finding-steps__time"
                >
                  {clockTime(s.at)}
                </time>
                <div className="finding-steps__actions">
                  <ActionCell>
                    <IconButton icon={ArrowUp} label={`Move up ${s.title}`} disabled={i === 0} onClick={() => reorder(s.id, -1)} />
                    <IconButton icon={ArrowDown} label={`Move down ${s.title}`} disabled={i === steps.length - 1} onClick={() => reorder(s.id, 1)} />
                    <IconButton icon={X} tone="destructive" label={`Remove step ${s.title}`} onClick={() => onChange(ids.filter((x) => x !== s.id))} />
                  </ActionCell>
                </div>
                <Collapse open={open} className="finding-steps__body" contentClassName="finding-steps__body-content"><LogEntryBody entry={s} /></Collapse>
              </li>
            );
          })}
        </ol>
      )}

      {picking && (
        <div className="finding-steps__picker">
          <div className="finding-steps__bar">
            <Input aria-label="Search log" placeholder="Search the log" value={query} onChange={(e) => setQuery(e.target.value)} />
            {hostIds.length > 0 && <Toggle on={allHosts} onChange={setAllHosts}>All hosts</Toggle>}
          </div>
          {log.isError ? (
            <p role="alert" className="finding-steps__error">Couldn't load the log: {log.error.message}</p>
          ) : candidates.length === 0 ? (
            <p className="finding-steps__hint">{log.data ? "No matching entries." : "Loading the log."}</p>
          ) : (
            <ul className={`finding-steps__candidates ${SCROLL_PANE}`}>
              {candidates.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    aria-label={`Add ${e.title}`}
                    onClick={() => onChange([...ids, e.id])}
                    className="finding-steps__candidate"
                  >
                    <span className="finding-steps__candidate-time">{clockTime(e.at)}</span>
                    <span className="finding-steps__candidate-kind">{KIND_LABELS[e.kind]}</span>
                    <span className="finding-steps__candidate-title" title={e.title}>{e.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
