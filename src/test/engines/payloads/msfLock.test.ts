import { describe, expect, it } from "vitest";
import { msfLockLine } from "../../../engines/payloads/msfLock";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";

const met = MSFVENOM.find((d) => d.id === "msf-win-x64-met-staged")!;
const raw = MSFVENOM.find((d) => d.id === "msf-win-x64-shell-staged")!;
const hostName = (id: string) => (id === "h2" ? "dc01" : id);

describe("msfLockLine", () => {
  it("is null outside the exam", () => {
    expect(msfLockLine({ exam: false, def: met, hostId: "h1", msfHostId: "h2", hostName })).toBeNull();
  });
  it("is null for a raw staged shell in the exam", () => {
    expect(msfLockLine({ exam: true, def: raw, hostId: "h1", msfHostId: "h2", hostName })).toBeNull();
  });
  it("is null when Metasploit is locked to this host", () => {
    expect(msfLockLine({ exam: true, def: met, hostId: "h2", msfHostId: "h2", hostName })).toBeNull();
  });
  it("is an info line when nothing holds the lock", () => {
    expect(msfLockLine({ exam: true, def: met, hostId: "h1", msfHostId: null, hostName })).toEqual({
      text: "Using Metasploit here makes this your Metasploit machine", breach: false,
    });
  });
  it("is a breach when locked to another host", () => {
    expect(msfLockLine({ exam: true, def: met, hostId: "h1", msfHostId: "h2", hostName })).toEqual({
      text: "Metasploit is locked to dc01", breach: true,
    });
  });
});
