import { describe, it, expect } from "vitest";
import {
  buildTestCommands, buildRoastCommands, buildUsernameSprayCommands, routineStepApplies,
} from "../../../engines/credentials/commands";
import { byHost, cred as baseCred, hostWith, user } from "./fixtures";
import type { Credential } from "../../../types/credentials";

const cred = (extra: Partial<Credential> = {}): Credential =>
  baseCred({ id: "cS", username: "", secret: "Winter2026!", ...extra });
const H = hostWith("h1", "10.0.0.5", [445, 389]);
const HOSTS = [H.host];
const SBH = byHost(H);
const NT = "c33b5cf9c33b5cf9c33b5cf9c33b5cf9";

describe("half-credentials: owner-less secrets", () => {
  it("owner-less password sprays at users.txt", () => {
    const r = buildUsernameSprayCommands({ passwordCred: cred(), usernames: [user("u1", "alice")], hosts: HOSTS, servicesByHost: SBH, attempts: [] });
    expect(r.usersFile).toBe("alice");
    expect(r.commands[0].command).toContain("-u users.txt -p 'Winter2026!'");
    expect(routineStepApplies("spray-users", cred(), HOSTS, SBH, [user("u1", "alice")])).toBe(true);
  });

  it("owner-less NTLM hash sprays with -H", () => {
    const h = cred({ type: "hash", secret: NT, hashType: "NTLM" });
    const r = buildUsernameSprayCommands({ passwordCred: h, usernames: [user("u1", "alice")], hosts: HOSTS, servicesByHost: SBH, attempts: [] });
    expect(r.commands[0].command).toContain(`-u users.txt -H '${NT}'`);
    expect(routineStepApplies("spray-users", h, HOSTS, SBH, [user("u1", "alice")])).toBe(true);
    // a named user's hash still is not sprayed
    expect(buildUsernameSprayCommands({ passwordCred: { ...h, username: "bob" }, usernames: [user("u1", "alice")], hosts: HOSTS, servicesByHost: SBH, attempts: [] }).notice).toBe("not-sprayable");
  });

  it("owner-less secrets get no direct test commands", () => {
    expect(buildTestCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH, attempts: [] }).notice).toBe("not-sprayable");
    expect(buildRoastCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH }).notice).toBe("not-sprayable");
    for (const step of ["smb", "shares", "roast"] as const) {
      expect(routineStepApplies(step, cred(), HOSTS, SBH, [user("u1", "a")])).toBe(false);
    }
  });
});
