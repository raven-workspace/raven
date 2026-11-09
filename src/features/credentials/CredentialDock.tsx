import { useMemo, useState, type KeyboardEvent } from "react";
import { CaretDown, CaretUp, PencilSimple, Trash } from "@phosphor-icons/react";
import {
  cellFor,
  credLabel,
  credName,
  isOwnerless,
  hostSprayServices,
  isPlaceholderSecret,
  overallState,
  usernameLabel,
} from "../../engines/credentials";
import { isDialogOpen, isTypingTarget } from "../../lib/keys";
import type { CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Button, Chip, Dialog, IconButton, labelClass } from "../../ui";
import { ScrollArea } from "../../ui/shadcn/scroll-area";
import { Separator } from "../../ui/shadcn/separator";
import { AccessFields, EMPTY_ACCESS, hostLabel, type AccessDraft } from "./AccessGrants";
import { DockWork } from "./DockWork";
import { StateChip } from "./InventoryList";
import { MaskedSecret } from "./MaskedSecret";
import { useCredentialMutations } from "./queries";
import { dockTabs } from "./selection";

interface Props {
  eid: string;
  cred: Credential;
  /** The raw credential list, for matched users. */
  all: Credential[];
  /** The credentials as listed (cracked hashes folded), for the username spray. */
  creds: Credential[];
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  usernames: Username[];
  folded: boolean;
  onFold: (folded: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCracked: (password: Credential) => void;
}

/** Where this credential works, as the matrix sees it: one entry per host and service cell that is admin or valid, admin first. */
function worksOn(
  cred: Credential,
  hosts: Host[],
  servicesByHost: Map<string, Service[]>,
  attempts: CredAttempt[],
): { level: "admin" | "valid"; where: string }[] {
  const out: { level: "admin" | "valid"; where: string }[] = [];
  for (const host of hosts) {
    const services = servicesByHost.get(host.id) ?? [];
    for (const service of hostSprayServices(host, services)) {
      const { state } = cellFor(cred, host, services, service, attempts);
      if (state === "admin" || state === "valid") out.push({ level: state, where: `${hostLabel(host)} ${service.toUpperCase()}` });
    }
  }
  return out.sort((a, b) => Number(b.level === "admin") - Number(a.level === "admin"));
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className={labelClass}>{label}</dt>
      <dd className="m-0 min-w-0 text-body text-fg-2">{children}</dd>
    </div>
  );
}

export function CredentialDock({ eid, cred, all, creds, hosts, servicesByHost, attempts, usernames, folded, onFold, onEdit, onDelete, onCracked }: Props) {
  const [converting, setConverting] = useState(false);
  const label = credLabel(cred);
  const name = credName(cred);
  const placeholder = isPlaceholderSecret(cred);
  const ownerless = isOwnerless(cred);
  const works = useMemo(() => worksOn(cred, hosts, servicesByHost, attempts), [cred, hosts, servicesByHost, attempts]);
  const tabs = useMemo(() => dockTabs(cred, { hosts, servicesByHost, usernames }), [cred, hosts, servicesByHost, usernames]);
  const matched = ownerless ? all.filter((c) => c.fromSecretId === cred.id) : [];
  const scopeHost = cred.scope === "local" && cred.localHostId ? hostLabel(hosts.find((h) => h.id === cred.localHostId)) : "";

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || folded || e.defaultPrevented || isDialogOpen() || isTypingTarget(e.target)) return;
    e.preventDefault();
    onFold(true);
  };

  const facts = (
    <dl data-testid="dock-facts" className="m-0 grid content-start gap-3 p-3">
      <Fact label="Source">{cred.source || <span className="text-muted">none recorded</span>}</Fact>
      <Fact label="Scope">
        {cred.scope}
        {scopeHost && <span className="block truncate text-meta text-muted" title={scopeHost}>{scopeHost}</span>}
      </Fact>
      <Fact label="Works on">
        {works.length === 0 ? (
          <span className="text-muted">nothing yet</span>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {works.map((w) => <li key={w.where} className="truncate" title={w.where}>{w.where}</li>)}
          </ul>
        )}
      </Fact>
      {ownerless && (
        <Fact label="Matched users">
          {matched.length > 0 ? matched.map((c) => usernameLabel(c)).join(", ") : <span className="text-muted">no user matched yet</span>}
        </Fact>
      )}
      {placeholder && !ownerless && (
        <Button className="justify-self-start" onClick={() => setConverting(true)}>Convert to access-only</Button>
      )}
    </dl>
  );

  return (
    <section
      aria-label="Credential"
      onKeyDown={onKeyDown}
      className={`@container grid h-full min-h-0 grid-cols-[minmax(0,1fr)] rounded-lg border border-line-2 bg-surface ${folded ? "grid-rows-[auto]" : "grid-rows-[auto_auto_minmax(0,1fr)]"}`}
    >
      <header data-testid="dock-header" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
        <div className="grid grid-cols-[minmax(0,max-content)_max-content_max-content_max-content] items-center justify-start gap-3">
          <span className="truncate font-mono text-heading text-fg" title={name}>{name}</span>
          <span className="text-meta text-muted">{cred.type}</span>
          <span className="text-meta text-muted">{cred.scope}</span>
          {works.length > 0 ? (
            <Chip variant="accent">
              {`${works[0].level} on ${works[0].where}`}
              {works.length > 1 && ` +${works.length - 1}`}
            </Chip>
          ) : (
            <StateChip state={overallState(cred, hosts, servicesByHost, attempts)} />
          )}
        </div>
        <div className="grid grid-flow-col items-center gap-2">
          {placeholder ? (
            <span className="text-muted">no secret</span>
          ) : (
            <MaskedSecret secret={cred.secret} label={`secret for ${label}`} />
          )}
          <IconButton icon={PencilSimple} label={`Edit ${label}`} onClick={onEdit} />
          <IconButton icon={Trash} tone="destructive" label={`Delete ${label}`} onClick={onDelete} />
          <IconButton
            icon={folded ? CaretUp : CaretDown}
            label={folded ? "Open credential" : "Fold credential"}
            onClick={() => onFold(!folded)}
          />
        </div>
      </header>
      {!folded && (
        <>
          <Separator className="bg-line-2" />
          <div className={`grid min-h-0 grid-cols-[minmax(0,1fr)] ${tabs.length > 0 ? "grid-rows-[auto_auto_minmax(0,1fr)] @[700px]:grid-rows-none @[700px]:grid-cols-[260px_auto_minmax(0,1fr)]" : ""}`}>
            {facts}
            {tabs.length > 0 && (
              <>
                <Separator className="bg-line-2 @[700px]:hidden" />
                <Separator orientation="vertical" className="hidden bg-line-2 @[700px]:block" />
                <ScrollArea className="h-full min-h-0 [&_[data-slot=scroll-area-viewport]>div]:block!">
                  <div className="p-3">
                    <DockWork
                      key={cred.id}
                      eid={eid}
                      cred={cred}
                      tabs={tabs}
                      hosts={hosts}
                      servicesByHost={servicesByHost}
                      attempts={attempts}
                      usernames={usernames}
                      creds={creds}
                      onCracked={onCracked}
                    />
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        </>
      )}
      {converting && <ConvertDialog eid={eid} cred={cred} hosts={hosts} onClose={() => setConverting(false)} />}
    </section>
  );
}

/** A placeholder secret has nothing to try: keep the username and record the access instead. */
export function ConvertDialog({ eid, cred, hosts, onClose }: { eid: string; cred: Credential; hosts: Host[]; onClose: () => void }) {
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
