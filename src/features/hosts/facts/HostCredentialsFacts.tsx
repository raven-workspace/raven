import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  cellFor,
  credLabel,
  dedupeHashCaptures,
  foldCrackedHashes,
  hostSprayServices,
  isSprayable,
  usernameLabel,
} from "../../../engines/credentials";
import type { AccessGrant, AccessLevel, CredAttempt, Credential, Username } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";
import { Button, Chip, Dialog, Field, Input, Select, labelClass } from "../../../ui";
import { ConfirmDelete } from "../../checklist/ConfirmDelete";
import { useEngagementServices } from "../../checklist/queries";
import { LEVEL_LABEL } from "../../credentials/AccessGrants";
import { useAccessGrantMutations, useAccessGrants, useCredAttempts, useCredentials, useUsernames } from "../../credentials/queries";
import { TestGrid } from "../../credentials/TestGrid";
import { useLog } from "../../log/queries";
import { EntryLink, FactGroup, SummaryCell } from "./FactGroup";

const LEVEL_OPTIONS = (Object.keys(LEVEL_LABEL) as AccessLevel[]).map((value) => ({ value, label: LEVEL_LABEL[value] }));
const WORKS = new Set<CredAttempt["result"]>(["admin", "valid"]);

/** What works on this host (results that got in, access without a secret) and how many credentials are still untried here. */
export function hostCredentialCounts(host: Host, services: Service[], creds: Credential[], attempts: CredAttempt[], grants: AccessGrant[]) {
  const here = attempts.filter((a) => a.hostId === host.id);
  const worked = here.filter((a) => WORKS.has(a.result));
  const working = new Set(worked.map((a) => `${a.credId}|${a.usernameId ?? ""}`));
  // A grant for a username that already has a working result here is the same access, so it counts once.
  const viaResult = new Set(worked.flatMap((a) => (a.usernameId ? [a.usernameId] : [])));
  const grantsHere = grants.filter((g) => g.hostId === host.id && !viaResult.has(g.usernameId));
  const spray = hostSprayServices(host, services);
  const untested = creds
    .filter(isSprayable)
    .filter((c) => spray.some((s) => cellFor(c, host, services, s, attempts).state === "untested")).length;
  return { works: working.size + grantsHere.length, untested };
}

/**
 * One host's credentials: every recorded result with its proof, its column of the test matrix (what's untried here)
 * and access without a secret. The full matrix stays in the engagement's Credentials section.
 */
export function HostCredentialsFacts({ engagementId: eid, host, open, onToggle, onOpenEntry }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
  onOpenEntry?: (entryId: string) => void;
}) {
  const credsQ = useCredentials(eid);
  const usersQ = useUsernames(eid);
  const grantsQ = useAccessGrants(eid);
  const attemptsQ = useCredAttempts(eid);
  const logQ = useLog(eid);
  const { servicesByHost, query: servicesQ } = useEngagementServices(eid);
  const creds = useMemo(() => credsQ.data ?? [], [credsQ.data]);
  const attempts = useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  const shown = useMemo(() => foldCrackedHashes(dedupeHashCaptures(creds), attempts), [creds, attempts]);
  const hosts = useMemo(() => [host], [host]);

  const failed = credsQ.error ?? usersQ.error ?? grantsQ.error ?? attemptsQ.error ?? servicesQ.error ?? logQ.error;
  const ready = credsQ.data && usersQ.data && grantsQ.data && attemptsQ.data && servicesQ.data && logQ.data;
  const counts = ready ? hostCredentialCounts(host, servicesByHost.get(host.id) ?? [], shown.creds, shown.attempts, grantsQ.data!) : undefined;
  const summary = failed ? (
    <span>couldn't load</span>
  ) : counts ? (
    <>
      <SummaryCell count={counts.works} label="working" tone={counts.works > 0 ? "accent" : undefined} />
      <SummaryCell count={counts.untested} label="untested" />
    </>
  ) : undefined;

  return (
    <FactGroup title="Host Credentials" summary={summary} open={open} onToggle={onToggle}>
      {failed ? (
        <p role="alert" className="m-0 text-meta text-warn">Couldn't load credentials: {failed.message}</p>
      ) : !ready ? null : (
        <div className="grid gap-6">
          <HostResults
            attempts={attempts.filter((a) => a.hostId === host.id)}
            creds={creds}
            usernames={usersQ.data!}
            titles={new Map(logQ.data!.map((e) => [e.id, e.title]))}
            onOpenEntry={onOpenEntry}
          />
          <TestGrid eid={eid} hosts={hosts} creds={shown.creds} attempts={shown.attempts} servicesByHost={servicesByHost} />
          <HostAccess eid={eid} host={host} usernames={usersQ.data!} grants={grantsQ.data!.filter((g) => g.hostId === host.id)} />
        </div>
      )}
    </FactGroup>
  );
}

function HostAccess({ eid, host, usernames, grants }: { eid: string; host: Host; usernames: Username[]; grants: AccessGrant[] }) {
  const { remove } = useAccessGrantMutations(eid);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AccessGrant>();
  const nameOf = (id: string) => {
    const u = usernames.find((x) => x.id === id);
    return u ? usernameLabel(u) : "removed username";
  };
  return (
    <section aria-label="Access without a secret" className="grid gap-2">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h3 className={`m-0 ${labelClass}`}>Access without a secret</h3>
        <Button size="sm" onClick={() => setAdding(true)} disabled={usernames.length === 0}>
          <PlusIcon size={16} weight="regular" aria-hidden /> Add access
        </Button>
      </header>
      {grants.length === 0 ? (
        <p className="m-0 text-meta text-muted">
          {usernames.length === 0 ? "No usernames yet. List one on the Credentials page first." : "None on this host."}
        </p>
      ) : (
        <ul className="m-0 list-none border-t border-line p-0">
          {grants.map((g) => (
            <li key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 border-b border-line py-2 text-meta">
              <span className="truncate font-mono text-fg" title={nameOf(g.usernameId)}>{nameOf(g.usernameId)}</span>
              <Chip variant="accent">{LEVEL_LABEL[g.level]}</Chip>
              <Button size="sm" aria-label={`Remove access as ${nameOf(g.usernameId)} on ${host.name}`} onClick={() => setRemoving(g)}>
                Remove
              </Button>
              {g.via && <span className="col-span-3 truncate text-muted" title={g.via}>via {g.via}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddHostAccess eid={eid} host={host} usernames={usernames} onClose={() => setAdding(false)} />}
      {removing && (
        <ConfirmDelete
          title={`Remove ${LEVEL_LABEL[removing.level]} access as ${nameOf(removing.usernameId)}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Remove access"
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => remove.mutate(removing.id, { onSuccess: () => setRemoving(undefined) })}
        />
      )}
    </section>
  );
}

function AddHostAccess({ eid, host, usernames, onClose }: { eid: string; host: Host; usernames: Username[]; onClose: () => void }) {
  const { create } = useAccessGrantMutations(eid);
  const [usernameId, setUsernameId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("user");
  const [via, setVia] = useState("");
  const [errors, setErrors] = useState<{ usernameId?: string; via?: string; form?: string }>({});
  const save = () => {
    const errs = {
      ...(usernameId === "" ? { usernameId: "Choose a username" } : {}),
      ...(via.trim() === "" ? { via: "Say how access was gained" } : {}),
    };
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    create.mutate(
      { usernameId, grant: { hostId: host.id, level, via: via.trim() } },
      { onSuccess: onClose, onError: (e) => setErrors({ form: e.message }) },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Add access on ${host.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending} onClick={save}>Add access</Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Username" error={errors.usernameId}>
          <Select
            placeholder="Pick a username"
            options={usernames.map((u) => ({ value: u.id, label: usernameLabel(u) }))}
            value={usernameId || undefined}
            onValueChange={setUsernameId}
          />
        </Field>
        <Field label="Access level">
          <Select options={LEVEL_OPTIONS} value={level} onValueChange={(v) => setLevel(v as AccessLevel)} />
        </Field>
        <Field label="Access via" error={errors.via}>
          <Input value={via} onChange={(e) => setVia(e.target.value)} placeholder="webshell" />
        </Field>
      </div>
      {errors.form && <p role="alert" className="m-0 mt-2 text-meta text-warn">{errors.form}</p>}
    </Dialog>
  );
}

/** The command of a log entry's title: what comes before a standalone separator, so the link reads "nxc smb". */
const commandName = (title: string) => title.split(/\s+[^\w\s]\s+/)[0];

/** Accent only for access that works; warn for errored. */
function ResultChip({ result }: { result: CredAttempt["result"] }) {
  const variant = WORKS.has(result) ? "accent" : result === "errored" ? "warn" : "default";
  return <Chip variant={variant} className="justify-self-end">{result}</Chip>;
}

/** Newest first; two lines per result so it fits the Facts column: who and the result, then where and the proof. */
function HostResults({ attempts, creds, usernames, titles, onOpenEntry }: {
  attempts: CredAttempt[];
  creds: Credential[];
  usernames: Username[];
  titles: Map<string, string>;
  onOpenEntry?: (entryId: string) => void;
}) {
  const subject = (a: CredAttempt) => {
    const c = creds.find((x) => x.id === a.credId);
    if (!a.usernameId) return c ? credLabel(c) : "removed credential";
    const u = usernames.find((x) => x.id === a.usernameId);
    // A bare username tried with another credential's secret.
    return `${u ? usernameLabel(u) : "removed username"} with ${c ? `${credLabel(c)}'s secret` : "a removed secret"}`;
  };
  const rows = [...attempts].sort((a, b) => b.at - a.at);
  return (
    <section aria-label="Results against this host" className="grid gap-2">
      <h3 className={`m-0 ${labelClass}`}>Results against this host</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-meta text-muted">Nothing tried here yet. Paste nxc output into Add to log to record results.</p>
      ) : (
        <ul className="m-0 list-none border-t border-line p-0">
          {rows.map((a) => {
            const title = a.logEntryId ? titles.get(a.logEntryId) : undefined;
            const who = subject(a);
            return (
              <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-line py-2">
                <span className="truncate font-mono text-code text-fg" title={who}>{who}</span>
                <ResultChip result={a.result} />
                <span className="grid min-w-0 auto-cols-[minmax(0,max-content)] grid-flow-col items-baseline justify-start gap-2 font-mono text-code text-muted">
                  <span className="text-fg-2">{a.service.toUpperCase()}{a.port ? ` ${a.port}` : ""}</span>
                  {a.authMode === "local" && <span>local</span>}
                  <span className="truncate" title={a.detail || undefined}>{a.detail}</span>
                </span>
                {a.logEntryId && title !== undefined ? (
                  <EntryLink title={title} label={commandName(title)} onClick={() => onOpenEntry?.(a.logEntryId!)} className="max-w-[20ch] justify-self-end" />
                ) : (
                  <span className="justify-self-end text-meta text-faint">{a.logEntryId ? "log entry removed" : "no proof"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
