import { useState, type FormEvent } from "react";
import { usernameKey, usernameLabel } from "../../engines/credentials";
import type { AccessGrant, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import { Button, Dialog, Input, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { AccessFields, AccessGrantTags, EMPTY_ACCESS, type AccessDraft } from "./AccessGrants";
import { useAccessGrantMutations, useUsernameMutations } from "./queries";
import { copyPlain } from "../../lib/clipboard";

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
  const [copied, setCopied] = useState(false);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const p = parseUsername(draft);
    if (!p.username) return setError("Give it a username");
    if (usernames.some((u) => usernameKey(u) === usernameKey({ engagementId: eid, ...p }))) {
      return setError(`${usernameLabel(p)} is already listed`);
    }
    setError(undefined);
    um.create.mutate(p, {
      onSuccess: () => setDraft(""),
      onError: (err) => setError(err.message),
    });
  };

  const copyAll = () => {
    const file = [...new Set(usernames.map((u) => u.username))].join("\n");
    void copyPlain(file).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section aria-label="Usernames" className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className={`m-0 ${labelClass}`}>Usernames <span className="tabular-nums">{usernames.length}</span></h3>
        {usernames.length > 0 && <Button size="sm" onClick={copyAll}>{copied ? "Copied" : "Copy all"}</Button>}
      </header>
      <form onSubmit={add} noValidate className="flex items-start gap-2">
        <Input mono aria-label="New username" aria-invalid={error ? true : undefined} className="max-w-xs" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="DOMAIN\user" />
        <Button type="submit" disabled={um.create.isPending}>Add username</Button>
        {error && <p role="alert" className="m-0 self-center text-xs text-warn">{error}</p>}
      </form>
      <ul className="m-0 list-none border-t border-line p-0">
        {usernames.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5">
            <span className="font-mono text-[12.5px] text-fg">{usernameLabel(u)}</span>
            <AccessGrantTags eid={eid} username={u} grants={grants.filter((g) => g.usernameId === u.id)} hosts={hosts} />
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" aria-label={`Add access for ${usernameLabel(u)}`} onClick={() => setGranting(u)}>Add access</Button>
              <Button size="sm" variant="danger" aria-label={`Delete username ${usernameLabel(u)}`} onClick={() => setDeleting(u)}>Delete</Button>
            </span>
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
  const [draft, setDraft] = useState<AccessDraft>(EMPTY_ACCESS);
  const [errors, setErrors] = useState<{ hostId?: string; via?: string; form?: string }>({});
  const save = () => {
    const errs = {
      ...(draft.hostId === "" ? { hostId: "Choose a host" } : {}),
      ...(draft.via.trim() === "" ? { via: "Say how access was gained" } : {}),
    };
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    gm.create.mutate(
      { usernameId: username.id, grant: { hostId: draft.hostId, level: draft.level, via: draft.via.trim() } },
      { onSuccess: onClose, onError: (e) => setErrors({ form: e.message }) },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Add access for ${usernameLabel(username)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={gm.create.isPending} onClick={save}>Add access</Button>
        </>
      }
    >
      <AccessFields value={draft} onChange={setDraft} hosts={hosts} errors={errors} />
      {errors.form && <p role="alert" className="m-0 mt-2 text-xs text-warn">{errors.form}</p>}
    </Dialog>
  );
}
