import { PencilSimple } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { credLabel, usernameLabel } from "../../../engines/credentials";
import { vectorsFromIdentity } from "../../../engines/facts";
import { cx } from "../../../lib/cx";
import type { HostIdentity } from "../../../types/hostFacts";
import type { Host } from "../../../types/host";
import { Button, Chip, Input } from "../../../ui";
import { useAccessGrants, useCredentials, useUsernames } from "../../credentials/queries";
import { useLog } from "../../log/queries";
import { useHostFactsMutations, useHostIdentity } from "../queries";
import { FactGroup } from "./FactGroup";

/** `MS01\iis`, `iis@corp` and `iis` are the same account name. */
export const bareName = (name: string) => (name.split("\\").pop() ?? name).split("@")[0].trim().toLowerCase();

const isNotablePriv = (p: string) => vectorsFromIdentity({ privileges: [p], groups: [] }).length > 0;
const isNotableGroup = (g: string) => vectorsFromIdentity({ privileges: [], groups: [g] }).length > 0;
const splitList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

const KV = "grid grid-cols-[6ch_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13px]";

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
  const pending = setIdentity.isPending || upsertVector.isPending;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (username.trim() === "") return setError("Name the user");
    const next = { hostId: host.id, username: username.trim(), privileges: splitList(privileges), groups: splitList(groups), entryId: identity?.entryId ?? null };
    try {
      await setIdentity.mutateAsync(next);
      // Same as a captured whoami: a notable privilege or group is a vector to try.
      for (const title of vectorsFromIdentity(next)) await upsertVector.mutateAsync({ title, status: "try", source: "auto" });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form
      aria-label="Edit who am I"
      className="flex flex-col gap-2"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onDone();
      }}
    >
      <Input autoFocus mono aria-label="User" placeholder="ms01\iis_apppool" value={username} onChange={(e) => setUsername(e.target.value)} />
      <Input mono aria-label="Privileges" placeholder="SeImpersonatePrivilege …" value={privileges} onChange={(e) => setPrivileges(e.target.value)} />
      <Input mono aria-label="Groups" placeholder="docker sudo …" value={groups} onChange={(e) => setGroups(e.target.value)} />
      {error && <p role="alert" className="m-0 text-xs text-warn">{error}</p>}
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" type="submit" disabled={pending}>Save</Button>
        <Button size="sm" onClick={onDone}>Cancel</Button>
      </div>
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
  const identity = identityQ.data ?? null;

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
  const summary = identityQ.isError ? "Who am I · couldn't load" : `Who am I · ${identity?.username ?? "not known yet"}`;

  return (
    <FactGroup
      title="Who am I"
      summary={summary}
      open={open}
      onToggle={onToggle}
      actions={
        !editing && (
          <Button size="sm" aria-label="Edit who am I" title="Edit who am I" onClick={() => setEditing(true)} className="w-6 px-0!">
            <PencilSimple size={14} weight="light" aria-hidden />
          </Button>
        )
      }
    >
      {identityQ.isError ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load who you are here: {identityQ.error.message}</p>
      ) : editing ? (
        <IdentityForm engagementId={engagementId} host={host} identity={identity} onDone={() => setEditing(false)} />
      ) : !identity ? (
        <p className="m-0 text-xs text-muted">Not known yet. Log whoami /all or id output on this host.</p>
      ) : (
        <dl className={cx(KV, "m-0")}>
          <dt className="text-muted">user</dt>
          <dd className="m-0 min-w-0 truncate font-mono text-fg" title={identity.username}>{identity.username}</dd>
          {grant && (
            <>
              <dt className="text-muted">via</dt>
              <dd className="m-0 min-w-0 text-fg-2">{grant.via}</dd>
            </>
          )}
          {identity.privileges.length > 0 && (
            <>
              <dt className="text-muted">privs</dt>
              <dd className="m-0 flex min-w-0 flex-wrap gap-x-2 font-mono text-xs">
                {identity.privileges.map((p) => (
                  <span key={p} className={isNotablePriv(p) ? "text-accent" : "text-muted"}>{p}</span>
                ))}
              </dd>
            </>
          )}
          {identity.groups.length > 0 && (
            <>
              <dt className="text-muted">groups</dt>
              <dd className="m-0 flex min-w-0 flex-wrap gap-x-2 font-mono text-xs">
                {groups.map((g) => <span key={g} className="text-accent">{g}</span>)}
                {otherGroups > 0 && <span className="text-muted">{groups.length > 0 ? `+${otherGroups} more` : `${otherGroups} group${otherGroups === 1 ? "" : "s"}`}</span>}
              </dd>
            </>
          )}
          {source && (
            <>
              <dt className="text-muted">from</dt>
              <dd className="m-0 min-w-0">
                <button type="button" onClick={() => onOpenEntry?.(source.id)} className="max-w-full cursor-default" title={source.title}>
                  <Chip className="max-w-full hover:text-fg"><span className="truncate">↗ {source.title}</span></Chip>
                </button>
              </dd>
            </>
          )}
        </dl>
      )}
    </FactGroup>
  );
}

/** Accounts that might get further: hashes not cracked yet, and credentials for users other than the one held here. */
export function OtherAccountsFacts({ engagementId, host, open, onToggle }: {
  engagementId: string;
  host: Host;
  open: boolean;
  onToggle: () => void;
}) {
  const credsQ = useCredentials(engagementId);
  const identityQ = useHostIdentity(host.id);
  const me = identityQ.data ? bareName(identityQ.data.username) : undefined;
  const creds = credsQ.data ?? [];
  const hashes = creds.filter((c) => c.type === "hash" && c.crackStatus !== "cracked" && c.crackStatus !== "uncrackable");
  const others = creds.filter((c) => c.type !== "hash" && c.username.trim() !== "" && bareName(c.username) !== me);
  const rows = [
    ...hashes.map((c) => ({ id: c.id, label: credLabel(c), kind: "uncracked" })),
    ...others.map((c) => ({ id: c.id, label: credLabel(c), kind: c.type })),
  ];
  return (
    <FactGroup
      title="Other accounts"
      summary={credsQ.isError ? "Other accounts · couldn't load" : `Other accounts · ${rows.length}`}
      open={open}
      onToggle={onToggle}
    >
      {credsQ.isError ? (
        <p role="alert" className="m-0 text-xs text-warn">Couldn't load credentials: {credsQ.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-xs text-muted">None yet. Uncracked hashes and other users' credentials show here.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 p-0 text-[13px]">
          {rows.map((r) => (
            <li key={r.id} className="col-span-2 grid grid-cols-subgrid items-baseline">
              <span className="truncate font-mono text-fg" title={r.label}>{r.label}</span>
              <span className="text-xs text-muted">{r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </FactGroup>
  );
}
