import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
} from "../../../engines/credentials/index";
import { isDialogOpen, isTypingTarget } from "../../../lib/keys";
import type { CredAttempt, Credential, Username } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import type { Service } from "../../../types/service";
import { Button, Chip, IconButton } from "../../../ui/index";
import { ScrollArea } from "../../../ui/shadcn/scroll-area";
import { Separator } from "../../../ui/shadcn/separator";
import { AccessGrantDialog } from "../AccessGrants/AccessGrants";
import { DockWork } from "../DockWork/DockWork";
import { StateChip } from "../InventoryList/InventoryList";
import { MaskedSecret } from "../MaskedSecret/MaskedSecret";
import { useCredentialMutations } from "../queries";
import { dockTabs } from "../selection";
import { hostLabel } from "../../../lib/hostName";
import "./CredentialDock.scss";

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
    <div className="credential-dock__fact">
      <dt className="credential-dock__fact-label">{label}</dt>
      <dd className="credential-dock__fact-value">{children}</dd>
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

  const header = useRef<HTMLElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || folded || e.defaultPrevented || isDialogOpen() || isTypingTarget(e.target)) return;
    e.preventDefault();
    onFold(true);
    // The focused tab goes away with the body; leave focus on the fold button so the next Esc doesn't leave the engagement.
    header.current?.querySelector<HTMLElement>("[data-dock-fold]")?.focus();
  };

  const facts = (
    <dl
      data-testid="dock-facts"
      data-layout={tabs.length > 0 ? "column" : "row"}
      className="credential-dock__facts"
    >
      <Fact label="Source">{cred.source || <span className="credential-dock__muted">unknown</span>}</Fact>
      <Fact label="Scope">
        {cred.scope}
        {scopeHost && <span className="credential-dock__scope-host" title={scopeHost}>{scopeHost}</span>}
      </Fact>
      <Fact label="Works on">
        {works.length === 0 ? (
          <span className="credential-dock__muted">nothing yet</span>
        ) : (
          <ul className="credential-dock__works">
            {works.map((w) => <li key={w.where} className="credential-dock__work-cell" title={w.where}>{w.where}</li>)}
          </ul>
        )}
      </Fact>
      {ownerless && (
        <Fact label="Matched users">
          {matched.length > 0 ? matched.map((c) => usernameLabel(c)).join(", ") : <span className="credential-dock__muted">no user matched yet</span>}
        </Fact>
      )}
      {placeholder && !ownerless && (
        <Button className="credential-dock__convert" onClick={() => setConverting(true)}>Convert to access-only</Button>
      )}
    </dl>
  );

  return (
    <section
      aria-label="Credential"
      onKeyDown={onKeyDown}
      className={folded ? "credential-dock credential-dock--folded" : "credential-dock"}
    >
      {/* Folded, the dock is this row alone: its height (44px + border) is DOCK_FOLDED_PX in CredentialsSection. Keep them in step. */}
      <header ref={header} data-testid="dock-header" className="credential-dock__header">
        <div className="credential-dock__title">
          <span className="credential-dock__name" title={name}>{name}</span>
          <span className="credential-dock__type">{cred.type}</span>
          <span className="credential-dock__scope">{cred.scope}</span>
          {works.length > 0 ? (
            // Only the best level: where it works is listed once, under Works on.
            <Chip variant="accent" className="credential-dock__level">{works[0].level}</Chip>
          ) : (
            <StateChip state={overallState(cred, hosts, servicesByHost, attempts)} />
          )}
        </div>
        <div className="credential-dock__actions">
          {placeholder ? (
            <span className="credential-dock__muted">no secret</span>
          ) : (
            <MaskedSecret secret={cred.secret} label={`secret for ${label}`} hideMaskBelow="credential-dock__mask" />
          )}
          <IconButton icon={PencilSimple} label={`Edit ${label}`} onClick={onEdit} />
          <IconButton icon={Trash} tone="destructive" label={`Delete ${label}`} onClick={onDelete} />
          <IconButton
            data-dock-fold=""
            icon={folded ? CaretUp : CaretDown}
            label={folded ? "Open credential" : "Fold credential"}
            onClick={() => onFold(!folded)}
          />
        </div>
      </header>
      {!folded && (
        <>
          <Separator />
          <div className={tabs.length > 0 ? "credential-dock__body credential-dock__body--tabs" : "credential-dock__body"}>
            {facts}
            {tabs.length > 0 && (
              <>
                <Separator className="credential-dock__rule-across" />
                <Separator orientation="vertical" className="credential-dock__rule-down" />
                <ScrollArea className="credential-dock__work">
                  <div className="credential-dock__work-inner">
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
  return (
    <AccessGrantDialog
      title={`Convert ${credLabel(cred)} to access-only`}
      description="It has no secret to try. Keep the username and record the access instead."
      action="Convert"
      hosts={hosts}
      pending={convert.isPending}
      onClose={onClose}
      onSubmit={(grant, onError) => convert.mutate({ credId: cred.id, grant }, { onSuccess: onClose, onError: (e) => onError(e.message) })}
    />
  );
}
