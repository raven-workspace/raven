import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  credLabel,
  dedupeHashCaptures,
  foldCrackedHashes,
  isOwnerless,
  isPlaceholderSecret,
  overallState,
  usernameLabel,
  type OverallState,
} from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import type { Host } from "../../types/host";
import { Button, Chip, Dialog, EmptyState, labelClass } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useEngagementServices } from "../checklist/queries";
import { useHosts } from "../hosts/queries";
import { AccessFields, EMPTY_ACCESS, hostLabel, type AccessDraft } from "./AccessGrants";
import { CredentialForm } from "./CredentialForm";
import { CrackDialog, HashesList } from "./HashesList";
import { MaskedSecret } from "./MaskedSecret";
import { useAccessGrants, useCredAttempts, useCredentialMutations, useCredentials, useUsernames } from "./queries";
import { RoutineSection } from "./RoutineSection";
import { TestGrid } from "./TestGrid";
import { UsernamesList } from "./UsernamesList";

const STATE_LABEL: Record<OverallState, string> = {
  admin: "admin",
  valid: "valid",
  untested: "untested",
  dead: "dead",
  "not-sprayable": "not sprayable",
};

/** Accent only for access that works; warn for dead. */
function StateChip({ state }: { state: OverallState }) {
  const variant = state === "admin" || state === "valid" ? "accent" : state === "dead" ? "warn" : "default";
  return <Chip variant={variant}>{STATE_LABEL[state]}</Chip>;
}

export function CredentialsSection() {
  const { id = "" } = useParams();
  const hostsQ = useHosts(id);
  const credsQ = useCredentials(id);
  const usersQ = useUsernames(id);
  const grantsQ = useAccessGrants(id);
  const attemptsQ = useCredAttempts(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { remove } = useCredentialMutations(id);
  const [form, setForm] = useState<{ edit?: Credential } | null>(null);
  const [deleting, setDeleting] = useState<Credential>();
  const [converting, setConverting] = useState<Credential>();
  const [cracking, setCracking] = useState<Credential>();

  const creds = useMemo(() => credsQ.data ?? [], [credsQ.data]);
  const attempts = useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  const shown = useMemo(() => foldCrackedHashes(dedupeHashCaptures(creds), attempts), [creds, attempts]);

  const failed = hostsQ.error ?? credsQ.error ?? usersQ.error ?? grantsQ.error ?? attemptsQ.error ?? servicesQ.error;
  if (failed) return <p role="alert" className="py-3 text-xs text-warn">Couldn't load credentials: {failed.message}</p>;
  if (!hostsQ.data || !credsQ.data || !usersQ.data || !grantsQ.data || !attemptsQ.data || !servicesQ.data) return null;
  const hosts = hostsQ.data;
  const hostName = (hid: string | null) => (hid ? hostLabel(hosts.find((h) => h.id === hid)) : "");
  const hashes = shown.creds.filter((c) => c.type === "hash");

  return (
    <section aria-label="Credentials" className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className={`m-0 ${labelClass}`}>Credentials <span className="tabular-nums">{shown.creds.length}</span></h3>
        <Button variant="primary" onClick={() => setForm({})}>Add credential</Button>
      </div>

      {shown.creds.length === 0 ? (
        <EmptyState title="No credentials yet" />
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-label text-muted">
              {["Credential", "Type", "Scope", "Source", "State", "Secret", ""].map((h, i) => (
                <th key={i} scope="col" className="px-2 py-1.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.creds.map((c) => (
              <CredentialRow
                key={c.id}
                cred={c}
                all={creds}
                state={overallState(c, hosts, servicesByHost, shown.attempts)}
                scopeHost={c.scope === "local" ? hostName(c.localHostId) : ""}
                onEdit={() => setForm({ edit: c })}
                onDelete={() => setDeleting(c)}
                onConvert={() => setConverting(c)}
                onCrack={() => setCracking(c)}
              />
            ))}
          </tbody>
        </table>
      )}

      <TestGrid eid={id} hosts={hosts} creds={shown.creds} attempts={shown.attempts} servicesByHost={servicesByHost} />
      <RoutineSection eid={id} hosts={hosts} creds={shown.creds} usernames={usersQ.data} attempts={shown.attempts} servicesByHost={servicesByHost} />

      <UsernamesList eid={id} usernames={usersQ.data} grants={grantsQ.data} hosts={hosts} />
      <HashesList eid={id} hashes={hashes} />

      {form && <CredentialForm eid={id} hosts={hosts} credentials={creds} edit={form.edit} onClose={() => setForm(null)} />}
      {cracking && <CrackDialog eid={id} hash={cracking} onClose={() => setCracking(undefined)} />}
      {converting && <ConvertDialog eid={id} cred={converting} hosts={hosts} onClose={() => setConverting(undefined)} />}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${credLabel(deleting)}?`}
          pending={remove.isPending}
          error={remove.error?.message}
          label="Delete credential"
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
        />
      )}
    </section>
  );
}

function CredentialRow({ cred, all, state, scopeHost, onEdit, onDelete, onConvert, onCrack }: {
  cred: Credential;
  all: Credential[];
  state: OverallState;
  scopeHost: string;
  onEdit: () => void;
  onDelete: () => void;
  onConvert: () => void;
  onCrack: () => void;
}) {
  const label = credLabel(cred);
  const ownerless = isOwnerless(cred);
  const matched = ownerless ? all.filter((c) => c.fromSecretId === cred.id) : [];
  return (
    <tr className="border-b border-line align-top">
      <td className="px-2 py-1.5">
        {ownerless ? (
          <span className="flex flex-col items-start gap-0.5">
            <Chip>owner unknown</Chip>
            <span className="text-[11px] text-muted">
              {matched.length > 0
                ? `matched: ${matched.map((c) => usernameLabel(c)).join(", ")}`
                : "no user matched yet"}
            </span>
          </span>
        ) : (
          <span className="font-mono text-[12.5px] text-fg">{label}</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-fg-2">{cred.type}</td>
      <td className="px-2 py-1.5 text-fg-2">{cred.scope}{scopeHost && ` · ${scopeHost}`}</td>
      <td className="px-2 py-1.5 text-fg-2">{cred.source ?? ""}</td>
      <td className="px-2 py-1.5"><StateChip state={state} /></td>
      <td className="px-2 py-1.5">
        {isPlaceholderSecret(cred) ? <span className="text-muted">no secret</span> : <MaskedSecret secret={cred.secret} label={`secret for ${label}`} />}
      </td>
      <td className="px-2 py-1.5">
        <span className="flex justify-end gap-1.5">
          {cred.type === "hash" && <Button size="sm" aria-label={`Crack ${label} from list`} onClick={onCrack}>Crack</Button>}
          {isPlaceholderSecret(cred) && !ownerless && (
            <Button size="sm" aria-label={`Convert ${label} to access-only`} onClick={onConvert}>Convert to access-only</Button>
          )}
          <Button size="sm" aria-label={`Edit ${label}`} onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="danger" aria-label={`Delete ${label}`} onClick={onDelete}>Delete</Button>
        </span>
      </td>
    </tr>
  );
}

function ConvertDialog({ eid, cred, hosts, onClose }: { eid: string; cred: Credential; hosts: Host[]; onClose: () => void }) {
  const { convert } = useCredentialMutations(eid);
  const [draft, setDraft] = useState<AccessDraft>(EMPTY_ACCESS);
  const [errors, setErrors] = useState<{ hostId?: string; via?: string; form?: string }>({});
  const save = () => {
    const errs = {
      ...(draft.hostId === "" ? { hostId: "Choose a host" } : {}),
      ...(draft.via.trim() === "" ? { via: "Say how access was gained" } : {}),
    };
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    convert.mutate(
      { credId: cred.id, grant: { hostId: draft.hostId, level: draft.level, via: draft.via.trim() } },
      { onSuccess: onClose, onError: (e) => setErrors({ form: e.message }) },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Convert ${credLabel(cred)} to access-only`}
      description="It has no secret to try. Keep the username and record the access instead."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={convert.isPending} onClick={save}>Convert</Button>
        </>
      }
    >
      <AccessFields value={draft} onChange={setDraft} hosts={hosts} errors={errors} />
      {errors.form && <p role="alert" className="m-0 mt-2 text-xs text-warn">{errors.form}</p>}
    </Dialog>
  );
}
