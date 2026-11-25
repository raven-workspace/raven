import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureDraft } from "../engines/capture";
import { IDENTITY_FAILED, saveCapture, type CaptureEdits } from "../features/capture/saveCapture";
import { EntryChangeError, EXTRACTION_FAILED } from "../features/log/entryChange";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { HostIdentity } from "../types/hostFacts";
import type { ExtractionProofs, LogEntry, LogEntryInput } from "../types/log";
import { filed } from "./features/capture/filed";
import { TEST_LIBRARY } from "./support/library";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1",
    ip: null,
    os: null,
    boardColumn: "information-gathering",
    boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
    access: "none",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const DC = host({ id: "h1", name: "dc01", ip: "10.10.10.5", access: "user" });
const PORTS = [
  { port: 22, protocol: "tcp" as const, state: "open", service: "ssh", version: "OpenSSH 8.9" },
  { port: 80, protocol: "tcp" as const, state: "open", service: "http", version: "Apache" },
];
const content = { kind: "command" as const, blocks: [{ command: "nmap -sV 10.10.10.5", output: "..." }] };

function draft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    kind: "command",
    title: "Scan · 10.10.10.5",
    hostIds: ["h1"],
    ranOn: "Kali (VM)",
    content,
    unknownScopeIps: [],
    scan: null,
    ...over,
  };
}

function edits(over: Partial<CaptureEdits> = {}): CaptureEdits {
  return {
    kind: "command",
    title: "Scan · 10.10.10.5",
    titleEdited: false,
    hostIds: ["h1"],
    ranOn: "Kali (VM)",
    observations: "",
    returnedNothing: false,
    private: false,
    content,
    ...over,
  };
}

function entry(input: LogEntryInput): LogEntry {
  return {
    id: "l1",
    engagementId: "e1",
    kind: input.content.kind,
    title: input.title,
    titleEdited: input.titleEdited ?? false,
    ranOn: input.ranOn,
    hostIds: input.hostIds,
    observations: input.observations,
    returnedNothing: input.returnedNothing,
    private: input.private,
    content: input.content,
    at: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** What the save gave the store to file (the first filing). */
const proofs = (): ExtractionProofs => m.extractionFile.mock.calls[0]![2];

beforeEach(() => {
  vi.resetAllMocks();
  m.logCreate.mockImplementation(async (_e, input) => entry(input));
  // The checklist follow-up reads the store after the entry saves.
  m.engagementGet.mockResolvedValue({ id: "e1", kind: "lab", domain: null, msfHostId: null } as Engagement);
  m.hostsList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.checklistApplyEntryTicks.mockResolvedValue([]);
  m.extractionFile.mockResolvedValue(filed());
});

describe("saveCapture", () => {
  it("saveCapture saves the entry; an unknown IP with nothing proven there makes no host", async () => {
    const saved = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ unknownScopeIps: ["10.10.10.7"] }),
      edits: edits({ observations: "  smb signing off  ", ranOn: "" }),
      image: null,
      hosts: [DC],
    });
    expect(m.hostCreate).not.toHaveBeenCalled();
    expect(m.logCreate).toHaveBeenCalledWith("e1", {
      title: "Scan · 10.10.10.5",
      titleEdited: false,
      ranOn: null,
      hostIds: ["h1"],
      observations: "smb signing off",
      returnedNothing: false,
      private: false,
      content,
      attachment: null,
    });
    expect(saved.entry.id).toBe("l1");
    // Nothing in the output was parsed: no summary, and nothing filed.
    expect(saved.summary).toBeNull();
    expect(m.extractionFile).not.toHaveBeenCalled();
  });

  it("a scan's open ports and OS go to the store after the entry; an unlinked scan host gets nothing", async () => {
    const order: string[] = [];
    m.logCreate.mockImplementation(async (_e, input) => {
      order.push("log");
      return entry(input);
    });
    m.extractionFile.mockImplementation(async () => {
      order.push("file");
      return filed();
    });
    await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: "linux" } }),
      edits: edits(),
      image: null,
      hosts: [DC],
    });
    expect(order).toEqual(["log", "file"]);
    expect(m.extractionFile).toHaveBeenCalledWith("e1", "l1", expect.anything());
    // The store fills the OS only for a host that has none.
    expect(proofs().scans).toEqual([{ hostId: "h1", ports: PORTS, os: "linux" }]);

    m.extractionFile.mockClear();
    await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: "linux" } }),
      edits: edits({ hostIds: [] }),
      image: null,
      hosts: [DC],
    });
    expect(m.extractionFile).not.toHaveBeenCalled();
  });

  it("first scan of a new box re-runs the draft with the created host", async () => {
    const order: string[] = [];
    m.hostCreate.mockImplementation(async (_e, input) => {
      order.push("host");
      return host({ id: "h9", name: input.name, ip: input.ip ?? null });
    });
    m.logCreate.mockImplementation(async (_e, input) => {
      order.push("log");
      return entry(input);
    });
    m.extractionFile.mockImplementation(async () => {
      order.push("file");
      return filed();
    });
    const text = [
      "kali@kali:~$ nmap -sCV -p 22,80 10.10.10.9",
      "Nmap scan report for 10.10.10.9",
      "PORT   STATE SERVICE VERSION",
      "22/tcp open  ssh     OpenSSH 8.9",
      "80/tcp open  http    Apache httpd 2.4.52",
      "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
    ].join("\n");
    const draftInput = {
      text,
      image: null,
      kind: "command" as const,
      hosts: [{ id: "h1", name: "dc01", ip: "10.10.10.5", column: "information-gathering" as const }],
      scope: ["10.10.10.0/24"],
      domain: "",
      machines: ["Kali (VM)"],
      lastRanOn: null,
      library: TEST_LIBRARY,
    };
    const created: string[] = [];
    await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ hostIds: [], scan: null, unknownScopeIps: ["10.10.10.9"] }),
      draftInput,
      edits: edits({ hostIds: [] }),
      image: null,
      hosts: [DC],
      onHostCreated: (h) => created.push(h.id),
    });
    expect(order).toEqual(["host", "log", "file"]);
    expect(created).toEqual(["h9"]);
    // The host the scan proved is this save's: Undo removes it with the services.
    expect(proofs().createdHostIds).toEqual(["h9"]);
    expect(proofs().scans).toEqual([
      {
        hostId: "h9",
        ports: [expect.objectContaining({ port: 22, service: "ssh" }), expect.objectContaining({ port: 80, service: "http" })],
        os: "linux",
      },
    ]);
  });

  it("a multi-host scan of new boxes makes each a host with only its own section", async () => {
    m.hostCreate.mockImplementation(async (_e, input) => host({ id: `h-${input.ip}`, name: input.name, ip: input.ip ?? null }));
    const text = [
      "kali@kali:~$ nmap -sV 10.10.10.9 10.10.10.8",
      "Nmap scan report for 10.10.10.9",
      "PORT   STATE SERVICE VERSION",
      "22/tcp open  ssh     OpenSSH 8.9",
      "",
      "Nmap scan report for 10.10.10.8",
      "PORT    STATE SERVICE       VERSION",
      "135/tcp open  msrpc         Microsoft Windows RPC",
      "Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows",
    ].join("\n");
    await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ hostIds: [], scan: null, unknownScopeIps: ["10.10.10.9", "10.10.10.8"] }),
      draftInput: {
        text,
        image: null,
        kind: "command",
        hosts: [{ id: "h1", name: "dc01", ip: "10.10.10.5", column: "information-gathering" }],
        scope: ["10.10.10.0/24"],
        domain: "",
        machines: ["Kali (VM)"],
        lastRanOn: null,
        library: TEST_LIBRARY,
      },
      edits: edits({ hostIds: [] }),
      image: null,
      hosts: [DC],
    });
    expect(proofs().scans.map((s) => [s.hostId, s.ports.map((p) => p.port)])).toEqual([
      ["h-10.10.10.9", [22]],
      ["h-10.10.10.8", [135]],
    ]);
    expect(m.logCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ hostIds: ["h-10.10.10.9", "h-10.10.10.8"] }));
  });

  it("only open ports are filed (M1)", async () => {
    const ports = [
      ...PORTS,
      { port: 25, protocol: "tcp" as const, state: "closed", service: "smtp", version: "" },
      { port: 161, protocol: "udp" as const, state: "open|filtered", service: "snmp", version: "" },
      { port: 445, protocol: "tcp" as const, state: "filtered", service: "microsoft-ds", version: "" },
    ];
    await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports, os: null } }),
      edits: edits(),
      image: null,
      hosts: [{ ...DC, os: "linux" }],
    });
    expect(proofs().scans[0]!.ports.map((p) => p.port)).toEqual([22, 80, 161]);
  });

  it("a filing failure still keeps the entry", async () => {
    m.extractionFile.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits(),
      image: { mime: "image/png", dataBase64: "AAAA" },
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ message: EXTRACTION_FAILED, entryId: "l1" });
    expect(m.logCreate).toHaveBeenCalledTimes(1);
    expect(m.logCreate.mock.calls[0]![1].attachment).toEqual({ mime: "image/png", dataBase64: "AAAA" });
    // Nothing was filed, so there is nothing to finish.
    expect(m.extractionFinish).not.toHaveBeenCalled();
  });

  it("filing and checklist both failing says both", async () => {
    m.extractionFile.mockRejectedValue(new Error("db busy"));
    m.checklistApplyEntryTicks.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits(),
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: `${EXTRACTION_FAILED} The checklist didn't update either: use Tick from log on the Engagement checklist.`,
      entryId: "l1",
    });
  });

  it("identity and filing both failing says both and carries every cause", async () => {
    const busy = new Error("db busy");
    const locked = new Error("locked");
    m.hostIdentityGet.mockRejectedValue(busy);
    m.extractionFile.mockRejectedValue(locked);
    const both = {
      kind: "command" as const,
      blocks: [
        { command: "id", output: "uid=1000(bob) gid=1000(bob) groups=1000(bob)" },
        { command: "nxc smb 10.10.10.5 -u bob -p 'Fake1'", output: "SMB  10.10.10.5  445  DC01  [+] corp\\bob:Fake1" },
      ],
    };
    const err = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ content: both }),
      edits: edits({ content: both, ranOn: "dc01" }),
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EntryChangeError);
    expect(err).toMatchObject({
      message: `${IDENTITY_FAILED} Raven couldn't file what it found either: paste the output again to retry.`,
      reason: busy,
      reasons: [busy, locked],
    });
  });

  it("a filing failure with a lock-only follow-up failure uses the lock's message", async () => {
    m.extractionFile.mockRejectedValue(new Error("db busy"));
    m.engagementGet.mockResolvedValue({ id: "e1", kind: "exam-sim", domain: null, msfHostId: null } as Engagement);
    m.hostsList.mockResolvedValue([DC]);
    m.engagementSetMsfHost.mockRejectedValue(new Error("db busy"));
    const err = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }),
      edits: edits({ content: { kind: "command", blocks: [{ command: "msfconsole -q -x 'use exploit/windows/smb/psexec; set RHOSTS 10.10.10.5'", output: "" }] } }),
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      message: `${EXTRACTION_FAILED} Saved the entry, but the Metasploit lock didn't update.`,
    });
  });

  it("checklist failure after the entry saved is a partial save carrying its cause", async () => {
    const cause = new Error("locked");
    m.checklistApplyEntryTicks.mockRejectedValue(cause);
    m.hostsList.mockResolvedValue([DC]);
    const err = await saveCapture(new QueryClient(), {
      engagementId: "e1",
      draft: draft(),
      edits: edits({ content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef" }, kind: "flag" }),
      image: null,
      hosts: [DC],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EntryChangeError);
    expect(err).toMatchObject({
      message: "Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist.",
      entryId: "l1",
      reason: cause,
    });
  });

  it("the summary and output ticks are stored after the board sync (R7)", async () => {
    m.hostsList.mockResolvedValue([DC]);
    m.extractionFile.mockResolvedValue(filed({ scans: [{ hostId: "h1", services: 2, osSet: false }] }));
    const saved = await saveCapture(new QueryClient(), { engagementId: "e1", draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }), edits: edits(), image: null, hosts: [DC] });
    expect(saved.summary?.counts).toEqual(["2 services updated on dc01"]);
    expect(m.extractionFinish).toHaveBeenCalledWith("l1", saved.summary, []);
    const last = (f: { mock: { invocationCallOrder: number[] } }) => Math.max(0, ...f.mock.invocationCallOrder);
    expect(m.extractionFinish.mock.invocationCallOrder[0]).toBeGreaterThan(last(m.checklistApplyCover));
    expect(m.extractionFile.mock.invocationCallOrder[0]).toBeLessThan(m.checklistApplyEntryTicks.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("a partial save carries the summary of what the store filed, and none when filing failed", async () => {
    m.checklistApplyEntryTicks.mockRejectedValue(new Error("locked"));
    m.extractionFile.mockResolvedValue(filed({ scans: [{ hostId: "h1", services: 2, osSet: false }] }));
    const run = () =>
      saveCapture(new QueryClient(), { engagementId: "e1", draft: draft({ scan: { hostId: "h1", ports: PORTS, os: null } }), edits: edits(), image: null, hosts: [DC] })
        .catch((e: unknown) => e);
    const err = await run();
    expect(err).toBeInstanceOf(EntryChangeError);
    expect((err as EntryChangeError).summary).toEqual(m.extractionFinish.mock.calls[0]![1]);
    expect((err as EntryChangeError).summary?.counts).toContain("2 services updated on dc01");

    // Filed but not finished: still undoable, so the summary still shows.
    m.extractionFinish.mockRejectedValue(new Error("db busy"));
    expect(((await run()) as EntryChangeError).summary?.counts).toContain("2 services updated on dc01");

    m.extractionFile.mockRejectedValue(new Error("db busy"));
    const err2 = await run();
    expect(err2).toBeInstanceOf(EntryChangeError);
    expect((err2 as EntryChangeError).summary).toBeNull();
  });

  describe("identity capture", () => {
    const priv = "PRIVILEGES INFORMATION\n----------------------\n\nPrivilege Name                Description                    State\n============================= ============================== ========\nSeImpersonatePrivilege        Impersonate a client after authentication Enabled\n";
    const run = (hostIds: string[], hosts: Host[]) => {
      const c = { kind: "command" as const, blocks: [{ command: "whoami /priv", output: priv }] };
      return saveCapture(new QueryClient(), {
        engagementId: "e1",
        draft: draft({ content: c, hostIds }),
        edits: edits({ content: c, hostIds, ranOn: "dc01" }),
        image: null,
        hosts,
      });
    };

    it("proves the identity and its auto vectors for a single linked host", async () => {
      m.hostIdentityGet.mockResolvedValue(null);
      await run(["h1"], [DC]);
      expect(proofs().identity).toEqual({ hostId: "h1", username: "unknown", privileges: expect.arrayContaining(["SeImpersonatePrivilege"]), groups: [] });
      expect(proofs().vectors).toEqual([{ hostId: "h1", title: "SeImpersonatePrivilege abuse" }]);
    });

    it("records privileges from an Evil-WinRM whoami /priv even when Ran on is Kali", async () => {
      m.hostIdentityGet.mockResolvedValue(null);
      const c = { kind: "command" as const, blocks: [{ command: "whoami /priv", output: priv, shell: "evil-winrm" }] };
      const win = host({ id: "h1", name: "srv13", os: "windows" });
      await saveCapture(new QueryClient(), {
        engagementId: "e1",
        draft: draft({ content: c }),
        edits: edits({ content: c, ranOn: "Kali (VM)" }),
        image: null,
        hosts: [win],
      });
      expect(proofs().identity).toMatchObject({ hostId: "h1", privileges: expect.arrayContaining(["SeImpersonatePrivilege"]) });
    });

    const groupsOut = "GROUP INFORMATION\n-----------------\n\nGroup Name   Type   SID   Attributes\n============ ====== ===== ==========\nBUILTIN\\Users   Alias   S-1-5-32-545   Enabled group\n";
    const capture = (command: string, output: string) => {
      const c = { kind: "command" as const, blocks: [{ command, output }] };
      return saveCapture(new QueryClient(), {
        engagementId: "e1",
        draft: draft({ content: c }),
        edits: edits({ content: c, ranOn: "dc01" }),
        image: null,
        hosts: [DC],
      });
    };
    /** hostIdentityGet returns whatever the last filing stored, like the real table. */
    const storeLikeTheDb = (initial: HostIdentity | null) => {
      let stored = initial;
      m.hostIdentityGet.mockImplementation(async () => stored);
      m.extractionFile.mockImplementation(async (_e, entryId, p) => {
        if (p.identity) stored = { ...p.identity, entryId, updatedAt: 2 };
        return filed();
      });
      return () => stored;
    };

    it("whoami /priv then whoami /groups keeps both the privileges and the groups", async () => {
      const stored = storeLikeTheDb(null);
      await capture("whoami /priv", priv);
      await capture("whoami /groups", groupsOut);
      expect(stored()).toMatchObject({ username: "unknown", privileges: ["SeImpersonatePrivilege"], groups: ["BUILTIN\\Users"] });
    });

    it("a flag capture whose proof holds id output proves the identity and keeps the proof as pasted", async () => {
      m.hostIdentityGet.mockResolvedValue(null);
      const paste = "# id\nuid=0(root) gid=0(root) groups=0(root)\n# cat /root/proof.txt\n44444444444444444444444444444444";
      const c = { kind: "flag" as const, flagKind: "proof" as const, value: "44444444444444444444444444444444", proof: paste };
      const srv11 = host({ id: "h1", name: "Srv11", os: "linux" });
      const saved = await saveCapture(new QueryClient(), {
        engagementId: "e1",
        draft: draft({ kind: "flag", content: c }),
        edits: edits({ kind: "flag", content: c, ranOn: "Srv11" }),
        image: null,
        hosts: [srv11],
      });
      expect(proofs().identity).toMatchObject({ hostId: "h1", username: "root" });
      expect(saved.entry.content).toEqual(c);
      expect(m.logCreate).toHaveBeenCalledWith("e1", expect.objectContaining({ content: expect.objectContaining({ proof: paste }) }));
    });

    it("a bare whoami changes only the username", async () => {
      const stored = storeLikeTheDb({ hostId: "h1", username: "unknown", privileges: ["SeImpersonatePrivilege"], groups: ["docker"], entryId: "l0", updatedAt: 1 });
      await capture("whoami", "dc01\\svc_web");
      expect(stored()).toMatchObject({ username: "dc01\\svc_web", privileges: ["SeImpersonatePrivilege"], groups: ["docker"] });
    });

    it("a hand edit keeps everything but its groups when whoami /groups is captured later", async () => {
      const stored = storeLikeTheDb({ hostId: "h1", username: "corp\\cora", privileges: ["SeBackupPrivilege"], groups: ["typed-by-hand"], entryId: null, updatedAt: 1 });
      await capture("whoami /groups", groupsOut);
      expect(stored()).toMatchObject({ username: "corp\\cora", privileges: ["SeBackupPrivilege"], groups: ["BUILTIN\\Users"] });
    });

    it("an identity changed by the save is in the summary", async () => {
      m.hostIdentityGet.mockResolvedValue(null);
      m.extractionFile.mockResolvedValue(filed({ identityChanged: true }));
      const saved = await run(["h1"], [DC]);
      expect(saved.summary?.counts).toEqual(["Identity updated on dc01"]);
    });

    it("a filing failure is reported as the extraction, not the identity", async () => {
      m.hostIdentityGet.mockResolvedValue(null);
      m.extractionFile.mockRejectedValue(new Error("db down"));
      const err = await run(["h1"], [DC]).catch((e) => e);
      expect(err).toBeInstanceOf(EntryChangeError);
      expect(err.message).toBe(EXTRACTION_FAILED);
      expect(err.entryId).toBe("l1");
    });

    it("proves nothing about who the user is with two linked hosts", async () => {
      await run(["h1", "h2"], [DC, host({ id: "h2", name: "ws01" })]);
      const p = m.extractionFile.mock.calls[0]?.[2];
      expect(p?.identity ?? null).toBeNull();
      expect(p?.vectors ?? []).toEqual([]);
      expect(m.hostIdentityGet).not.toHaveBeenCalled();
    });

    it("an identity read that fails is reported as the identity, and the rest is still filed", async () => {
      m.hostIdentityGet.mockRejectedValue(new Error("db down"));
      const c = {
        kind: "command" as const,
        blocks: [
          { command: "whoami /priv", output: priv },
          { command: "nxc smb 10.10.10.5 -u bob -p 'Fake1'", output: "SMB  10.10.10.5  445  DC01  [+] corp\\bob:Fake1" },
        ],
      };
      const err = await saveCapture(new QueryClient(), { engagementId: "e1", draft: draft({ content: c }), edits: edits({ content: c, ranOn: "dc01" }), image: null, hosts: [DC] })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EntryChangeError);
      expect(err.message).toBe(IDENTITY_FAILED);
      expect(proofs().identity).toBeNull();
      expect(proofs().intake?.credentials.map((x) => x.input.username)).toEqual(["bob"]);
    });
  });
});
