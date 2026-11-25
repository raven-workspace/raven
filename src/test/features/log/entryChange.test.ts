// The entry change, through its one way in, on the checked in-browser fake (src/test/support/fakeStore.tsx): data is
// seeded through the store's own commands, an entry change goes in, and the checklist, board, Metasploit lock and
// summary are read back after.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logCommand } from "../../../features/capture/logCommand";
import { saveCapture, type CaptureEdits } from "../../../features/capture/saveCapture";
import { useSaveSummaryStore } from "../../../features/capture/useSaveSummaryStore";
import { CHECKLIST_FAILED, resetFirstOpens } from "../../../features/checklist/sync";
import { EntryChangeError, entryChanged, MSF_LOCK_FAILED, type EntryChange } from "../../../features/log/entryChange";
import { undoExtraction } from "../../../features/log/extractions";
import { onLockedError } from "../../../lib/lockSignal";
import type { EngagementKind } from "../../../types/engagement";
import { RavenError } from "../../../types/errors";
import type { Host } from "../../../types/host";
import type { ExtractionProofs, ExtractionSummary, LogEntry, LogEntryInput } from "../../../types/log";
import { fake, resetFake } from "../../support/fakeStore";

vi.mock("../../../lib/api", () => import("../../../audit/fakeApi"));

const FLAG = "0123456789abcdef0123456789abcdef";
const PSEXEC = "msfconsole -q -x 'use exploit/windows/smb/psexec; set RHOSTS 192.0.2.5; run'";
const SUMMARY: ExtractionSummary = { wins: ["Flag captured on web07"], counts: ["2 services updated on dc01"], ticks: [] };
const NO_PROOFS: ExtractionProofs = {
  createdHostIds: [], newHosts: [], scans: [], identity: null, credentials: [], cracks: [], usernames: [], intake: null, triedPairs: [], vectors: [],
};

const input = (over: Partial<LogEntryInput>): LogEntryInput => ({
  title: "note", ranOn: null, hostIds: [], observations: null, returnedNothing: false, private: false, content: { kind: "note", text: "body" }, ...over,
});
const flagOn = (host: Host) => input({ title: "local.txt", hostIds: [host.id], content: { kind: "flag", flagKind: "local", value: FLAG } });
const commandOn = (host: Host, command: string) => input({ title: command, hostIds: [host.id], content: { kind: "command", blocks: [{ command, output: "" }] } });

/** dc01 (192.0.2.5) and web07 (192.0.2.6), each with its board column already derived. */
async function seed(kind: EngagementKind = "lab") {
  const eng = await fake.engagementCreate({ name: "Lab Zz", kind, scopeCidrs: ["192.0.2.0/24"] });
  const dc01 = await fake.hostCreate(eng.id, { name: "dc01", ip: "192.0.2.5" });
  const web07 = await fake.hostCreate(eng.id, { name: "web07", ip: "192.0.2.6" });
  for (const h of [dc01, web07]) await fake.hostSyncBoard(h.id, "information-gathering");
  return { eng, dc01, web07 };
}

const qc = () => new QueryClient();
const change = (engagementId: string, c: EntryChange) => entryChanged({ qc: qc(), engagementId, change: c });
const saved = (entry: LogEntry, over: Partial<Extract<EntryChange, { change: "saved" }>> = {}): EntryChange =>
  ({ change: "saved", entry, filing: null, failures: [], ...over });
/** An entry stored with an (empty) extraction, as a capture save that filed something leaves it. */
async function filedEntry(engagementId: string, entryInput: LogEntryInput): Promise<LogEntry> {
  const entry = await fake.logCreate(engagementId, entryInput);
  await fake.extractionFile(engagementId, entry.id, NO_PROOFS);
  return entry;
}

const row = async (engagementId: string, ownerId: string, goalId: string) =>
  (await fake.checklistList(engagementId)).find((i) => i.ownerId === ownerId && i.goalId === goalId);
const column = async (engagementId: string, hostId: string) => (await fake.hostsList(engagementId)).find((h) => h.id === hostId)?.boardColumn;
const lock = async (engagementId: string) => (await fake.engagementGet(engagementId)).msfHostId;
const shown = () => useSaveSummaryStore.getState().current;

beforeEach(() => {
  resetFirstOpens();
  resetFake();
  useSaveSummaryStore.getState().close();
});
afterEach(() => useSaveSummaryStore.getState().close());

describe("an entry saved", () => {
  it("ticks the checklist, moves the board, stores and shows the summary", async () => {
    const { eng, web07 } = await seed();
    const entry = await filedEntry(eng.id, flagOn(web07));
    const result = await change(eng.id, saved(entry, { filing: { summary: SUMMARY, ticks: [] } }));
    expect(result).toEqual({ summary: SUMMARY });
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, evidence: [{ entryId: entry.id, commandId: "flag" }] });
    expect(await column(eng.id, web07.id)).toBe("privilege-escalation");
    expect((await fake.extractionGet(entry.id))?.summary).toEqual(SUMMARY);
    expect(shown()).toEqual({ entryId: entry.id, summary: SUMMARY });
  });

  it("exam sim: the first Metasploit entry locks Metasploit to its host; a later one elsewhere leaves it", async () => {
    const { eng, dc01, web07 } = await seed("exam-sim");
    await change(eng.id, saved(await fake.logCreate(eng.id, commandOn(dc01, PSEXEC))));
    expect(await lock(eng.id)).toBe(dc01.id);
    const later = "msfconsole -q -x 'use exploit/multi/http/tomcat_mgr_upload; set RHOSTS 192.0.2.6; run'";
    await change(eng.id, saved(await fake.logCreate(eng.id, commandOn(web07, later))));
    expect(await lock(eng.id)).toBe(dc01.id);
  });

  it("outside an exam sim a Metasploit entry locks nothing", async () => {
    const { eng, dc01 } = await seed("lab");
    await change(eng.id, saved(await fake.logCreate(eng.id, commandOn(dc01, PSEXEC))));
    expect(await lock(eng.id)).toBeNull();
  });
});

describe("a partial save", () => {
  it("runs every step, then throws one error with the first failure's message and the summary still shown", async () => {
    const { eng, dc01 } = await seed("exam-sim");
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    const entry = await filedEntry(eng.id, commandOn(dc01, PSEXEC));
    const error = await change(eng.id, saved(entry, { filing: { summary: SUMMARY, ticks: [] } })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryChangeError);
    expect(error).toMatchObject({ message: CHECKLIST_FAILED, entryId: entry.id, summary: SUMMARY });
    // The lock and the summary ran after the failed sync.
    expect(await lock(eng.id)).toBe(dc01.id);
    expect((await fake.extractionGet(entry.id))?.summary).toEqual(SUMMARY);
    expect(shown()).toEqual({ entryId: entry.id, summary: SUMMARY });
  });

  it("puts the save's own failures first, then a sentence for each step after", async () => {
    const { eng, dc01 } = await seed("exam-sim");
    vi.spyOn(fake, "engagementSetMsfHost").mockRejectedValue(new Error("db busy"));
    const filing = new Error("filing failed");
    const failures = [{ reason: filing, message: "Saved the entry, but Raven couldn't file what it found.", also: "" }];
    const error = await change(eng.id, saved(await fake.logCreate(eng.id, commandOn(dc01, PSEXEC)), { failures })).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: `Saved the entry, but Raven couldn't file what it found. ${MSF_LOCK_FAILED}`, reason: filing });
    expect((error as EntryChangeError).reasons).toHaveLength(2);
  });

  it("carries a locked vault's code and reaches the vault gate", async () => {
    const { eng, dc01 } = await seed();
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new RavenError("locked", "vault is locked"));
    const gate = vi.fn();
    const off = onLockedError(gate);
    const error = await change(eng.id, saved(await fake.logCreate(eng.id, flagOn(dc01)))).catch((e: unknown) => e);
    off();
    expect(error).toMatchObject({ code: "locked" });
    expect(gate).toHaveBeenCalled();
  });

  it("is the same from the capture form's save and from logging a command", async () => {
    const { eng, dc01 } = await seed();
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    const content = { kind: "command" as const, blocks: [{ command: "nmap -p- 192.0.2.5", output: "" }] };
    const edits: CaptureEdits = {
      kind: "command", title: "full scan", titleEdited: false, hostIds: [dc01.id], ranOn: "Kali (VM)", observations: "",
      returnedNothing: false, private: false, content,
    };
    const draft = { kind: "command" as const, title: "full scan", hostIds: [dc01.id], ranOn: "Kali (VM)", content, unknownScopeIps: [], scan: null };
    const fromForm = await saveCapture(qc(), { engagementId: eng.id, draft, edits, image: null, hosts: [dc01] }).catch((e: unknown) => e);
    const fromCopy = await logCommand(qc(), { engagementId: eng.id, host: dc01, hosts: [dc01], title: "full scan", command: "nmap -p- 192.0.2.5", ranOn: "Kali (VM)" })
      .catch((e: unknown) => e);
    for (const error of [fromForm, fromCopy]) {
      expect(error).toBeInstanceOf(EntryChangeError);
      expect(error).toMatchObject({ message: CHECKLIST_FAILED, summary: null });
    }
    // Both entries stay saved.
    expect(await fake.logList(eng.id)).toHaveLength(2);
  });
});

describe("an entry edited", () => {
  it("moves its tick and both cards, and locks Metasploit when it now uses it", async () => {
    const { eng, dc01, web07 } = await seed("exam-sim");
    const entry = await fake.logCreate(eng.id, flagOn(dc01));
    await change(eng.id, saved(entry));
    expect(await column(eng.id, dc01.id)).toBe("privilege-escalation");

    const moved = await fake.logUpdate(entry.id, flagOn(web07));
    await change(eng.id, { change: "edited", entry: moved });
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", evidence: [{ entryId: entry.id }] });
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "todo", evidence: [] });
    expect(await column(eng.id, web07.id)).toBe("privilege-escalation");
    expect(await column(eng.id, dc01.id)).toBe("information-gathering");

    expect(await lock(eng.id)).toBeNull();
    await change(eng.id, { change: "edited", entry: await fake.logUpdate(entry.id, commandOn(dc01, PSEXEC)) });
    expect(await lock(eng.id)).toBe(dc01.id);
  });

  it("a failed step throws the same error type as a save", async () => {
    const { eng, dc01 } = await seed();
    const entry = await fake.logCreate(eng.id, flagOn(dc01));
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    const error = await change(eng.id, { change: "edited", entry }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryChangeError);
    expect(error).toMatchObject({ message: CHECKLIST_FAILED, entryId: entry.id, summary: null });
    expect(shown()).toBeNull();
  });
});

describe("an entry deleted", () => {
  it("is gone with its ticks, the board follows and the Metasploit lock stays", async () => {
    const { eng, dc01, web07 } = await seed("exam-sim");
    const flag = await fake.logCreate(eng.id, flagOn(web07));
    await change(eng.id, saved(flag));
    const msf = await fake.logCreate(eng.id, commandOn(dc01, PSEXEC));
    await change(eng.id, saved(msf));

    await change(eng.id, { change: "deleted", id: flag.id });
    await change(eng.id, { change: "deleted", id: msf.id });
    expect(await fake.logList(eng.id)).toEqual([]);
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "todo", evidence: [] });
    expect(await column(eng.id, web07.id)).toBe("information-gathering");
    expect(await lock(eng.id)).toBe(dc01.id);
  });

  it("a failed delete keeps the entry and its ticks, with one error", async () => {
    const { eng, web07 } = await seed();
    const flag = await fake.logCreate(eng.id, flagOn(web07));
    await change(eng.id, saved(flag));
    vi.spyOn(fake, "logDelete").mockRejectedValue(new Error("disk full"));
    const error = await change(eng.id, { change: "deleted", id: flag.id }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntryChangeError);
    expect(error).toMatchObject({ message: "disk full", entryId: flag.id });
    expect(await fake.logList(eng.id)).toHaveLength(1);
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", evidence: [{ entryId: flag.id }] });
  });
});

describe("an extraction undone", () => {
  it("takes the entry's ticks off and runs the Metasploit lock again", async () => {
    const { eng, dc01, web07 } = await seed("exam-sim");
    // A save that ticked from its output, and whose lock failed.
    const entry = await filedEntry(eng.id, commandOn(dc01, PSEXEC));
    const outputTick = { ownerId: web07.id, goalId: "h-orient-proof", parser: "flag" };
    vi.spyOn(fake, "engagementSetMsfHost").mockRejectedValueOnce(new Error("db busy"));
    await change(eng.id, saved(entry, { filing: { summary: SUMMARY, ticks: [outputTick] } })).catch(() => undefined);
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", evidence: [{ entryId: entry.id }] });
    expect(await lock(eng.id)).toBeNull();

    await undoExtraction(qc(), entry.id);
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "todo", evidence: [] });
    expect(await column(eng.id, web07.id)).toBe("information-gathering");
    // The entry stays, and still used Metasploit on dc01.
    expect(await lock(eng.id)).toBe(dc01.id);
  });
});
