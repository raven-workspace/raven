import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { credLabel, dedupeHashCaptures, foldCrackedHashes, usernameLabel } from "../../../../engines/credentials/index";
import { vectorsFromIdentity } from "../../../../engines/facts/index";
import type { HostIdentity } from "../../../../types/hostFacts";
import type { Host } from "../../../../types/host";
import { Button, ChipSet, IconButton, Input, Toolbar } from "../../../../ui/index";
import { useAccessGrants, useCredAttempts, useCredentials, useUsernames } from "../../../credentials/queries";
import { useLog } from "../../../log/queries";
import { useHostFactsMutations, useHostIdentity } from "../../queries";
import { EntryLink, FactGroup, SummaryCell } from "../FactGroup/FactGroup";
import { identityFromLog } from "../identityFromLog";
import { RavenError } from "../../../../types/errors";
import "./IdentityFacts.scss";

/** `MS01\iis`, `iis@corp` and `iis` are the same account name. */
export const bareName = (name: string) => (name.split("\\").pop() ?? name).split("@")[0].trim().toLowerCase();

const isNotablePriv = (p: string) => vectorsFromIdentity({ privileges: [p], groups: [] }).length > 0;
const isNotableGroup = (g: string) => vectorsFromIdentity({ privileges: [], groups: [g] }).length > 0;
const splitList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

function IdentityForm({ engagementId, host, identity, onDone }: {
  engagementId: string;
  host: Host;
  identity: HostIdentity | null;
  onDone: () => void;
}) {
  const { setIdentity, upsertVector } = useHostFactsMutations(engagementId, host.id);
  const [username, setUsername] = useState(identity?.username ?? "");
  const [privileges, setPrivileges] = useState(identity?.privileges.join(" ") ?? "");
  const [groups, setGroups] = useState(identity?.groups.join(" ") ?? "");
  const [error, setError] = useState<string>();
  const idBase = useId();
  const pending = setIdentity.isPending || upsertVector.isPending;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (username.trim() === "") return setError("Name the user");
    const next = { hostId: host.id, username: username.trim(), privileges: splitList(privileges), groups: splitList(groups), entryId: identity?.entryId ?? null };
    try {
      await setIdentity.mutateAsync(next);
      // Same as a captured whoami: a newly added notable privilege or group is a vector to try. Vectors from what was
      // already there keep the status the user gave them.
      const before = new Set(identity ? vectorsFromIdentity(identity) : []);
      for (const title of vectorsFromIdentity(next)) {
        if (!before.has(title)) await upsertVector.mutateAsync({ title, status: "try", source: "auto" });
      }
      onDone();
    } catch (err) {
      setError(RavenError.from(err).message);
    }
  };
  return (
    <form
      aria-label="Edit who am I"
      className="identity-form"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onDone();
      }}
    >
      <div className="identity-form__fields">
        <label htmlFor={`${idBase}-user`} className="identity-form__label">User</label>
        <Input id={`${idBase}-user`} autoFocus mono placeholder="e.g. corp\svc_web" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor={`${idBase}-privs`} className="identity-form__label">Privileges</label>
        <div className="identity-form__field">
          <Input id={`${idBase}-privs`} mono aria-describedby={`${idBase}-privs-hint`} placeholder="e.g. SeImpersonatePrivilege SeBackupPrivilege" value={privileges} onChange={(e) => setPrivileges(e.target.value)} />
          <p id={`${idBase}-privs-hint`} className="fact-group__note">Separate with spaces</p>
        </div>
        <label htmlFor={`${idBase}-groups`} className="identity-form__label">Groups</label>
        <div className="identity-form__field">
          <Input id={`${idBase}-groups`} mono aria-describedby={`${idBase}-groups-hint`} placeholder="e.g. docker sudo" value={groups} onChange={(e) => setGroups(e.target.value)} />
          <p id={`${idBase}-groups-hint`} className="fact-group__note">Separate with spaces</p>
        </div>
      </div>
      {error && <p role="alert" className="fact-group__error">{error}</p>}
      <Toolbar>
        <Button size="sm" variant="primary" type="submit" disabled={pending}>Save</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
      </Toolbar>
    </form>
  );
}

/** Who the user is on the host: the account, how access was gained, and its privileges (the notable ones in accent). */
export function IdentityFacts({ engagementId, host, open, onToggle, onOpenEntry }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
  onOpenEntry?: (entryId: string) => void;
}) {
  const identityQ = useHostIdentity(host.id);
  const grantsQ = useAccessGrants(engagementId);
  const usersQ = useUsernames(engagementId);
  const logQ = useLog(engagementId);
  const [editing, setEditing] = useState(false);
  const [readError, setReadError] = useState<string>();
  const { setIdentity, upsertVector } = useHostFactsMutations(engagementId, host.id);
  const identity = identityQ.data ?? null;
  const fromLog = useMemo(() => (logQ.data ? identityFromLog(logQ.data, host) : null), [logQ.data, host]);
  const readFromLog = async () => {
    // The button shows only while no identity is stored, so there is no stored name to keep; but not before it has loaded.
    if (!fromLog?.identity || setIdentity.isPending || identityQ.isPending) return;
    setReadError(undefined);
    const { username, privileges, groups, entryId } = fromLog.identity;
    try {
      // Same placeholder as capture: a log with only `whoami /priv` names no one.
      const name = username ?? "unknown";
      await setIdentity.mutateAsync({ hostId: host.id, username: name, privileges, groups, entryId });
      for (const title of vectorsFromIdentity({ privileges, groups })) {
        await upsertVector.mutateAsync({ title, status: "try", source: "auto" });
      }
    } catch (err) {
      setReadError(RavenError.from(err).message);
    }
  };

  // "How access was gained" is the matching access grant's via, never stored twice.
  const grant = identity
    ? (grantsQ.data ?? []).find((g) => {
        const u = usersQ.data?.find((x) => x.id === g.usernameId);
        return g.hostId === host.id && u !== undefined && bareName(usernameLabel(u)) === bareName(identity.username);
      })
    : undefined;
  const source = identity?.entryId ? logQ.data?.find((e) => e.id === identity.entryId) : undefined;
  const groups = identity?.groups.filter(isNotableGroup) ?? [];
  const otherGroups = (identity?.groups.length ?? 0) - groups.length;
  const summary = identityQ.isError ? (
    <span>couldn't load</span>
  ) : identityQ.isPending ? undefined : identity ? (
    <SummaryCell label="user">{identity.username}</SummaryCell>
  ) : (
    <span>not known yet</span>
  );

  return (
    <FactGroup
      title="Who am I"
      summary={summary}
      open={open}
      onToggle={onToggle}
      actions={
        !editing && <IconButton icon={PencilSimpleIcon} label="Edit who am I" onClick={() => setEditing(true)} />
      }
    >
      {/* Shown whatever the branch: identity can be saved and a vector upsert still fail. */}
      {readError && <p role="alert" className="fact-group__error">{readError}</p>}
      {identityQ.isError ? (
        <p role="alert" className="fact-group__error">Couldn't load who you are here: {identityQ.error.message}</p>
      ) : editing ? (
        <IdentityForm engagementId={engagementId} host={host} identity={identity} onDone={() => setEditing(false)} />
      ) : !identity ? (
        <div className="identity-facts__empty">
          <p className="fact-group__note">Not known yet. Log whoami /all or id output on this host.</p>
          {fromLog && fromLog.sources > 0 && (
            <div>
              <Button size="sm" onClick={() => void readFromLog()} disabled={setIdentity.isPending || upsertVector.isPending}>
                Read from log ({fromLog.sources} found)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <dl className="identity-facts__kv">
          <dt className="identity-facts__key">user</dt>
          <dd className="identity-facts__user" title={identity.username}>{identity.username}</dd>
          {grant && (
            <>
              <dt className="identity-facts__key">via</dt>
              <dd className="identity-facts__value identity-facts__value--text">{grant.via}</dd>
            </>
          )}
          {identity.privileges.length > 0 && (
            <>
              <dt className="identity-facts__key">privs</dt>
              <dd className="identity-facts__value">
                <ChipSet className="identity-facts__chips">
                  {identity.privileges.map((p) => (
                    <span key={p} className={isNotablePriv(p) ? "identity-facts__item--notable" : "identity-facts__item"}>{p}</span>
                  ))}
                </ChipSet>
              </dd>
            </>
          )}
          {identity.groups.length > 0 && (
            <>
              <dt className="identity-facts__key">groups</dt>
              <dd className="identity-facts__value">
                <ChipSet className="identity-facts__chips">
                  {groups.map((g) => <span key={g} className="identity-facts__item--notable">{g}</span>)}
                  {otherGroups > 0 && <span className="identity-facts__item">{groups.length > 0 ? `+${otherGroups} more` : `${otherGroups} group${otherGroups === 1 ? "" : "s"}`}</span>}
                </ChipSet>
              </dd>
            </>
          )}
          {source && (
            <>
              <dt className="identity-facts__key">from</dt>
              <dd className="identity-facts__value">
                <EntryLink title={source.title} onClick={() => onOpenEntry?.(source.id)} />
              </dd>
            </>
          )}
        </dl>
      )}
    </FactGroup>
  );
}

const OTHER_ACCOUNTS_SHOWN = 6;

/**
 * Accounts that might get further: hashes not cracked yet (captures deduplicated, cracked ones folded) and
 * credentials found on this host, never the account held here. At most six rows, then "+N more".
 */
export function OtherAccountsFacts({ engagementId, host, open, onToggle }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
}) {
  const credsQ = useCredentials(engagementId);
  const attemptsQ = useCredAttempts(engagementId);
  const identityQ = useHostIdentity(host.id);
  const ready = credsQ.data !== undefined && attemptsQ.data !== undefined && !identityQ.isPending;
  const rows = useMemo(() => {
    if (!credsQ.data || !attemptsQ.data) return [];
    const me = identityQ.data ? bareName(identityQ.data.username) : undefined;
    const shown = foldCrackedHashes(dedupeHashCaptures(credsQ.data), attemptsQ.data).creds;
    return shown
      .filter((c) => c.username.trim() === "" || bareName(c.username) !== me)
      .filter((c) =>
        c.type === "hash" ? c.crackStatus !== "cracked" && c.crackStatus !== "uncrackable" : c.sourceHostId === host.id,
      )
      .map((c) => ({ id: c.id, label: credLabel(c), kind: c.type === "hash" ? "uncracked" : "found here" }));
  }, [credsQ.data, attemptsQ.data, identityQ.data, host.id]);
  const failed = credsQ.error ?? attemptsQ.error;
  const summary = failed ? <span>couldn't load</span> : ready ? rows.length === 0 ? <span>none yet</span> : <SummaryCell count={rows.length} label={rows.length === 1 ? "account" : "accounts"} /> : undefined;
  const more = rows.length - OTHER_ACCOUNTS_SHOWN;
  return (
    <FactGroup title="Other accounts" summary={summary} open={open} onToggle={onToggle}>
      {failed ? (
        <p role="alert" className="fact-group__error">Couldn't load credentials: {failed.message}</p>
      ) : !ready ? null : rows.length === 0 ? (
        <p className="fact-group__note">None yet. Uncracked hashes and credentials found on this host show here.</p>
      ) : (
        <ul className="other-accounts">
          {rows.slice(0, OTHER_ACCOUNTS_SHOWN).map((r) => (
            <li key={r.id} className="other-accounts__row">
              <span className="other-accounts__label" title={r.label}>{r.label}</span>
              <span className="other-accounts__kind">{r.kind}</span>
            </li>
          ))}
          {more > 0 && <li className="other-accounts__more">+{more} more on the Credentials page</li>}
        </ul>
      )}
    </FactGroup>
  );
}
