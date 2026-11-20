import { useId, useState, type FormEvent } from "react";
import {
  credLabel,
  findDuplicateCredential,
  identifyHash,
  defaultHashType,
  parseCredentialPaste,
  usernameKey,
} from "../../engines/credentials";
import type { Credential, CredentialInput, CredentialScope, CredentialType } from "../../types/credentials";
import type { Host } from "../../types/host";
import { Button, ChipSet, Dialog, Field, Input, Select, Textarea, Toggle, labelClass } from "../../ui";
import { AccessFields, EMPTY_ACCESS, hostLabel, type AccessDraft } from "./AccessGrants";
import { useAccessGrantMutations, useCredentialMutations, useUsernameMutations, useUsernames } from "./queries";
import { parseUsername } from "./UsernamesList";
import { RavenError } from "../../types/errors";

type Mode = "credential" | "secret" | "username";
const MODES: { id: Mode; label: string }[] = [
  { id: "credential", label: "A credential" },
  { id: "secret", label: "A secret, owner unknown" },
  { id: "username", label: "A username with access" },
];
const TYPES: CredentialType[] = ["password", "hash", "ticket", "key", "token", "other"];
const SCOPES: { value: CredentialScope; label: string }[] = [
  { value: "domain", label: "Domain" },
  { value: "local", label: "Local" },
  { value: "app", label: "App" },
];

type Errors = Partial<Record<"username" | "secret" | "localHostId" | "hostId" | "via" | "form", string>>;

export function CredentialForm({ eid, hosts, credentials, edit, onClose, onSaved }: {
  eid: string;
  hosts: Host[];
  credentials: Credential[];
  /** Edit this credential; add when absent. */
  edit?: Credential;
  onClose: () => void;
  /** Called with the credential the form created or updated, just before it closes. */
  onSaved?: (cred: Credential) => void;
}) {
  const formId = useId();
  const cm = useCredentialMutations(eid);
  const um = useUsernameMutations(eid);
  const gm = useAccessGrantMutations(eid);
  const usernames = useUsernames(eid).data ?? [];
  const [mode, setMode] = useState<Mode>(edit && !edit.username ? "secret" : "credential");
  const [username, setUsername] = useState(edit?.username ?? "");
  const [domain, setDomain] = useState(edit?.domain ?? "");
  const [type, setType] = useState<CredentialType>(edit?.type ?? "password");
  const [secret, setSecret] = useState(edit?.secret ?? "");
  const [hashType, setHashType] = useState(edit?.hashType ?? "");
  const [scope, setScope] = useState<CredentialScope>(edit?.scope ?? "domain");
  const [localHostId, setLocalHostId] = useState(edit?.localHostId ?? "");
  const [source, setSource] = useState(edit?.source ?? "");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [access, setAccess] = useState<AccessDraft>(EMPTY_ACCESS);
  const [errors, setErrors] = useState<Errors>({});
  const [duplicate, setDuplicate] = useState<Credential>();
  const [busy, setBusy] = useState(false);

  const ownerless = mode === "secret";
  const candidates = type === "hash" ? identifyHash(secret, "windows") : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setDuplicate(undefined);
    const errs: Errors = {};
    if (mode === "username") {
      if (username.trim() === "") errs.username = "Give it a username";
      if (access.hostId === "") errs.hostId = "Pick the host it has access on";
      if (access.via.trim() === "") errs.via = "Say how access was gained";
    } else {
      if (mode === "credential" && username.trim() === "") errs.username = "Give it a username";
      if (mode === "secret" && secret.trim() === "") errs.secret = "Enter the secret";
      if (scope === "local" && localHostId === "") errs.localHostId = "Pick the host this local account belongs to";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      if (mode === "username") {
        const parsed = domain.trim() === "" ? parseUsername(username) : { username: username.trim(), domain: domain.trim() };
        const key = usernameKey({ engagementId: eid, ...parsed });
        const existing = usernames.find((u) => usernameKey(u) === key);
        const u = existing ?? (await um.create.mutateAsync({ username: parsed.username, domain: parsed.domain ?? null, source: source.trim() || null }));
        await gm.create.mutateAsync({ usernameId: u.id, grant: { hostId: access.hostId, level: access.level, via: access.via.trim() } });
        onClose();
        return;
      }
      const input: CredentialInput = {
        type,
        username: ownerless ? "" : username.trim(),
        domain: ownerless || domain.trim() === "" ? null : domain.trim(),
        secret,
        scope,
        localHostId: scope === "local" ? localHostId : null,
        // Not shown in the form: an edit keeps where it was captured.
        sourceHostId: edit?.sourceHostId ?? null,
        source: source.trim() || null,
        notes: notes.trim() || null,
        ...(type === "hash" && hashType.trim() ? { hashType: hashType.trim() } : {}),
      };
      // Never create a duplicate: offer the existing one instead.
      const probe: Credential = {
        id: "", engagementId: eid, type, username: input.username ?? "", domain: input.domain ?? null, secret,
        hashType: input.hashType ?? null, scope, localHostId: input.localHostId ?? null, sourceHostId: null,
        source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 0, updatedAt: 0,
      };
      const dup = findDuplicateCredential(credentials.filter((c) => c.id !== edit?.id), probe);
      if (dup) {
        setDuplicate(dup);
        return;
      }
      if (edit) {
        const updated = await cm.update.mutateAsync({ id: edit.id, input });
        onSaved?.(updated);
        onClose();
        return;
      }
      const created = await cm.create.mutateAsync(input);
      onSaved?.(created);
      onClose();
    } catch (err) {
      const field = RavenError.from(err).field;
      const message = RavenError.from(err).message;
      setErrors(field === "username" || field === "secret" || field === "via" ? { [field]: message } : { form: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={edit ? "Edit credential" : "Add credential"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {edit ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
        {!edit && (
          <div role="group" aria-label="What you have" className="grid gap-2">
            <span className={labelClass}>What you have</span>
            <ChipSet>
              {MODES.map((m) => (
                <Toggle key={m.id} on={mode === m.id} onChange={() => { setMode(m.id); setErrors({}); setDuplicate(undefined); }}>
                  {m.label}
                </Toggle>
              ))}
            </ChipSet>
          </div>
        )}

        {!ownerless && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username" error={errors.username}>
              <Input
                autoFocus
                mono
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onPaste={(e) => {
                  // A pasted user:pass line fills the whole credential; anything else pastes as text.
                  const parsed = parseCredentialPaste(e.clipboardData.getData("text"));
                  if (!parsed) return;
                  e.preventDefault();
                  setUsername(parsed.username);
                  setDomain(parsed.domain ?? "");
                  setSecret(parsed.secret);
                  setType(parsed.type);
                }}
                placeholder={mode === "username" ? "CORP\\jsmith" : "jsmith"}
              />
            </Field>
            <Field label="Domain">
              <Input mono value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="CORP" />
            </Field>
          </div>
        )}

        {mode === "username" ? (
          <AccessFields value={access} onChange={setAccess} hosts={hosts} errors={errors} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select options={TYPES.map((t) => ({ value: t, label: t }))} value={type} onValueChange={(t) => setType(t as CredentialType)} />
              </Field>
              <Field label="Scope">
                <Select options={SCOPES} value={scope} onValueChange={(s) => setScope(s as CredentialScope)} />
              </Field>
            </div>
            {scope === "local" && (
              <Field label="Local host" error={errors.localHostId}>
                <Select
                  placeholder="Pick a host"
                  options={hosts.map((h) => ({ value: h.id, label: hostLabel(h) }))}
                  value={localHostId || undefined}
                  onValueChange={setLocalHostId}
                />
              </Field>
            )}
            <Field label="Secret" error={errors.secret}>
              <Input mono type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus={ownerless} />
            </Field>
            {type === "hash" && (
              <Field
                label="Hash type"
                hint={
                  candidates.length > 0 ? (
                    <ChipSet className="items-center">
                      <span>Looks like:</span>
                      {candidates.map((c) => (
                        <Button key={c.name} size="sm" onClick={() => setHashType(c.name)}>{c.name}</Button>
                      ))}
                    </ChipSet>
                  ) : undefined
                }
              >
                <Input value={hashType} onChange={(e) => setHashType(e.target.value)} placeholder={defaultHashType(secret) ?? "NTLM"} />
              </Field>
            )}
            <Field label="Source">
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="where it came from" />
            </Field>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
          </>
        )}

        {duplicate && (
          <div role="alert" className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3 rounded-sm border border-warn px-3 py-2 text-meta text-warn">
            <span>Already recorded: {credLabel(duplicate)}</span>
            <Button size="sm" onClick={onClose}>Use existing</Button>
          </div>
        )}
        {errors.form && <p role="alert" className="m-0 text-meta text-warn">{errors.form}</p>}
      </form>
    </Dialog>
  );
}
