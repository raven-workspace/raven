import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PIVOT_GOALS, type FillInput } from "../../engines/checklist";
import { engagementStuck, hostStuck, type StuckLine } from "../../engines/stuck";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { isDialogOpen } from "../../lib/keys";
import type { Host } from "../../types/host";
import { shortHostName } from "../../lib/hostName";
import { XIcon } from "@phosphor-icons/react";
import { BELOW_TITLE_BAR, Disclosure, HintLine, IconButton, LoadingState, labelClass, queryState, type Hint } from "../../ui";
import { useCredFill } from "../checklist/credPick";
import { CommandList, type FilledCommand } from "../checklist/CommandList";
import { goalCommands } from "../checklist/goalCommands";
import { useChecklist, useEngagementServices, useTunnels } from "../checklist/queries";
import { useCredAttempts, useCredentials, useUsernames } from "../credentials/queries";
import { sectionPath } from "../engagements/sections";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { useNote } from "../notes/queries";
import { noteKey, useNotesStore } from "../notes/useNotesStore";

const WIDTH = 440;
const HINTS: Hint[] = [
  { keys: "Esc", label: "close", priority: 1 },
  { keys: "H", label: "toggle", priority: 2 },
];
const PIVOT_IDS = new Set(PIVOT_GOALS.map((g) => g.id));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2 border-t border-line-2 pt-4 first:border-t-0 first:pt-0">
      <h3 className={cx(labelClass, "m-0")}>{title}</h3>
      {children}
    </section>
  );
}

const nudgeCommands = (prefix: string, nudges: { label: string; command: string }[]): FilledCommand[] =>
  nudges.map((n, i) => ({
    id: `${prefix}:${i}`, title: n.label, text: n.command, copyText: n.command, unresolved: [], msfMarker: false,
  }));

/**
 * Stuck view (`H`): a slide-over on the host view with what to try next, all on one screen. Open or closed is the
 * host view's state; Esc is caught in the capture phase, ahead of the shell's own Esc (which would leave the host).
 */
export function StuckView({
  engagementId,
  host,
  open,
  onClose,
  onOpenGoal,
}: {
  engagementId: string;
  host: Host;
  open: boolean;
  onClose: () => void;
  onOpenGoal: (goalId: string) => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [open]);

  // After a jump to a goal, the goal keeps the focus: closing must not hand it back to the opener.
  const skipRestoreRef = useRef(false);
  if (!open) return null;
  return (
    <Body
      engagementId={engagementId}
      host={host}
      onClose={onClose}
      skipRestoreRef={skipRestoreRef}
      onOpenGoal={(id) => {
        skipRestoreRef.current = true;
        onOpenGoal(id);
      }}
    />
  );
}

function Body({ engagementId, host, onClose, onOpenGoal, skipRestoreRef }: { engagementId: string; host: Host; onClose: () => void; onOpenGoal: (goalId: string) => void; skipRestoreRef: React.RefObject<boolean> }) {
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const log = useLog(engagementId);
  const { byOwner, query: checklistQ } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels, query: tunnelsQ } = useTunnels(engagementId);
  const note = useNote(engagementId, host.id);
  const pending = useNotesStore((s) => s.pending[noteKey({ engagementId, hostId: host.id })]);
  const creds = useCredFill(engagementId, host);
  const credsQ = useCredentials(engagementId);

  // Focus the panel on open and give focus back on close, like the notes panel.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const back = active instanceof HTMLElement && active !== document.body ? active : null;
    root.current?.focus();
    skipRestoreRef.current = false;
    return () => {
      if (!skipRestoreRef.current && back?.isConnected) back.focus();
    };
  }, [skipRestoreRef]);

  const hosts = hostsQ.data;
  const eng = engagement.data;
  const title = `Stuck on ${host.name}`;
  // Every query the body reads: a failed checklist would otherwise look like "nothing skipped", and failed tunnels
  // would quietly change the filled commands.
  const queries = [hostsQ, engagement, settings, servicesQ, log, note, credsQ, checklistQ, tunnelsQ];

  let content: React.ReactNode;
  if (queries.some((q) => q.error)) {
    content = queryState(queries, "this host");
  } else if (!hosts || !eng || !settings.data || !servicesQ.data || !log.data || !credsQ.data || !checklistQ.data || !tunnelsQ.data) {
    content = <LoadingState label="this host" />;
  } else {
    const s = hostStuck({
      host, engagement: eng, hosts, servicesByHost, state: byOwner.get(host.id) ?? {},
      entries: log.data ?? [], hostNote: pending?.body ?? note.data?.body ?? "",
    });
    const input: FillInput = {
      host, engagement: eng, hosts, servicesByHost, tunnels,
      attackerIp: settings.data.attackerIp, kaliUser: settings.data.kaliUser, listenerPort: settings.data.listenerPort, cred: creds.cred,
    };
    const filled = s.commands
      .map((c) => ({ ...c, commands: goalCommands(c.goalId, input, eng).commands }))
      .filter((c) => c.commands.length > 0);
    const after = s.phase === "after-foothold";
    const empty =
      s.hints.length === 0 &&
      s.threads.length === 0 &&
      (after
        ? filled.length === 0 && s.notes.trim() === ""
        : s.skipped.length + s.unidentified.length + s.untouched.length === 0);
    content = (
      <>
        <p className="m-0 text-meta text-fg-2">{s.phase === "after-foothold" ? "After a foothold" : "Before a foothold"}</p>
        {s.phase === "before-foothold" ? (
          <>
            {s.skipped.length > 0 && (
              <Section title="Skipped steps">
                <ul className="m-0 grid list-none gap-1 p-0">
                  {s.skipped.map((g) => (
                    <li key={g.goalId}>
                      <button type="button" onClick={() => onOpenGoal(g.goalId)} className="cursor-default text-left text-meta text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-1 focus-visible:outline-accent">
                        {g.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {s.unidentified.length > 0 && (
              <Section title="Unidentified services">
                {s.unidentified.map((u) => (
                  <div key={u.service.id} className="grid gap-2">
                    <p className="m-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 text-meta">
                      <span className="font-mono text-code text-fg">{u.service.port}/{u.service.protocol}</span>
                      <span className="truncate font-mono text-code text-fg" title={u.service.nmapService ?? undefined}>{u.service.nmapService ?? ""}</span>
                      <span className="text-muted">{u.reason === "guess" ? "nmap is guessing" : "no version"}</span>
                    </p>
                    <CommandList commands={nudgeCommands(u.service.id, u.nudges)} hostName={shortHostName(host.name)} />
                  </div>
                ))}
              </Section>
            )}
            {s.untouched.length > 0 && (
              <Section title="Never touched">
                <ul className="m-0 grid list-none gap-1 p-0">
                  {s.untouched.map((v) => (
                    <li key={v.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 text-meta">
                      <span className="font-mono text-code text-fg-2">{v.port}/{v.protocol}</span>
                      <span className="truncate text-muted" title={v.confirmedProduct ?? v.nmapService ?? undefined}>{v.confirmedProduct ?? v.nmapService ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        ) : (
          <>
            {filled.length > 0 && (
              <Section title="Commands to try">
                {filled.map((c) => (
                  <div key={c.goalId} className="grid gap-2">
                    <p className="m-0 text-meta text-fg">{c.title}</p>
                    <CommandList commands={c.commands} hostName={shortHostName(host.name)} />
                  </div>
                ))}
              </Section>
            )}
            {s.notes.trim() !== "" && (
              <Section title="Notes">
                <pre className="m-0 whitespace-pre-wrap font-mono text-code text-fg-2">{s.notes}</pre>
              </Section>
            )}
          </>
        )}
        {s.threads.length > 0 && (
          <Section title="Open threads">
            <ul className="m-0 grid list-none gap-1 p-0">
              {s.threads.map((t) => <li key={t.line} className="text-meta text-fg-2">{t.text}</li>)}
            </ul>
          </Section>
        )}
        {empty && <p className="m-0 text-meta text-muted">Nothing obvious left on this host</p>}
        {s.hints.map((h) => <p key={h} className="m-0 text-meta text-muted">{h}</p>)}
      </>
    );
  }

  return (
    <aside
      ref={root}
      tabIndex={-1}
      data-hint-surface
      aria-label={title}
      style={{ width: WIDTH }}
      className={`fixed ${BELOW_TITLE_BAR} right-0 z-30 grid max-w-[70vw] grid-rows-[auto_minmax(0,1fr)_auto] border-l border-line-2 bg-surface text-fg-2 outline-none`}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-2">
        <h2 className="m-0 truncate text-heading text-fg" title={title}>{title}</h2>
        <IconButton icon={XIcon} label="Close" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="grid min-h-0 content-start gap-4 overflow-y-auto px-4 py-3">{content}</div>
      <footer className="border-t border-line px-4 py-2">
        <HintLine hints={HINTS} ariaLabel="Stuck view shortcuts" />
      </footer>
    </aside>
  );
}

const AREAS: { id: StuckLine["area"]; label: string }[] = [
  { id: "foothold", label: "Foothold" },
  { id: "credentials", label: "Credentials" },
  { id: "privesc", label: "Privesc" },
  { id: "lateral", label: "Lateral" },
];

/** Engagement-wide leads, collapsed until opened. Each line opens its host, or scrolls to its engagement goal. */
export function EngagementStuckCheck({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const hostsQ = useHosts(engagementId);
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId) });
  const { byOwner, query: checklistQ } = useChecklist(engagementId);
  const { servicesByHost, query: servicesQ } = useEngagementServices(engagementId);
  const { tunnels, query: tunnelsQ } = useTunnels(engagementId);
  const credentialsQ = useCredentials(engagementId);
  const attemptsQ = useCredAttempts(engagementId);
  const usernamesQ = useUsernames(engagementId);

  // Leads from half-loaded data would be wrong (an unloaded checklist reads as "nothing done"), so wait for all of it.
  const queries = [hostsQ, engagement, servicesQ, checklistQ, tunnelsQ, credentialsQ, attemptsQ, usernamesQ];
  // Failed or still loading: say so (never a blank pane while the stuck check waits for its data).
  const state = queryState(queries, "the stuck check");
  const hosts = hostsQ.data;
  const eng = engagement.data;
  const credentials = credentialsQ.data;
  const attempts = attemptsQ.data;
  const usernames = usernamesQ.data;
  const loaded = !!servicesQ.data && !!checklistQ.data && !!tunnelsQ.data;
  // Recomputed only when the data changes, not on every open/close of the panel.
  const lines = useMemo(
    () =>
      loaded && hosts && eng && credentials && attempts && usernames
        ? engagementStuck({ engagement: eng, hosts, servicesByHost, byOwner, credentials, attempts, usernames, tunnels })
        : [],
    [loaded, eng, hosts, servicesByHost, byOwner, credentials, attempts, usernames, tunnels],
  );
  if (state) return state;
  if (!loaded || !hosts || !eng || !credentials || !attempts || !usernames) return <LoadingState label="the stuck check" />;

  const go = (l: StuckLine) => {
    // Pivot leads (dual-homed, no tunnel) are answered in Network, with that host focused.
    if (l.hostId && l.goalId && PIVOT_IDS.has(l.goalId)) void navigate(sectionPath(engagementId, "network"), { state: { hostId: l.hostId } });
    else if (l.hostId) void navigate(`/e/${engagementId}/h/${l.hostId}`, l.goalId ? { state: { goalId: l.goalId } } : undefined);
    else if (l.goalId) document.querySelector(`[data-goal-id="${l.goalId}"]`)?.scrollIntoView?.({ block: "center" });
  };

  return (
    <div className="grid gap-2">
      <Disclosure label="Stuck check" count={lines.length} open={open} onOpenChange={setOpen}>
        {lines.length === 0 ? (
          <p className="m-0 px-1 py-2 text-meta text-muted">No leads: nothing obvious left.</p>
        ) : (
          <div className="grid gap-3 px-1 py-2">
            {AREAS.map(({ id, label }) => {
              const group = lines.filter((l) => l.area === id);
              if (group.length === 0) return null;
              return (
                <section key={id} aria-label={label} className="grid gap-1">
                  <h4 className="m-0 px-1 text-meta text-fg-2">{label} <span className="font-mono text-code text-faint">{group.length}</span></h4>
                  <ul className="m-0 grid list-none p-0">
                    {group.map((l, i) => {
                      // The subject (host or credential) and its state are two elements, never one dashed string.
                      const parts = (
                        <>
                          {l.subject !== null && (
                            <>
                              <span className="max-w-[24ch] truncate text-fg" title={l.subject}>{l.subject}</span>{" "}
                            </>
                          )}
                          <span className={l.subject !== null ? undefined : "col-span-2"}>{l.text}</span>
                        </>
                      );
                      // A selectable list row (DESIGN.md: no grey text links for actions), at least 28px tall.
                      const cols = "grid min-h-7 w-full grid-cols-[auto_minmax(0,1fr)] content-center items-baseline gap-2 rounded-sm px-1 py-1 text-left text-meta text-fg-2";
                      return (
                        <li key={i}>
                          {l.hostId || l.goalId ? (
                            <button type="button" onClick={() => go(l)} className={`${cols} cursor-default hover:bg-surface-hi hover:text-fg`}>
                              {parts}
                            </button>
                          ) : (
                            <span className={cols}>{parts}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Disclosure>
    </div>
  );
}
