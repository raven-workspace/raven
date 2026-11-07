import { describe, expect, it } from "vitest";
import { splitPaste } from "../../../engines/parse/logPaste";
import { identityFromLog } from "../../../features/hosts/facts/identityFromLog";
import type { Host } from "../../../types/host";
import type { CommandBlock, LogEntry } from "../../../types/log";

const MS02 = { id: "h2", name: "MS02" } as Host;
const PROMPT = "*Evil-WinRM* PS C:\\Users\\sam.rivera\\Documents>";

const PRIV = `${PROMPT} whoami /priv

PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                               State
============================= ========================================= =======
SeMachineAccountPrivilege     Add workstations to domain                Enabled
SeImpersonatePrivilege        Impersonate a client after authentication Enabled
SeChangeNotifyPrivilege       Bypass traverse checking                  Enabled`;

const GROUPS = `${PROMPT} whoami /groups

GROUP INFORMATION
-----------------

Group Name                           Type             SID          Attributes
==================================== ================ ============ ==================================================
Everyone                             Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group
BUILTIN\\Remote Management Users      Alias            S-1-5-32-580 Mandatory group, Enabled by default, Enabled group`;

const entry = (id: string, blocks: CommandBlock[], over: Partial<LogEntry> = {}): LogEntry => ({
  id, engagementId: "e1", kind: "command", title: id, titleEdited: false, ranOn: "MS02", hostIds: ["h2"], observations: null,
  returnedNothing: false, private: false, content: { kind: "command", blocks }, at: 1000, createdAt: 1000, updatedAt: 1000, ...over,
});

describe("identityFromLog", () => {
  it("reads privileges and groups from separately logged Evil-WinRM whoami entries", () => {
    const priv = entry("l1", splitPaste(PRIV), { at: 1000 });
    const groups = entry("l2", splitPaste(GROUPS), { at: 2000 });
    const r = identityFromLog([priv, groups], MS02);
    expect(r.sources).toBe(2);
    expect(r.identity?.privileges).toContain("SeImpersonatePrivilege");
    expect(r.identity?.groups).toContain("BUILTIN\\Remote Management Users");
    expect(r.identity?.username).toBeNull();
    expect(r.identity?.entryId).toBe("l2");
  });

  it("takes the newest username and the newest entry of each kind", () => {
    const old = entry("l1", [{ command: "whoami", output: "ms02\\old" }], { at: 1 });
    const mid = entry("l2", splitPaste(PRIV), { at: 2 });
    const stale = entry("l3", [{ command: "whoami /priv", output: "SeDebugPrivilege  x  Enabled" }], { at: 1 });
    const now = entry("l4", [{ command: "whoami", output: "ms02\\new" }], { at: 3 });
    const r = identityFromLog([old, mid, stale, now], MS02);
    expect(r.identity?.username).toBe("ms02\\new");
    expect(r.identity?.privileges).not.toContain("SeDebugPrivilege");
    expect(r.identity?.privileges).toContain("SeImpersonatePrivilege");
    // The older whoami and the stale /priv add nothing the newer entries do not already say.
    expect(r.sources).toBe(2);
  });

  it("ignores entries linked to two hosts or run on another machine", () => {
    const two = entry("l1", splitPaste(PRIV), { hostIds: ["h2", "h3"] });
    const other = entry("l2", splitPaste(GROUPS), { ranOn: "Kali (VM)" });
    expect(identityFromLog([two, other], MS02)).toEqual({ identity: null, sources: 0 });
  });

  it("ignores error output", () => {
    const bad = entry("l1", [{ command: "whoami", output: "'whoami' is not recognized as an internal or external command," }]);
    expect(identityFromLog([bad], MS02)).toEqual({ identity: null, sources: 0 });
  });
});
