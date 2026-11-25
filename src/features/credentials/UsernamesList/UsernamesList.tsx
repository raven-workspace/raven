import { useState, type FormEvent } from "react";
import { usernameLabel } from "../../../engines/credentials/index";
import type { AccessGrant, Username } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import { Trash } from "@phosphor-icons/react";
import { ActionCell, Button, IconButton, Input, labelClass, useFlash } from "../../../ui/index";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { AccessGrantDialog, AccessGrantTags } from "../AccessGrants/AccessGrants";
import { useAccessGrantMutations, useUsernameMutations } from "../queries";
import { copyPlain } from "../../../lib/clipboard";
import "./UsernamesList.scss";

/** `DOMAIN\user` splits at the first backslash; a bare name has no domain. */
export function parseUsername(raw: string): { username: string; domain: string | null } {
  const s = raw.trim();
  const i = s.indexOf("\\");
  if (i <= 0) return { username: s, domain: null };
  return { domain: s.slice(0, i).trim() || null, username: s.slice(i + 1).trim() };
}

export function UsernamesList({ eid, usernames, grants, hosts }: {
  eid: string;
  usernames: Username[];
  grants: AccessGrant[];
  hosts: Host[];
}) {
  const um = useUsernameMutations(eid);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<Username>();
  const [granting, setGranting] = useState<Username>();
  const [copied, flash] = useFlash(1500);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const p = parseUsername(draft);
    if (!p.username) return setError("Give it a username");
    setError(undefined);
    // The store returns the username it lists already when this is the same username.
    um.create.mutate(p, {
      onSuccess: (u) => (usernames.some((x) => x.id === u.id) ? setError(`${usernameLabel(p)} is already listed`) : setDraft("")),
      onError: (err) => setError(err.message),
    });
  };

  const copyAll = () => {
    const file = [...new Set(usernames.map((u) => u.username))].join("\n");
    void copyPlain(file).then(flash);
  };

  return (
    <section aria-label="Usernames" className="usernames-list">
      <header className="usernames-list__header">
        <h3 className={labelClass}>Usernames <span className="usernames-list__count">{usernames.length}</span></h3>
        {usernames.length > 0 && <Button size="sm" onClick={copyAll}>{copied ? "Copied" : "Copy all"}</Button>}
      </header>
      <form onSubmit={add} noValidate className="usernames-list__form">
        <Input mono aria-label="New username" aria-invalid={error ? true : undefined} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="DOMAIN\user" />
        <Button type="submit" disabled={um.create.isPending}>Add username</Button>
        {error && <p role="alert" className="usernames-list__error">{error}</p>}
      </form>
      <ul className="usernames-list__list">
        {usernames.map((u) => (
          <li key={u.id} className="usernames-list__row">
            <span className="usernames-list__name" title={usernameLabel(u)}>{usernameLabel(u)}</span>
            <div className="usernames-list__grants"><AccessGrantTags eid={eid} username={u} grants={grants.filter((g) => g.usernameId === u.id)} hosts={hosts} /></div>
            <ActionCell>
              <Button size="sm" aria-label={`Add access for ${usernameLabel(u)}`} onClick={() => setGranting(u)}>Add access</Button>
              <IconButton icon={Trash} tone="destructive" label={`Delete username ${usernameLabel(u)}`} onClick={() => setDeleting(u)} />
            </ActionCell>
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDelete
          title={`Delete username ${usernameLabel(deleting)}?`}
          detail="Its test results in the matrix and its access grants go with it."
          pending={um.remove.isPending}
          error={um.remove.error?.message}
          label="Delete username"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => um.remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
      {granting && <GrantDialog eid={eid} username={granting} hosts={hosts} onClose={() => setGranting(undefined)} />}
    </section>
  );
}

function GrantDialog({ eid, username, hosts, onClose }: { eid: string; username: Username; hosts: Host[]; onClose: () => void }) {
  const gm = useAccessGrantMutations(eid);
  return (
    <AccessGrantDialog
      title={`Add access for ${usernameLabel(username)}`}
      action="Add access"
      hosts={hosts}
      pending={gm.create.isPending}
      onClose={onClose}
      onSubmit={(grant, onError) => gm.create.mutate({ usernameId: username.id, grant }, { onSuccess: onClose, onError: (e) => onError(e.message) })}
    />
  );
}
