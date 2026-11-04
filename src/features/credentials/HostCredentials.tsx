import { useMemo, useState } from "react";
import { credLabel, dedupeHashCaptures, foldCrackedHashes, usernameLabel } from "../../engines/credentials";
import type { AccessGrant, AccessLevel, CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import { Button, Chip, Dialog, Field, Input, Select, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useEngagementServices } from "../checklist/queries";
import { useLog } from "../log/queries";
import { LEVEL_LABEL } from "./AccessGrants";
import { useAccessGrantMutations, useAccessGrants, useCredAttempts, useCredentials, useUsernames } from "./queries";
import { TestGrid } from "./TestGrid";

const LEVEL_OPTIONS = (Object.keys(LEVEL_LABEL) as AccessLevel[]).map((value) => ({ value, label: LEVEL_LABEL[value] }));

/** One host's credentials: its matrix column, access without a secret, and every recorded result with its proof. */
export function HostCredentials({ engagementId: eid, host, onOpenEntry }: {
  engagementId: string;
  host: Host;
  onOpenEntry: (entryId: string) => void;
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
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load credentials: {failed.message}</p>;
  if (!credsQ.data || !usersQ.data || !grantsQ.data || !attemptsQ.data || !servicesQ.data || !logQ.data) return null;

  const titles = new Map(logQ.data.map((e) => [e.id, e.title]));
  return (
    <div className="flex flex-col gap-6 py-3">
      <TestGrid eid={eid} hosts={hosts} creds={shown.creds} attempts={shown.attempts} servicesByHost={servicesByHost} />
      <HostAccess eid={eid} host={host} usernames={usersQ.data} grants={grantsQ.data.filter((g) => g.hostId === host.id)} />
      <HostResults
        attempts={attempts.filter((a) => a.hostId === host.id)}
        creds={creds}
        usernames={usersQ.data}
        titles={titles}
        onOpenEntry={onOpenEntry}
      />
    </div>
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
    <section aria-label="Access without a secret" className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className={`m-0 ${labelClass}`}>Access without a secret</h3>
        <Button size="sm" onClick={() => setAdding(true)} disabled={usernames.length === 0}>Add access</Button>
      </header>
      {grants.length === 0 ? (
        <p className="m-0 text-xs text-muted">
          {usernames.length === 0 ? "No usernames yet. List one on the Credentials page first." : "None on this host."}
        </p>
      ) : (
        <ul className="m-0 list-none border-t border-line p-0">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center gap-2 border-b border-line py-1.5 text-[13px]">
              <span className="font-mono text-fg">{nameOf(g.usernameId)}</span>
              <Chip variant="accent">{LEVEL_LABEL[g.level]}{g.via && ` · via ${g.via}`}</Chip>
              <Button
                size="sm"
                className="ml-auto"
                aria-label={`Remove access as ${nameOf(g.usernameId)} on ${host.name}`}
                onClick={() => setRemoving(g)}
              >
                Remove
              </Button>
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
      {errors.form && <p role="alert" className="m-0 mt-2 text-xs text-warn">{errors.form}</p>}
    </Dialog>
  );
}

/** Accent only for access that works; warn for errored. */
function ResultChip({ result }: { result: CredAttempt["result"] }) {
  const accent = result === "admin" || result === "valid";
  return (
    <Chip variant={accent ? "accent" : "default"} className={result === "errored" ? "border-warn text-warn" : undefined}>
      {result}
    </Chip>
  );
}

function HostResults({ attempts, creds, usernames, titles, onOpenEntry }: {
  attempts: CredAttempt[];
  creds: Credential[];
  usernames: Username[];
  titles: Map<string, string>;
  onOpenEntry: (entryId: string) => void;
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
    <section aria-label="Results against this host" className="flex flex-col gap-2">
      <h3 className={`m-0 ${labelClass}`}>Results against this host</h3>
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-muted">Nothing tried here yet. Paste nxc output into Add to log to record results.</p>
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-label text-muted">
              {["Credential", "Service", "Result", "Detail", "Proof"].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const title = a.logEntryId ? titles.get(a.logEntryId) : undefined;
              return (
                <tr key={a.id} className="border-b border-line align-top">
                  <td className="px-2 py-1.5 font-mono text-[12.5px] text-fg">{subject(a)}</td>
                  <td className="px-2 py-1.5 font-mono text-xs text-fg-2">
                    {a.service.toUpperCase()}{a.port ? ` ${a.port}` : ""}{a.authMode === "local" ? " · local" : ""}
                  </td>
                  <td className="px-2 py-1.5"><ResultChip result={a.result} /></td>
                  <td className="px-2 py-1.5 font-mono text-xs text-muted">{a.detail ?? ""}</td>
                  <td className="px-2 py-1.5">
                    {a.logEntryId && title !== undefined ? (
                      <button type="button" onClick={() => onOpenEntry(a.logEntryId!)} className="cursor-default">
                        <Chip className="hover:text-fg">↗ {title}</Chip>
                      </button>
                    ) : (
                      <span className="text-xs text-faint">{a.logEntryId ? "log entry removed" : "no proof"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
