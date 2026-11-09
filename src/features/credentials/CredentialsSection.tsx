import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Plus } from "@phosphor-icons/react";
import { credLabel, dedupeHashCaptures, foldCrackedHashes, isSprayable } from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import type { Host } from "../../types/host";
import { Button, IconButton, queryState } from "../../ui";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../ui/shadcn/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/shadcn/tabs";
import { ConfirmDelete } from "../checklist/ConfirmDelete";
import { useEngagementServices } from "../checklist/queries";
import { useHosts } from "../hosts/queries";
import { CredentialDock } from "./CredentialDock";
import { CredentialForm } from "./CredentialForm";
import { InventoryList } from "./InventoryList";
import {
  useAccessGrants,
  useCredAttempts,
  useCredentialMutations,
  useCredentials,
  useTriedPairs,
  useUsernames,
} from "./queries";
import { TestGrid } from "./TestGrid";
import { useCredentialSelection } from "./useCredentialSelection";

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
  const [cracked, setCracked] = useState<{ hashId: string; passwordId: string }>();

  const creds = credsQ.data ?? NO_CREDS;
  const hosts = hostsQ.data ?? NO_HOSTS;
  const attempts = useMemo(() => attemptsQ.data ?? [], [attemptsQ.data]);
  const shown = useMemo(() => foldCrackedHashes(dedupeHashCaptures(creds), attempts), [creds, attempts]);
  const ctx = useMemo(() => ({ hosts, servicesByHost, attempts: shown.attempts }), [hosts, servicesByHost, shown.attempts]);
  const loaded = !!(hostsQ.data && credsQ.data && usersQ.data && grantsQ.data && attemptsQ.data && servicesQ.data);
  const [params] = useSearchParams();
  const waiting = !!cracked && (params.get("cred") !== cracked.passwordId || !shown.creds.some((c) => c.id === cracked.passwordId));
  const { selectedId, select, tab, setTab } = useCredentialSelection(id, shown.creds, ctx, loaded && !waiting);
  // Landed: let go, so a later delete of that password can't hold the fallback off again.
  if (cracked && !waiting) setCracked(undefined);

  const choose = (cid: string) => {
    setCracked(undefined);
    select(cid);
  };
  const onCracked = (hash: Credential) => (password: Credential) => {
    setCracked({ hashId: hash.id, passwordId: password.id });
    select(password.id);
  };
  const onFold = (fold: boolean) => (fold ? dockRef.current?.collapse() : dockRef.current?.expand());

  const state = queryState([hostsQ, credsQ, usersQ, grantsQ, attemptsQ, servicesQ], "credentials");
  if (state || !loaded) return state;
  const usernames = usersQ.data!;
  const byId = (cid?: string) => shown.creds.find((c) => c.id === cid);
  const selected = waiting ? (byId(cracked!.passwordId) ?? byId(cracked!.hashId)) : byId(selectedId);
  const hidden = shown.creds.filter((c) => !isSprayable(c)).length;

  const panes = (
    <>
      <TabsContent value="matrix" className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-3">
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
        />
        {hidden > 0 && (
          <p className="m-0 grid grid-cols-[max-content_max-content] items-center justify-start gap-2 text-meta text-muted">
            {`${hidden} more ${hidden === 1 ? "credential" : "credentials"} can't be sprayed:`}
            <Button size="sm" onClick={() => setTab("inventory")}>see Inventory</Button>
          </p>
        )}
      </TabsContent>
      <TabsContent value="inventory" className="h-full min-h-0">
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
      <section aria-label="Credentials" className="@container grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <TabsList aria-label="Credentials view">
            <TabsTrigger value="matrix">Matrix</TabsTrigger>
            <TabsTrigger value="inventory">
              Inventory <span className="tabular-nums">{shown.creds.length + usernames.length}</span>
            </TabsTrigger>
          </TabsList>
          <Button variant="primary" className="hidden @[560px]:inline-grid" onClick={() => setForm({})}>Add credential</Button>
          <IconButton icon={Plus} label="Add credential" className="@[560px]:hidden" onClick={() => setForm({})} />
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
            className="min-h-0"
          >
            <ResizablePanel id="list" minSize="30%" className="pb-3">{panes}</ResizablePanel>
            <ResizableHandle aria-label="Resize credential dock" />
            <ResizablePanel
              id="dock"
              panelRef={dockRef}
              collapsible
              collapsedSize={DOCK_FOLDED_PX}
              minSize={DOCK_MIN_PX}
              maxSize="70%"
              defaultSize="45%"
              className="pt-3"
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
          <div className="min-h-0">{panes}</div>
        )}

        {form && <CredentialForm eid={id} hosts={hosts} credentials={creds} edit={form.edit} onClose={() => setForm(null)} />}
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
