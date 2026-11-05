import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { FillInput } from "../../engines/checklist";
import { engagementStuck, hostStuck, type StuckLine } from "../../engines/stuck";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { isDialogOpen } from "../../lib/keys";
import type { Host } from "../../types/host";
import { Kbd, labelClass } from "../../ui";
import { useCredFill } from "../checklist/credPick";
import { CommandList, type FilledCommand } from "../checklist/CommandList";
import { goalCommands } from "../checklist/goalCommands";
import { useChecklist, useEngagementServices, useTunnels } from "../checklist/queries";
import { useCredAttempts, useCredentials, useUsernames } from "../credentials/queries";
import { useHosts } from "../hosts/queries";
import { useLog } from "../log/queries";
import { useNote } from "../notes/queries";
import { noteKey, useNotesStore } from "../notes/useNotesStore";

const WIDTH = 440;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-line-2 pt-4 first:border-t-0 first:pt-0">
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
      skipRestoreRef={skipRestoreRef}
      onOpenGoal={(id) => {
        skipRestoreRef.current = true;
        onOpenGoal(id);
      }}
    />
  );
}

function Body({ engagementId, host, onOpenGoal, skipRestoreRef }: { engagementId: string; host: Host; onOpenGoal: (goalId: string) => void; skipRestoreRef: React.RefObject<boolean> }) {
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
  const failed =
    hostsQ.error ?? engagement.error ?? settings.error ?? servicesQ.error ?? log.error ?? note.error ?? credsQ.error ?? checklistQ.error ?? tunnelsQ.error;

  let content: React.ReactNode;
  if (failed) {
    content = <p role="alert" className="m-0 text-xs text-warn">Couldn't load this: {failed.message}</p>;
  } else if (!hosts || !eng || !settings.data || !servicesQ.data || !log.data || !credsQ.data || !checklistQ.data || !tunnelsQ.data) {
    content = <p className="m-0 text-xs text-muted">Loading…</p>;
  } else {
    const s = hostStuck({
      host, engagement: eng, hosts, servicesByHost, state: byOwner.get(host.id) ?? {},
      entries: log.data ?? [], hostNote: pending?.body ?? note.data?.body ?? "",
    });
    const input: FillInput = {
      host, engagement: eng, hosts, servicesByHost, tunnels,
      attackerIp: settings.data.attackerIp, listenerPort: settings.data.listenerPort, cred: creds.cred,
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
        <p className="m-0 text-xs text-fg-2">{s.phase === "after-foothold" ? "After a foothold" : "Before a foothold"}</p>
        {s.phase === "before-foothold" ? (
          <>
            {s.skipped.length > 0 && (
              <Section title="Skipped steps">
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {s.skipped.map((g) => (
                    <li key={g.goalId}>
                      <button type="button" onClick={() => onOpenGoal(g.goalId)} className="cursor-default text-left text-[13px] text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-1 focus-visible:outline-accent">
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
                  <div key={u.service.id} className="flex flex-col gap-1.5">
                    <p className="m-0 font-mono text-xs text-fg">
                      {u.service.port}/{u.service.protocol} {u.service.nmapService ?? ""}
                      <span className="ml-2 font-sans text-muted">{u.reason === "guess" ? "nmap is guessing" : "no version"}</span>
                    </p>
                    <CommandList commands={nudgeCommands(u.service.id, u.nudges)} />
                  </div>
                ))}
              </Section>
            )}
            {s.untouched.length > 0 && (
              <Section title="Never touched">
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {s.untouched.map((v) => (
                    <li key={v.id} className="font-mono text-xs text-fg-2">
                      {v.port}/{v.protocol} <span className="font-sans text-muted">{v.confirmedProduct ?? v.nmapService ?? ""}</span>
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
                  <div key={c.goalId} className="flex flex-col gap-1.5">
                    <p className="m-0 text-[13px] text-fg">{c.title}</p>
                    <CommandList commands={c.commands} />
                  </div>
                ))}
              </Section>
            )}
            {s.notes.trim() !== "" && (
              <Section title="Notes">
                <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-fg-2">{s.notes}</pre>
              </Section>
            )}
          </>
        )}
        {s.threads.length > 0 && (
          <Section title="Open threads">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {s.threads.map((t) => <li key={t.line} className="text-[13px] text-fg-2">{t.text}</li>)}
            </ul>
          </Section>
        )}
        {empty && <p className="m-0 text-xs text-muted">Nothing obvious left on this host</p>}
        {s.hints.map((h) => <p key={h} className="m-0 text-xs text-muted">{h}</p>)}
      </>
    );
  }

  return (
    <aside
      ref={root}
      tabIndex={-1}
      aria-label={title}
      style={{ width: WIDTH }}
      className="fixed inset-y-0 right-0 z-30 flex max-w-[70vw] flex-col border-l border-line-2 bg-surface text-fg-2 outline-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className={cx(labelClass, "m-0 truncate")}>{title}</h2>
        <Kbd aria-hidden>H</Kbd>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">{content}</div>
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
  const failed = queries.find((q) => q.error)?.error;
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
  if (failed) return <p role="alert" className="m-0 text-xs text-warn">Couldn't load the stuck check: {failed.message}</p>;
  if (!loaded || !hosts || !eng || !credentials || !attempts || !usernames) return null;

  const go = (l: StuckLine) => {
    if (l.hostId) void navigate(`/e/${engagementId}/h/${l.hostId}`, l.goalId ? { state: { goalId: l.goalId } } : undefined);
    else if (l.goalId) document.querySelector(`[data-goal-id="${l.goalId}"]`)?.scrollIntoView?.({ block: "center" });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-default items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-label text-muted hover:text-fg focus-visible:outline-1 focus-visible:outline-accent"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span>Stuck check</span>
        <span className="font-mono text-faint">{lines.length}</span>
      </button>
      {open &&
        (lines.length === 0 ? (
          <p className="m-0 text-xs text-muted">No leads: nothing obvious left.</p>
        ) : (
          AREAS.map(({ id, label }) => {
            const group = lines.filter((l) => l.area === id);
            if (group.length === 0) return null;
            return (
              <section key={id} aria-label={label} className="flex flex-col gap-1">
                <h4 className="m-0 text-xs text-fg-2">{label} <span className="font-mono text-faint">{group.length}</span></h4>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {group.map((l, i) => (
                    <li key={i}>
                      {l.hostId || l.goalId ? (
                        <button type="button" onClick={() => go(l)} className="cursor-default text-left text-[13px] text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-1 focus-visible:outline-accent">
                          {l.text}
                        </button>
                      ) : (
                        <span className="text-[13px] text-fg-2">{l.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        ))}
    </div>
  );
}
