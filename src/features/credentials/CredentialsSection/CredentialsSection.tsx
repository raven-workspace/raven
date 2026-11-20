import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Plus } from "@phosphor-icons/react";
import { credLabel, dedupeHashCaptures, foldCrackedHashes, isSprayable } from "../../../engines/credentials/index";
import type { Credential } from "../../../types/credentials";
import type { Host } from "../../../types/host";
import { Button, IconButton, queryState } from "../../../ui/index";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../../ui/shadcn/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/shadcn/tabs";
import { ConfirmDelete } from "../../checklist/ConfirmDelete/ConfirmDelete";
import { useEngagementServices } from "../../services/queries";
import { useHosts } from "../../hosts/queries";
import { CredentialDock } from "../CredentialDock/CredentialDock";
import { CredentialForm } from "../CredentialForm/CredentialForm";
import { InventoryList } from "../InventoryList/InventoryList";
import {
  credentialsKey,
  useAccessGrants,
  useCredAttempts,
  useCredentialMutations,
  useCredentials,
  useTriedPairs,
  useUsernames,
} from "../queries";
import { TestGrid } from "../TestGrid/TestGrid";
import { useCredentialSelection } from "../useCredentialSelection";
import "./CredentialsSection.scss";

const NO_HOSTS: Host[] = [];
const NO_CREDS: Credential[] = [];

/*
 * The dock's header row is 44px (28px icon buttons in 8px padding) plus its 1px border top and bottom. The dock panel
 * also holds the 12px gap above the dock. Folded, the panel is exactly that; open, it keeps 160px of body under it.
 */
const DOCK_GAP_PX = 12;
const DOCK_FOLDED_PX = DOCK_GAP_PX + 46;
const DOCK_MIN_PX = DOCK_FOLDED_PX + 160;

type Tab = "matrix" | "inventory";

export function CredentialsSection() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
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
  const [folded, setFolded] = useState(false);
  const dockRef = usePanelRef();
  const layout = useDefaultLayout({ id: `raven.credDock.${id}` });

  // After Record plaintext the selection moves to the new password. Until both the URL names it and the refetch lists
  // it, the hash it came from stays docked and `ready` holds off the fallback that would otherwise pick the default.
  // If the credentials query settles after the crack without listing the password (a failed refetch, or it never
  // appears), the hold lets go and normal resolution takes over: it never sticks.
  const [cracked, setCracked] = useState<{ hashId: string; passwordId: string; since: number }>();

  const creds = credsQ.data ?? NO_CREDS;
  const hosts = hostsQ.data ?? NO_HOSTS;
  const attempts = useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  const shown = useMemo(() => foldCrackedHashes(dedupeHashCaptures(creds), attempts), [creds, attempts]);
  const ctx = useMemo(() => ({ hosts, servicesByHost, attempts: shown.attempts }), [hosts, servicesByHost, shown.attempts]);
  const loaded = !!(hostsQ.data && credsQ.data && usersQ.data && grantsQ.data && attemptsQ.data && servicesQ.data);
  const [params] = useSearchParams();
  const landed = !!cracked && shown.creds.some((c) => c.id === cracked.passwordId);
  const settled = !credsQ.isFetching && Math.max(credsQ.dataUpdatedAt, credsQ.errorUpdatedAt) > (cracked?.since ?? Infinity);
  const waiting = !!cracked && !(settled && !landed) && (params.get("cred") !== cracked.passwordId || !landed);
  const { selectedId, select, tab, setTab } = useCredentialSelection(shown.creds, ctx, loaded && !waiting);
  // Landed: let go, so a later delete of that password can't hold the fallback off again.
  if (cracked && !waiting) setCracked(undefined);

  const choose = useCallback((cid: string) => {
    setCracked(undefined);
    select(cid);
  }, [select]);
  // Move the selection to a credential just made (Record plaintext, Add credential), holding the old one docked until it is listed.
  const follow = (fromId: string, password: Credential) => {
    select(password.id);
    // Read live, not from this render: the refetch may already have landed.
    const q = qc.getQueryState<Credential[]>(credentialsKey(id));
    const listed = !!q?.data?.some((c) => c.id === password.id);
    // Nothing more is coming and it isn't listed: no hold, normal resolution decides.
    if (q?.fetchStatus === "idle" && !listed) return;
    setCracked({ hashId: fromId, passwordId: password.id, since: listed ? -1 : Math.max(q?.dataUpdatedAt ?? 0, q?.errorUpdatedAt ?? 0) });
  };
  const onCracked = (hash: Credential) => (password: Credential) => follow(hash.id, password);
  const onFold = (fold: boolean) => (fold ? dockRef.current?.collapse() : dockRef.current?.expand());

  const state = queryState([hostsQ, credsQ, usersQ, grantsQ, attemptsQ, servicesQ], "credentials");
  if (state || !loaded) return state;
  const usernames = usersQ.data!;
  const byId = (cid?: string) => shown.creds.find((c) => c.id === cid);
  const selected = waiting ? (byId(cracked!.passwordId) ?? byId(cracked!.hashId)) : byId(selectedId);
  const hidden = shown.creds.filter((c) => !isSprayable(c)).length;

  const panes = (
    <>
      <TabsContent value="matrix" className="credentials-section__pane">
        <TestGrid
          eid={id}
          hosts={hosts}
          creds={shown.creds}
          attempts={shown.attempts}
          servicesByHost={servicesByHost}
          tried={triedQ.data}
          selectedId={selected?.id}
          onSelect={choose}
          fill
          note={hidden > 0 ? (
            <p className="credentials-section__note">
              {`${hidden} not sprayable`}
              <Button size="sm" onClick={() => setTab("inventory")}>see Inventory</Button>
            </p>
          ) : undefined}
        />
      </TabsContent>
      <TabsContent value="inventory" className="credentials-section__pane">
        <InventoryList
          eid={id}
          creds={shown.creds}
          all={creds}
          hosts={hosts}
          servicesByHost={servicesByHost}
          attempts={shown.attempts}
          usernames={usernames}
          grants={grantsQ.data!}
          selectedId={selected?.id}
          onSelect={choose}
        />
      </TabsContent>
    </>
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} asChild>
      <section
        aria-label="Credentials"
        className="credentials-section"
      >
        <div className="credentials-section__bar">
          <TabsList aria-label="Credentials view">
            <TabsTrigger value="matrix">Matrix</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
          </TabsList>
          {/* One of the two shows: the cells own the display, since Button's own inline-flex outranks `hidden`. */}
          <div className="credentials-section__add-wide">
            <Button variant="primary" onClick={() => setForm({})}>Add credential</Button>
          </div>
          <div className="credentials-section__add-narrow">
            <IconButton icon={Plus} label="Add credential" onClick={() => setForm({})} />
          </div>
        </div>

        {selected ? (
          <ResizablePanelGroup
            id={`raven.credDock.${id}`}
            orientation="vertical"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={(next, meta) => {
              layout.onLayoutChanged(next, meta);
              setFolded(dockRef.current?.isCollapsed() ?? false);
            }}
            className="credentials-section__split"
          >
            <ResizablePanel id="list" minSize="30%" className="credentials-section__list-panel">{panes}</ResizablePanel>
            <ResizableHandle aria-label="Resize credential dock" />
            <ResizablePanel
              id="dock"
              panelRef={dockRef}
              collapsible
              collapsedSize={DOCK_FOLDED_PX}
              minSize={DOCK_MIN_PX}
              maxSize="70%"
              defaultSize="38%"
              className="credentials-section__dock-panel"
            >
              <CredentialDock
                eid={id}
                cred={selected}
                all={creds}
                creds={shown.creds}
                hosts={hosts}
                servicesByHost={servicesByHost}
                attempts={shown.attempts}
                usernames={usernames}
                folded={folded}
                onFold={onFold}
                onEdit={() => setForm({ edit: selected })}
                onDelete={() => setDeleting(selected)}
                onCracked={onCracked(selected)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="credentials-section__panes">{panes}</div>
        )}

        {form && <CredentialForm eid={id} hosts={hosts} credentials={creds} edit={form.edit} onClose={() => setForm(null)} onSaved={form.edit ? undefined : (c) => follow(selected?.id ?? "", c)} />}
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
    </Tabs>
  );
}
