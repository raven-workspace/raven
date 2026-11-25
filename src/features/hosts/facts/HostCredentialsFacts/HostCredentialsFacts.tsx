import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  cellFor,
  credLabel,
  dedupeHashCaptures,
  foldCrackedHashes,
  hostSprayServices,
  isReuseAttempt,
  isSprayable,
  PASSWORD_REUSE_DETAIL,
  usernameLabel,
} from "../../../../engines/credentials/index";
import type { AccessGrant, AccessLevel, CredAttempt, Credential, Username } from "../../../../types/credentials";
import type { Host } from "../../../../types/host";
import type { Service } from "../../../../types/service";
import { Button, Chip, Dialog, Field, Input, Select, labelClass, queryState } from "../../../../ui/index";
import { ConfirmDelete } from "../../../checklist/ConfirmDelete/ConfirmDelete";
import { useEngagementServices } from "../../../services/queries";
import { LEVEL_LABEL, LEVEL_OPTIONS } from "../../../credentials/AccessGrants/AccessGrants";
import { useAccessGrantMutations, useAccessGrants, useCredAttempts, useCredentials, useUsernames } from "../../../credentials/queries";
import { TestGrid } from "../../../credentials/TestGrid/TestGrid";
import { useLog } from "../../../log/queries";
import { EntryLink, FactGroup, SummaryCell } from "../FactGroup/FactGroup";
import "./HostCredentialsFacts.scss";

const WORKS = new Set<CredAttempt["result"]>(["admin", "valid"]);

/** What works on this host (results that got in, access without a secret) and how many credentials are still untried here. */
export function hostCredentialCounts(host: Host, services: Service[], creds: Credential[], attempts: CredAttempt[], grants: AccessGrant[]) {
  const here = attempts.filter((a) => a.hostId === host.id);
  const worked = here.filter((a) => WORKS.has(a.result));
  const working = new Set(worked.map((a) => `${a.credId}|${a.usernameId ?? ""}`));
  // A grant for a username that already has a working result here is the same access, so it counts once.
  const viaResult = new Set(worked.flatMap((a) => (a.usernameId ? [a.usernameId] : [])));
  // Deduped by usernameId on purpose: one access per user, however it was shown.
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
        queryState([credsQ, usersQ, grantsQ, attemptsQ, servicesQ, logQ], "credentials")
      ) : !ready ? null : (
        <div className="host-creds">
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
    <section aria-label="Access without a secret" className="host-creds__section">
      <header className="host-creds__section-head">
        <h3 className={labelClass}>Access without a secret</h3>
        <Button size="sm" onClick={() => setAdding(true)} disabled={usernames.length === 0}>
          <PlusIcon size={16} weight="regular" aria-hidden /> Add access
        </Button>
      </header>
      {grants.length === 0 ? (
        <p className="fact-group__note">
          {usernames.length === 0 ? "No usernames yet. List one on the Credentials page first." : "None on this host."}
        </p>
      ) : (
        <ul className="host-creds__list">
          {grants.map((g) => (
            <li key={g.id} className="host-creds__grant">
              <span className="host-creds__name" title={nameOf(g.usernameId)}>{nameOf(g.usernameId)}</span>
              <Chip variant="accent">{LEVEL_LABEL[g.level]}</Chip>
              <Button size="sm" aria-label={`Remove access as ${nameOf(g.usernameId)} on ${host.name}`} onClick={() => setRemoving(g)}>
                Remove
              </Button>
              {g.via && <span className="host-creds__via" title={g.via}>via {g.via}</span>}
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
      <div className="host-creds__dialog-fields">
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
      {errors.form && <p role="alert" className="host-creds__dialog-error">{errors.form}</p>}
    </Dialog>
  );
}

/** The command of a log entry's title: what comes before a standalone separator, so the link reads "nxc smb". */
const commandName = (title: string) => title.split(/\s+[^\w\s]\s+/)[0];

/** Accent only for access that works; warn for errored. */
function ResultChip({ result }: { result: CredAttempt["result"] }) {
  const variant = WORKS.has(result) ? "accent" : result === "errored" ? "warn" : "default";
  return <Chip variant={variant} className="host-creds__result">{result}</Chip>;
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
    <section aria-label="Results against this host" className="host-creds__section">
      <h3 className={labelClass}>Results against this host</h3>
      {rows.length === 0 ? (
        <p className="fact-group__note">Nothing tried here yet. Paste nxc output into Add to log to record results.</p>
      ) : (
        <ul className="host-creds__list">
          {rows.map((a) => {
            const title = a.logEntryId ? titles.get(a.logEntryId) : undefined;
            const who = subject(a);
            return (
              <li key={a.id} className="host-creds__attempt">
                <span className="host-creds__who" title={who}>{who}</span>
                <ResultChip result={a.result} />
                {isReuseAttempt(a) ? (
                  // Password reuse is no service result: no service, just what it is.
                  <span className="host-creds__where">
                    <span className="host-creds__detail">{PASSWORD_REUSE_DETAIL}</span>
                  </span>
                ) : (
                  <span className="host-creds__where">
                    <span className="host-creds__service">{a.service.toUpperCase()}{a.port ? ` ${a.port}` : ""}</span>
                    {a.authMode === "local" && <span>local</span>}
                    <span className="host-creds__detail" title={a.detail || undefined}>{a.detail}</span>
                  </span>
                )}
                {a.logEntryId && title !== undefined ? (
                  <EntryLink title={title} label={commandName(title)} onClick={() => onOpenEntry?.(a.logEntryId!)} className="host-creds__proof" />
                ) : (
                  <span className="host-creds__no-proof">{a.logEntryId ? "log entry removed" : "no proof"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
