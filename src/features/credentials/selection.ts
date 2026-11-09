import {
  buildTestCommands,
  isMachineAccount,
  isSprayable,
  routineStepApplies,
} from "../../engines/credentials";
import type { CredAttempt, Credential, Username } from "../../types/credentials";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";

export type DockTab = "crack" | "test" | "shares" | "spray" | "roast";

interface SelectionCtx {
  hosts: Host[];
  servicesByHost: Map<string, Service[]>;
  attempts: CredAttempt[];
}

const newestFirst = (creds: Credential[]) => [...creds].sort((a, b) => b.createdAt - a.createdAt);

/** Newest sprayable credential that still has commands to run; else newest sprayable; else newest of any kind. */
export function defaultCredentialId(creds: Credential[], ctx: SelectionCtx): string | undefined {
  const sprayable = newestFirst(creds.filter(isSprayable));
  const withCommands = sprayable.find(
    (cred) => buildTestCommands({ cred, hosts: ctx.hosts, servicesByHost: ctx.servicesByHost, attempts: ctx.attempts }).commands.length > 0,
  );
  return (withCommands ?? sprayable[0] ?? newestFirst(creds)[0])?.id;
}

export function resolveSelection(requested: string | null, creds: Credential[], ctx: SelectionCtx): string | undefined {
  if (requested && creds.some((c) => c.id === requested)) return requested;
  return defaultCredentialId(creds, ctx);
}

export function dockTabs(
  cred: Credential,
  ctx: { hosts: Host[]; servicesByHost: Map<string, Service[]>; usernames: Username[] },
): DockTab[] {
  const crackable = cred.type === "hash" && !isMachineAccount(cred);
  const tabs: DockTab[] = [];
  if (crackable && cred.crackStatus !== "uncrackable") tabs.push("crack");
  if (isSprayable(cred)) {
    const applies = (step: "spray-users" | "roast") => routineStepApplies(step, cred, ctx.hosts, ctx.servicesByHost, ctx.usernames);
    tabs.push("test", "shares");
    if (applies("spray-users")) tabs.push("spray");
    if (applies("roast")) tabs.push("roast");
  }
  if (crackable && cred.crackStatus === "uncrackable") tabs.push("crack");
  return tabs;
}
