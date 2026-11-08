import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ROUTINE_STEPS,
  buildRoastCommands,
  buildTestCommands,
  buildUsernameSprayCommands,
  credLabel,
  isSprayable,
  routineStepApplies,
  type CommandSet,
  type RoutineStepId,
  type SprayService,
} from "../../engines/credentials";
import { api } from "../../lib/api";
import type { CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Select, Toggle, labelClass } from "../../ui";
import { useChecklist, useChecklistMutations } from "../checklist/queries";
import { MASK } from "./MaskedSecret";
import { TestCommands } from "./TestCommands";

interface Props {
  eid: string;
  hosts: Host[];
  /** The credentials as listed (cracked hashes folded). */
  creds: Credential[];
  usernames: Username[];
  attempts: CredAttempt[];
  servicesByHost: Map<string, Service[]>;
}

export function RoutineSection({ eid, hosts, creds, usernames, attempts, servicesByHost }: Props) {
  const engagement = useQuery({ queryKey: ["engagement", eid], queryFn: () => api.engagementGet(eid) });
  const { byOwner } = useChecklist(eid);
  const { setStatus } = useChecklistMutations(eid);
  const [picked, setPicked] = useState<string>();

  const sprayable = useMemo(() => creds.filter(isSprayable), [creds]);
  const newest = useMemo(() => [...sprayable].sort((a, b) => b.createdAt - a.createdAt), [sprayable]);
  const fallback = useMemo(
    () =>
      (newest.find((c) => buildTestCommands({ cred: c, hosts, servicesByHost, attempts }).commands.length > 0) ?? newest[0])?.id,
    [newest, hosts, servicesByHost, attempts],
  );
  const cred = sprayable.find((c) => c.id === picked) ?? sprayable.find((c) => c.id === fallback);
  const state = byOwner.get(eid) ?? {};

  if (!cred) {
    return (
      <section aria-label="Credential routine" className="grid gap-1">
        <h3 className={`m-0 ${labelClass}`}>Credential routine</h3>
        <p className="m-0 text-meta text-muted">No sprayable credentials yet.</p>
      </section>
    );
  }

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

  return (
    <section aria-label="Credential routine" className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3">
        <h3 className={`m-0 ${labelClass}`}>Credential routine</h3>
        <Select
          aria-label="Routine credential"
          className="h-7 w-auto min-w-48 text-body"
          value={cred.id}
          onValueChange={setPicked}
          options={newest.map((c) => ({ value: c.id, label: credLabel(c) }))}
        />
      </div>
      {setStatus.error && <p role="alert" className="m-0 text-meta text-warn">{setStatus.error.message}</p>}
      <ul className="m-0 list-none border-t border-line p-0">
        {ROUTINE_STEPS.map((step) => {
          const applies = routineStepApplies(step.id, cred, hosts, servicesByHost, usernames);
          const done = state[step.itemId]?.status === "done";
          return (
            <li
              key={step.id}
              aria-label={step.title}
              className={`grid gap-1 border-b border-line py-2 ${applies ? "" : "opacity-50"}`}
            >
              <div className="grid grid-cols-[max-content_max-content_max-content] items-center justify-start gap-2">
                <Toggle
                  on={done}
                  onChange={(on) => setStatus.mutate({ ownerId: eid, goalId: step.itemId, status: on ? "done" : "todo" })}
                  aria-label={`Done: ${step.title}`}
                >
                  Done
                </Toggle>
                <span className="text-body text-fg">{step.title}</span>
                {!applies && <span className="text-meta text-muted">Doesn't apply</span>}
              </div>
              {applies && <TestCommands set={commandsFor(step.id)} shown={commandsFor(step.id, MASK)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
