import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  credLabel,
  credName,
  dedupeHashCaptures,
  foldCrackedHashes,
  isMachineAccount,
  isOwnerless,
  isPlaceholderSecret,
  overallState,
  usernameLabel,
  type OverallState,
} from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import type { Host } from "../../types/host";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import { ActionCell, Button, Chip, Dialog, EmptyState, IconButton, labelClass, queryState } from "../../ui";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useEngagementServices } from "../checklist/queries";
import { useHosts } from "../hosts/queries";
import { AccessFields, EMPTY_ACCESS, hostLabel, type AccessDraft } from "./AccessGrants";
import { CredentialForm } from "./CredentialForm";
import { CrackDialog, HashesList } from "./HashesList";
import { CopySecretButton, MaskedSecret } from "./MaskedSecret";
import { useAccessGrants, useCredAttempts, useCredentialMutations, useCredentials, useTriedPairs, useUsernames } from "./queries";
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

/*
 * Column policy (DESIGN.md Tables and lists): credential, type, scope, source, state, secret, verb, icons.
 * The pane decides, not the window: under 900px of pane Source drops, under 700px Scope too. The "verb"
 * track holds Crack/Convert (empty for most rows) so Copy, Edit and Delete land on the same x in every row.
 * The credential track outweighs Source so names stay whole while Source has slack. Rows are subgrids.
 */
const TABLE =
  "grid w-full gap-x-3 text-body " +
  "grid-cols-[minmax(20ch,3fr)_max-content_max-content_max-content_max-content_max-content] " +
  "@[700px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_max-content_max-content_max-content_max-content] " +
  "@[900px]:grid-cols-[minmax(20ch,3fr)_max-content_max-content_minmax(10ch,2fr)_max-content_max-content_max-content_max-content]";
const ROW = "col-span-full grid grid-cols-subgrid items-start px-2";
const SHOW_SCOPE = "hidden @[700px]:grid";
const SHOW_SCOPE_HEAD = "hidden @[700px]:block";
const SHOW_SOURCE = "hidden @[900px]:block";
const HEADERS = [
  { label: "Credential", cls: "" },
  { label: "Type", cls: "" },
  { label: "Scope", cls: SHOW_SCOPE_HEAD },
  { label: "Source", cls: SHOW_SOURCE },
  { label: "State", cls: "" },
  { label: "Secret", cls: "" },
  { label: "", cls: "col-span-2" },
];

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
  const triedQ = useTriedPairs(id);
  const { servicesByHost, query: servicesQ } = useEngagementServices(id);
  const { remove } = useCredentialMutations(id);
  const [form, setForm] = useState<{ edit?: Credential } | null>(null);
  const [deleting, setDeleting] = useState<Credential>();
  const [converting, setConverting] = useState<Credential>();
  const [cracking, setCracking] = useState<Credential>();

  const creds = useMemo(() => credsQ.data ?? [], [credsQ.data]);
  const attempts = useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  const shown = useMemo(() => foldCrackedHashes(dedupeHashCaptures(creds), attempts), [creds, attempts]);

  const state = queryState([hostsQ, credsQ, usersQ, grantsQ, attemptsQ, servicesQ], "credentials");
  if (state || !hostsQ.data || !credsQ.data || !usersQ.data || !grantsQ.data || !attemptsQ.data || !servicesQ.data) return state;
  const hosts = hostsQ.data;
  const hostName = (hid: string | null) => (hid ? hostLabel(hosts.find((h) => h.id === hid)) : "");
  const hashes = shown.creds.filter((c) => c.type === "hash");
  const users = shown.creds.filter((c) => !isMachineAccount(c));
  const machines = shown.creds.filter(isMachineAccount);
  const renderRow = (c: Credential) => (
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
  );

  return (
    <section aria-label="Credentials" className="@container grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className={`m-0 ${labelClass}`}>Credentials <span className="tabular-nums">{shown.creds.length}</span></h3>
        <Button variant="primary" onClick={() => setForm({})}>Add credential</Button>
      </div>

      {shown.creds.length === 0 ? (
        <EmptyState title="No credentials yet" />
      ) : (
        <table className={TABLE}>
          <thead className="contents">
            <tr className={ROW}>
              {HEADERS.map(({ label, cls }) => (
                <th key={label} scope="col" className={`whitespace-nowrap py-2 text-left ${labelClass} ${cls}`}>
                  {label || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="contents">
            {users.map(renderRow)}
            {machines.length > 0 && (
              <>
                <tr className="col-span-full">
                  <th colSpan={8} scope="colgroup" className={`px-2 pb-1 pt-4 text-left ${labelClass}`}>
                    Machine accounts <span className="tabular-nums">{machines.length}</span>
                  </th>
                </tr>
                {machines.map(renderRow)}
              </>
            )}
          </tbody>
        </table>
      )}

      <TestGrid eid={id} hosts={hosts} creds={shown.creds} attempts={shown.attempts} servicesByHost={servicesByHost} tried={triedQ.data} />
      <RoutineSection eid={id} hosts={hosts} creds={shown.creds} usernames={usersQ.data} attempts={shown.attempts} servicesByHost={servicesByHost} />

      <UsernamesList eid={id} usernames={usersQ.data} grants={grantsQ.data} hosts={hosts} />
      <HashesList eid={id} hashes={hashes} />

      {form && <CredentialForm eid={id} hosts={hosts} credentials={creds} edit={form.edit} onClose={() => setForm(null)} />}
      {cracking && <CrackDialog eid={id} hash={cracking} onClose={() => setCracking(undefined)} />}
      {converting && <ConvertDialog eid={id} cred={converting} hosts={hosts} onClose={() => setConverting(undefined)} />}
      {deleting && (
        <ConfirmDelete
          title={`Delete ${credLabel(deleting)}?`}
          detail="Its test results in the matrix go with it."
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
  const placeholder = isPlaceholderSecret(cred);
  const name = credName(cred);
  return (
    <tr className={`${ROW} border-b border-line py-2`}>
      <td className="min-w-0">
        {ownerless ? (
          <span className="grid justify-items-start gap-1">
            <Chip>owner unknown</Chip>
            <span className="text-meta text-muted">
              {matched.length > 0
                ? `matched: ${matched.map((c) => usernameLabel(c)).join(", ")}`
                : "no user matched yet"}
            </span>
          </span>
        ) : (
          <span className="block truncate font-mono text-code text-fg" title={name}>{name}</span>
        )}
      </td>
      <td className="whitespace-nowrap text-fg-2">{cred.type}</td>
      <td className={`${SHOW_SCOPE} min-w-0 text-fg-2`}>
        <span className="whitespace-nowrap">{cred.scope}</span>
        {scopeHost && <span className="max-w-[24ch] truncate text-meta text-muted" title={scopeHost}>{scopeHost}</span>}
      </td>
      <td className={`min-w-0 ${SHOW_SOURCE} text-fg-2`}>
        {cred.source && <span className="block truncate" title={cred.source}>{cred.source}</span>}
      </td>
      <td className="whitespace-nowrap"><StateChip state={state} /></td>
      <td className="whitespace-nowrap">
        {placeholder ? <span className="text-muted">no secret</span> : <MaskedSecret secret={cred.secret} label={`secret for ${label}`} copy={false} />}
      </td>
      <td className="justify-self-end">
        {cred.type === "hash" && <Button size="sm" aria-label={`Crack ${label} from list`} onClick={onCrack}>Crack</Button>}
        {placeholder && !ownerless && (
          <Button size="sm" aria-label={`Convert ${label} to access-only`} onClick={onConvert}>Convert to access-only</Button>
        )}
      </td>
      <td>
        <ActionCell>
          {placeholder ? <span aria-hidden className="size-7" /> : <CopySecretButton secret={cred.secret} label={`secret for ${label}`} />}
          <IconButton icon={PencilSimple} label={`Edit ${label}`} onClick={onEdit} />
          <IconButton icon={Trash} tone="destructive" label={`Delete ${label}`} onClick={onDelete} />
        </ActionCell>
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
      {errors.form && <p role="alert" className="m-0 mt-2 text-meta text-warn">{errors.form}</p>}
    </Dialog>
  );
}
