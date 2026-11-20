import { useState, type FormEvent } from "react";
import {
  ROUTINE_STEPS,
  buildRoastCommands,
  buildTestCommands,
  buildUsernameSprayCommands,
  credLabel,
  getCrackingCommands,
  identifyHash,
  routineStepApplies,
  type CommandSet,
  type RoutineStepId,
  type SprayService,
} from "../../engines/credentials";
import type { CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Button, CommandBlock, Dialog, Field, Input } from "../../ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/shadcn/tabs";
import { useChecklist, useChecklistMutations } from "../checklist/queries";
import { MASK } from "./MaskedSecret";
import { useCredentialMutations } from "./queries";
import type { DockTab } from "./selection";
import { TestCommands } from "./TestCommands";
import { useEngagement } from "../engagements/queries";

/** Plaintext for a hash. The server records a linked password; the hash then folds into it. */
export function CrackDialog({ eid, hash, onClose, onCracked }: {
  eid: string;
  hash: Credential;
  onClose: () => void;
  onCracked?: (password: Credential) => void;
}) {
  const { crack } = useCredentialMutations(eid);
  const [plaintext, setPlaintext] = useState("");
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (crack.isPending) return;
    if (plaintext === "") return setError("Enter the cracked password");
    setError(undefined);
    crack.mutate(
      { hashId: hash.id, plaintext },
      {
        onSuccess: (password) => {
          onCracked?.(password);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Crack ${credLabel(hash)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="crack-form" variant="primary" disabled={crack.isPending}>Save password</Button>
        </>
      }
    >
      <form id="crack-form" onSubmit={submit} noValidate>
        <Field label="Plaintext" error={error}>
          <Input autoFocus mono type="password" autoComplete="off" value={plaintext} onChange={(e) => setPlaintext(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

const TAB_LABEL: Record<DockTab, string> = {
  crack: "Crack",
  test: "Test",
  shares: "Shares",
  spray: "Spray at usernames",
  roast: "Roast",
};

const TEST_STEPS: RoutineStepId[] = ["smb", "winrm", "rdp", "mssql", "ssh"];
const TAB_STEPS: Record<Exclude<DockTab, "crack">, RoutineStepId[]> = {
  test: TEST_STEPS,
  shares: ["shares"],
  spray: ["spray-users"],
  roast: ["roast"],
};

interface Props {
  eid: string;
  cred: Credential;
  tabs: DockTab[];
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
  usernames: Username[];
  /** The credentials as listed (cracked hashes folded). */
  creds: Credential[];
  onCracked?: (password: Credential) => void;
}

function CrackPane({ eid, cred, onCracked }: { eid: string; cred: Credential; onCracked?: (password: Credential) => void }) {
  const { setCrackStatus } = useCredentialMutations(eid);
  const [cracking, setCracking] = useState(false);
  const candidates = identifyHash(cred.secret, "windows");
  // The stored type wins over the top guess, so the command matches what the user chose.
  const cand = candidates.find((c) => c.name === cred.hashType) ?? candidates[0];
  const cmds = getCrackingCommands(cred.secret, cand);
  // The displayed command is built from the mask, never from the hash, so nothing can leak.
  const shown = getCrackingCommands(MASK, cand);
  const dead = cred.crackStatus === "uncrackable";
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[max-content_max-content_minmax(0,1fr)] items-center justify-start gap-2">
        <Button variant="primary" onClick={() => setCracking(true)}>Record plaintext</Button>
        {dead ? (
          <Button onClick={() => setCrackStatus.mutate({ id: cred.id, status: "uncracked" })}>Reset</Button>
        ) : (
          <Button onClick={() => setCrackStatus.mutate({ id: cred.id, status: "uncrackable" })}>Mark uncrackable</Button>
        )}
        <span className="text-meta text-muted">{cred.hashType ?? cand?.name ?? "unknown type"}</span>
      </div>
      {setCrackStatus.error && <p role="alert" className="m-0 text-meta text-warn">{setCrackStatus.error.message}</p>}
      {(cmds.hashcat || cmds.john) && (
        <div className="grid gap-1">
          {cmds.hashcat && <CommandBlock text={shown.hashcat ?? ""} copyText={cmds.hashcat} copyLabel="Copy hashcat command" />}
          {cmds.john && <CommandBlock text={cmds.john} copyText={cmds.john} copyLabel="Copy john command" />}
        </div>
      )}
      {cracking && <CrackDialog eid={eid} hash={cred} onClose={() => setCracking(false)} onCracked={onCracked} />}
    </div>
  );
}

export function DockWork({ eid, cred, tabs, hosts, servicesByHost, attempts, usernames, creds, onCracked }: Props) {
  const engagement = useEngagement(eid);
  const { byOwner } = useChecklist(eid);
  const { setStatus } = useChecklistMutations(eid);
  const [tab, setTab] = useState<DockTab>(tabs[0]);
  if (tabs.length === 0) return null;
  const active = tabs.includes(tab) ? tab : tabs[0];
  const state = byOwner.get(eid) ?? {};
  const domain = cred.domain || engagement.data?.domain || undefined;

  const commandsFor = (id: RoutineStepId, secretMask?: string): CommandSet & { usersFile?: string } => {
    const base = { cred, hosts, servicesByHost, attempts, domain, secretMask };
    switch (id) {
      case "shares":
        return buildTestCommands({ ...base, services: ["smb"], extraFlags: "--shares", teeSuffix: "shares", includeWorking: true });
      case "roast":
        return buildRoastCommands({ cred, hosts, servicesByHost, domain, secretMask });
      case "spray-users":
        return buildUsernameSprayCommands({ passwordCred: cred, usernames, hosts, servicesByHost, attempts, domain, credentials: creds, secretMask });
      default:
        return buildTestCommands({ ...base, services: [id as SprayService] });
    }
  };

  const steps = (t: Exclude<DockTab, "crack">) => (
    <ul className="m-0 list-none p-0">
      {TAB_STEPS[t].map((id) => {
        const step = ROUTINE_STEPS.find((s) => s.id === id)!;
        const applies = routineStepApplies(step.id, cred, hosts, servicesByHost, usernames);
        const done = state[step.itemId]?.status === "done";
        return (
          <li key={step.id} aria-label={step.title} className={`grid gap-1 border-b border-line py-2 ${applies ? "" : "opacity-50"}`}>
            <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3">
              <span className="text-body text-fg">
                {step.title}
                {!applies && <span className="ml-2 text-meta text-muted">Doesn't apply</span>}
              </span>
              <Button
                size="sm"
                variant={done ? "primary" : "ghost"}
                aria-pressed={done}
                aria-label={`Done: ${step.title}`}
                onClick={() => setStatus.mutate({ ownerId: eid, goalId: step.itemId, status: done ? "todo" : "done" })}
              >
                Done
              </Button>
            </div>
            {applies && <TestCommands set={commandsFor(step.id)} shown={commandsFor(step.id, MASK)} />}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Tabs value={active} onValueChange={(v) => setTab(v as DockTab)} className="min-w-0 grid-cols-[minmax(0,1fr)] content-start">
      <TabsList aria-label="Credential work">
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t}>{TAB_LABEL[t]}</TabsTrigger>
        ))}
      </TabsList>
      {setStatus.error && <p role="alert" className="m-0 text-meta text-warn">{setStatus.error.message}</p>}
      <TabsContent value={active} aria-label={TAB_LABEL[active]} className="min-w-0">
        {active === "crack" ? <CrackPane eid={eid} cred={cred} onCracked={onCracked} /> : steps(active)}
      </TabsContent>
    </Tabs>
  );
}
