// The checklist sync, through its one way in, on the checked in-browser fake (src/test/support/fakeStore.tsx): data is
// seeded through the store's own commands, the store change goes in through the app (or `syncChecklist`), and the
// checklist and board are read back from the store.
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applicableGoals, ticksForEntry } from "../engines/checklist";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useChecklist, useChecklistMutations } from "../features/checklist/queries";
import { ChecklistSyncError, resetFirstOpens, syncChecklist, type SyncChange } from "../features/checklist/sync";
import { loadTickContext } from "../features/checklist/ticks";
import { useHosts } from "../features/hosts/queries";
import { useServiceMutations } from "../features/services/queries";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem, ChecklistItemInput } from "../types/checklist";
import type { EngagementKind } from "../types/engagement";
import { RavenError } from "../types/errors";
import type { Host } from "../types/host";
import type { LogEntryInput } from "../types/log";
import { fake, renderApp, resetFake } from "./support/fakeStore";

vi.mock("../lib/api", () => import("../audit/fakeApi"));

const T = new Date(2026, 10, 4, 9, 5).getTime();
const FULL_SCAN = "nmap -p- 192.0.2.5";
const FLAG = "0123456789abcdef0123456789abcdef";
const FLAG_PASTE = `whoami; hostname; ip a\nweb07\n    inet 192.0.2.6/24 brd 192.0.2.255 scope global ens3\ncat /home/web/local.txt\n${FLAG}`;

const entryInput = (over: Partial<LogEntryInput> = {}): LogEntryInput => ({
  title: "note", ranOn: null, hostIds: [], observations: null, returnedNothing: false, private: false, content: { kind: "note", text: "body" }, ...over,
});
const flagInput = (title: string, hostIds: string[], at?: number): LogEntryInput =>
  entryInput({ title, hostIds, content: { kind: "flag", flagKind: "local", value: FLAG }, ...(at ? { at } : {}) });
const scanInput = (at?: number): LogEntryInput =>
  entryInput({ title: "full scan", content: { kind: "command", blocks: [{ command: FULL_SCAN, output: "" }] }, ...(at ? { at } : {}) });

interface Seeded {
  eng: { id: string };
  dc01: Host;
  web07: Host;
}

/**
 * A lab with dc01 (192.0.2.5) and web07 (192.0.2.6). `synced`: each host's board column already derived (as any host
 * the app has synced once), so a sync moves only what it changes.
 */
async function seed(opts: { kind?: EngagementKind; synced?: boolean; os?: Host["os"] } = {}): Promise<Seeded> {
  const eng = await fake.engagementCreate({ name: "Lab A", kind: opts.kind ?? "lab", scopeCidrs: ["192.0.2.0/24"] });
  const dc01 = await fake.hostCreate(eng.id, { name: "dc01", ip: "192.0.2.5", os: opts.os ?? null });
  const web07 = await fake.hostCreate(eng.id, { name: "web07", ip: "192.0.2.6" });
  if (opts.synced ?? true) for (const h of [dc01, web07]) await fake.hostSyncBoard(h.id, "information-gathering");
  return { eng, dc01, web07 };
}

const put = (engagementId: string, ...items: ChecklistItemInput[]) => fake.checklistPut(engagementId, items);
const row = async (engagementId: string, ownerId: string, goalId: string): Promise<ChecklistItem | undefined> =>
  (await fake.checklistList(engagementId)).find((i) => i.ownerId === ownerId && i.goalId === goalId);
const hostOf = async (engagementId: string, id: string) => (await fake.hostsList(engagementId)).find((h) => h.id === id)!;
const sync = (engagementId: string, change: SyncChange) => syncChecklist({ engagementId, change });

async function openCapture(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("navigation", { name: "Engagement" });
  await screen.findAllByText("dc01");
  await user.keyboard("l");
  return screen.findByRole("dialog", { name: "Add to log" });
}

const saveCapture = (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Meta>}{Enter}{/Meta}");

const log = () => within(screen.getByRole("region", { name: "Log" }));

async function openEntry(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  await user.click(await screen.findByRole("button", { name: title }));
}

async function deleteOpenEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(log().getByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete entry" }));
}

beforeEach(() => {
  localStorage.clear();
  useCaptureStore.getState().reset();
  resetFirstOpens();
  resetFake();
});

describe("an entry saved or edited", () => {
  it("saving a full nmap scan ticks h-enum-full-tcp on the host with the entry as evidence", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    renderApp(`/e/${eng.id}`);
    await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    await waitFor(async () => expect(await fake.logList(eng.id)).toHaveLength(1));
    const [saved] = await fake.logList(eng.id);
    await waitFor(async () =>
      expect(await row(eng.id, dc01.id, "h-enum-full-tcp")).toMatchObject({
        status: "done", auto: true, autoFrom: null, statusManual: false, evidence: [{ entryId: saved!.id, commandId: expect.any(String) }],
      }),
    );
  });

  it("editing the entry to a different host moves the tick and both cards", async () => {
    const user = userEvent.setup();
    const { eng, dc01, web07 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    await fake.hostSyncBoard(dc01.id, "privilege-escalation");
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove dc01" }));
    await user.click(screen.getByRole("combobox", { name: "Link a host" }));
    await user.click(await screen.findByRole("option", { name: /web07/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] }));
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "todo", completedAt: null, auto: false, evidence: [] });
    await waitFor(async () => expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "privilege-escalation" }));
    expect(await hostOf(eng.id, dc01.id)).toMatchObject({ boardColumn: "information-gathering" });
  });

  it("a local.txt flag ticks h-orient-proof and the host moves to Privesc", async () => {
    const user = userEvent.setup();
    const { eng, web07 } = await seed();
    renderApp(`/e/${eng.id}`);
    const dialog = await openCapture(user);
    await user.paste(FLAG_PASTE);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("local.txt");
    await saveCapture(user);
    await waitFor(async () => expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "privilege-escalation", boardDerived: "privilege-escalation" }));
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, evidence: [{ commandId: "flag" }] });
  });

  it("a hand-placed card is not moved by a save that does not change the derived column", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    await fake.hostMove(dc01.id, "post-exploitation");
    renderApp(`/e/${eng.id}`);
    await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    await waitFor(async () => expect((await row(eng.id, dc01.id, "h-enum-full-tcp"))?.status).toBe("done"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await hostOf(eng.id, dc01.id)).toMatchObject({ boardColumn: "post-exploitation", boardManual: true, boardDerived: "information-gathering" });
  });

  it('exam-sim: first "use exploit/…" entry locks Metasploit to its host; a later one on another host shows the warning', async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed({ kind: "exam-sim" });
    renderApp(`/e/${eng.id}`);
    let dialog = await openCapture(user);
    await user.paste("kali@kali:~$ msfconsole -q -x 'use exploit/windows/smb/psexec; set RHOSTS 192.0.2.5; run'");
    expect(within(dialog).queryByText(/Metasploit is already locked/)).toBeNull();
    await saveCapture(user);
    await waitFor(async () => expect((await fake.engagementGet(eng.id)).msfHostId).toBe(dc01.id));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openCapture(user);
    await user.paste("kali@kali:~$ msfconsole -q -x 'use exploit/multi/http/tomcat_mgr_upload; set RHOSTS 192.0.2.6; run'");
    const warning = await within(dialog).findByText(
      "Metasploit is already locked to another host on this engagement. This entry uses it on a different host.",
    );
    expect(warning).toHaveClass("capture-form__warning");
    // Saving is still allowed, and the lock stays where it is.
    await saveCapture(user);
    await waitFor(async () => expect(await fake.logList(eng.id)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await fake.engagementGet(eng.id)).msfHostId).toBe(dc01.id);
  });

  it("a checklist write failure shows the Tick from log message and the entry stays saved", async () => {
    const user = userEvent.setup();
    const { eng } = await seed();
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    renderApp(`/e/${eng.id}`);
    const dialog = await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    expect(
      await within(dialog).findByText("Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist."),
    ).toBeInTheDocument();
    expect(await fake.logList(eng.id)).toHaveLength(1);
    // The draft is gone, so Save does not create the entry twice.
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("a board-only failure on save says the board didn't update, and the checklist was still written", async () => {
    const user = userEvent.setup();
    const { eng, web07 } = await seed();
    renderApp(`/e/${eng.id}`);
    const dialog = await openCapture(user);
    vi.spyOn(fake, "hostSyncBoard").mockRejectedValue(new Error("board busy"));
    await user.paste(FLAG_PASTE);
    await saveCapture(user);
    expect(
      await within(dialog).findByText("Saved the entry, but the board didn't update. Use Tick from log on the Engagement checklist."),
    ).toBeInTheDocument();
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true });
  });

  it("a log edit whose checklist write fails says so", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist."),
    ).toBeInTheDocument();
  });

  it("never overwrites a status set by hand while the entry's ticks were worked out", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    await user.click(log().getByRole("button", { name: "Edit" }));
    // While the sync works out the entry's ticks, the user marks the goal Done by hand.
    const get = fake.extractionGet.bind(fake);
    vi.spyOn(fake, "extractionGet").mockImplementation(async (id) => {
      await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 7, auto: false, statusManual: true });
      return get(id);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await row(eng.id, dc01.id, "h-orient-proof"))?.evidence).toHaveLength(1));
    // The entry's evidence is linked; the Done set by hand keeps its time and stays manual.
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "done", completedAt: 7, auto: false, statusManual: true });
  });

  it("an edit unticks every owner holding evidence from the entry, even when it now ticks nothing", async () => {
    const { eng, dc01, web07 } = await seed();
    // The flag was on both hosts; it becomes a note.
    const f1 = await fake.logCreate(eng.id, entryInput({ title: "was a flag", hostIds: [dc01.id, web07.id] }));
    await put(
      eng.id,
      { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] },
      { ownerId: web07.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }, { entryId: "f2", commandId: "flag" }] },
    );
    await sync(eng.id, { entity: "logEntry", id: f1.id, change: "updated", entry: f1 });
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "todo", auto: false, evidence: [], completedAt: null });
    // web07 keeps its other evidence and its completion time.
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: 50, evidence: [{ entryId: "f2", commandId: "flag" }] });
  });

  it("an edit that changes nothing leaves the checklist and the board as they were", async () => {
    const { eng, dc01 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    await fake.hostSyncBoard(dc01.id, "privilege-escalation");
    const before = await fake.checklistList(eng.id);
    const boards = vi.spyOn(fake, "hostSyncBoard");
    await sync(eng.id, { entity: "logEntry", id: f1.id, change: "updated", entry: f1 });
    expect(await fake.checklistList(eng.id)).toEqual(before);
    expect(boards).not.toHaveBeenCalled();
  });

  it("a new save stamps completedAt with the time of the save, not the entry's time (F-R2)", async () => {
    const { eng, web07 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt", [web07.id], T));
    const now = T + 99_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    await sync(eng.id, { entity: "logEntry", id: f1.id, change: "saved", entry: f1, outputTicks: [] });
    expect((await row(eng.id, web07.id, "h-orient-proof"))!.completedAt).toBe(now);
  });

  it("a scan capture ticks OS identified and every port identified straight after saving", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    renderApp(`/e/${eng.id}`);
    await openCapture(user);
    await user.paste(
      [
        "kali@kali:~$ nmap -sCV -p 22,80 192.0.2.5",
        "Nmap scan report for 192.0.2.5",
        "PORT   STATE SERVICE VERSION",
        "22/tcp open  ssh     OpenSSH 8.9",
        "80/tcp open  http    Apache httpd 2.4.52",
        "Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel",
      ].join("\n"),
    );
    await saveCapture(user);
    await waitFor(async () => expect(await row(eng.id, dc01.id, "h-enum-os")).toMatchObject({ status: "done", auto: true, evidence: [] }));
    expect(await row(eng.id, dc01.id, "h-enum-identified")).toMatchObject({ status: "done", auto: true, evidence: [] });
  });
});

describe("an entry deleted", () => {
  it("removes its evidence and restores the prior status; a hand tick is untouched", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    const s1 = await fake.logCreate(eng.id, scanInput());
    await put(
      eng.id,
      { ownerId: dc01.id, goalId: "h-enum-full-tcp", status: "done", completedAt: 50, auto: true, autoFrom: "in_progress", notes: "slow over VPN", evidence: [{ entryId: s1.id, commandId: "enum-nmap-full-tcp" }] },
      { ownerId: dc01.id, goalId: "h-enum-udp", status: "done", completedAt: 40, notes: "manual" },
    );
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /full scan/);
    await deleteOpenEntry(user);
    await waitFor(async () => expect(await fake.logList(eng.id)).toEqual([]));
    expect(await row(eng.id, dc01.id, "h-enum-full-tcp")).toMatchObject({
      status: "in_progress", notes: "slow over VPN", completedAt: null, auto: false, autoFrom: null, statusManual: false, evidence: [],
    });
    expect(await row(eng.id, dc01.id, "h-enum-udp")).toMatchObject({ status: "done", completedAt: 40, notes: "manual" });
  });

  it("runs the fact ticks, so OS identified comes back as a fact once the entry's tick goes", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed({ os: "linux" });
    const s1 = await fake.logCreate(eng.id, entryInput({ title: "os banner", hostIds: [dc01.id] }));
    // The entry ticked OS identified; the OS is now also a fact of the host.
    await put(eng.id, { ownerId: dc01.id, goalId: "h-enum-os", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: s1.id, commandId: "x" }] });
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /os banner/);
    await deleteOpenEntry(user);
    await waitFor(async () => expect(await fake.logList(eng.id)).toEqual([]));
    await waitFor(async () => expect(await row(eng.id, dc01.id, "h-enum-os")).toMatchObject({ status: "done", auto: true, evidence: [] }));
  });

  it("never overwrites a status set by hand after the sync read the checklist", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    // Between the sync's read and its write, the user sets the goal to In progress by hand.
    const list = fake.checklistList.bind(fake);
    let armed = false;
    vi.spyOn(fake, "checklistList").mockImplementation(async (id) => {
      const items = await list(id);
      if (armed) {
        armed = false;
        await put(id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "in_progress", auto: false, statusManual: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
      }
      return items;
    });
    armed = true;
    await deleteOpenEntry(user);
    await waitFor(async () => expect(await fake.logList(eng.id)).toEqual([]));
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "in_progress", statusManual: true, evidence: [] });
  });

  it("a delete whose checklist write fails keeps the entry and shows why", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValue(new Error("disk full"));
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    await deleteOpenEntry(user);
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    expect(await fake.logList(eng.id)).toHaveLength(1);
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "done", evidence: [{ entryId: f1.id }] });
  });

  it("a delete that fails after unticking puts the ticks and the board back", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    await fake.hostSyncBoard(dc01.id, "privilege-escalation");
    vi.spyOn(fake, "logDelete").mockRejectedValue(new Error("db busy"));
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    await deleteOpenEntry(user);
    expect(await screen.findByText("db busy")).toBeInTheDocument();
    expect(await fake.logList(eng.id)).toHaveLength(1);
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: 50, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    expect(await hostOf(eng.id, dc01.id)).toMatchObject({ boardColumn: "privilege-escalation", boardDerived: "privilege-escalation" });
  });

  it("a board sync that fails during a delete keeps the entry, puts the ticks back and shows why", async () => {
    const user = userEvent.setup();
    const { eng, dc01 } = await seed();
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt · dc01", [dc01.id]));
    await put(eng.id, { ownerId: dc01.id, goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: f1.id, commandId: "flag" }] });
    await fake.hostSyncBoard(dc01.id, "privilege-escalation");
    renderApp(`/e/${eng.id}/s/log`);
    await openEntry(user, /local.txt · dc01/);
    vi.spyOn(fake, "hostSyncBoard").mockRejectedValue(new Error("board busy"));
    await deleteOpenEntry(user);
    expect(await screen.findByText("board busy")).toBeInTheDocument();
    expect(await fake.logList(eng.id)).toHaveLength(1);
    expect(await row(eng.id, dc01.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: 50, evidence: [{ entryId: f1.id, commandId: "flag" }] });
  });
});

describe("first open of an engagement logged before step 3 (F-R1)", () => {
  it("a log with a full nmap scan and an empty checklist is ticked from the log on open, once", async () => {
    const { eng, dc01 } = await seed();
    const s1 = await fake.logCreate(eng.id, scanInput(T));
    const ticks = vi.spyOn(fake, "checklistApplyEntryTicks");
    const first = renderApp(`/e/${eng.id}`);
    await waitFor(async () => expect(await row(eng.id, dc01.id, "h-enum-full-tcp")).toMatchObject({ status: "done", auto: true, completedAt: T }));
    expect((await row(eng.id, dc01.id, "h-enum-full-tcp"))!.evidence).toEqual([{ entryId: s1.id, commandId: expect.any(String) }]);
    // Once: a second open does not rebuild again.
    first.unmount();
    renderApp(`/e/${eng.id}`);
    await screen.findAllByText("dc01");
    expect(ticks).toHaveBeenCalledTimes(1);
  });

  it("does nothing from the log when the checklist already has rows", async () => {
    const { eng, web07 } = await seed();
    await fake.logCreate(eng.id, scanInput(T));
    await put(eng.id, { ownerId: web07.id, goalId: "h-enum-udp", status: "na" });
    const ticks = vi.spyOn(fake, "checklistApplyEntryTicks");
    const logRead = vi.spyOn(fake, "logList");
    renderApp(`/e/${eng.id}`);
    await screen.findAllByText("dc01");
    await waitFor(() => expect(logRead).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(ticks).not.toHaveBeenCalled();
  });

  it("a failure is not blocking and the next open tries again", async () => {
    const { eng, dc01 } = await seed();
    await fake.logCreate(eng.id, scanInput(T));
    const ticks = vi.spyOn(fake, "checklistApplyEntryTicks").mockRejectedValueOnce(new Error("db busy"));
    const first = renderApp(`/e/${eng.id}`);
    await waitFor(() => expect(ticks).toHaveBeenCalledTimes(1));
    await screen.findAllByText("dc01");
    expect(screen.queryByRole("alert")).toBeNull();
    first.unmount();
    renderApp(`/e/${eng.id}`);
    await waitFor(async () => expect(await row(eng.id, dc01.id, "h-enum-full-tcp")).toMatchObject({ status: "done" }));
  });

  it("a v2 hand-placed card (manual, no derived column) keeps its column; its local.txt flag ticks the checklist", async () => {
    const { eng, web07 } = await seed({ synced: false });
    await fake.hostMove(web07.id, "reporting");
    await fake.logCreate(eng.id, flagInput("local.txt", [web07.id], T));
    const boards = vi.spyOn(fake, "hostSyncBoard");
    renderApp(`/e/${eng.id}`);
    await waitFor(async () => expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: T }));
    await waitFor(() => expect(boards).toHaveBeenCalledWith(web07.id, "privilege-escalation"));
    // Never synced against the empty checklist first.
    expect(boards).not.toHaveBeenCalledWith(web07.id, "information-gathering");
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "reporting", boardManual: true, boardDerived: "privilege-escalation" });
    // The card is still in Done on the board.
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Reporting" })).getByRole("link", { name: /web07/ })).toBeInTheDocument());
  });

  it("a sync started while the first-open rebuild runs waits for it; concurrent opens share one rebuild", async () => {
    const { eng, web07 } = await seed({ synced: false });
    await fake.hostMove(web07.id, "reporting");
    await fake.logCreate(eng.id, flagInput("local.txt", [web07.id], T));
    const apply = fake.checklistApplyEntryTicks.bind(fake);
    let release: () => void = () => {};
    const ticks = vi.spyOn(fake, "checklistApplyEntryTicks").mockImplementationOnce(async (e, entries) => {
      await new Promise<void>((r) => (release = r));
      return apply(e, entries);
    });
    const boards = vi.spyOn(fake, "hostSyncBoard");
    const opened: SyncChange = { entity: "engagement", id: eng.id, change: "opened" };
    const opens = [sync(eng.id, opened), sync(eng.id, opened)];
    await waitFor(() => expect(ticks).toHaveBeenCalled());
    const other = sync(eng.id, { entity: "host", id: web07.id, change: "updated" });
    await new Promise((r) => setTimeout(r, 20));
    expect(boards).not.toHaveBeenCalled();
    release();
    await Promise.all([...opens, other]);
    expect(boards.mock.calls.every(([id, col]) => id !== web07.id || col === "privilege-escalation")).toBe(true);
    expect(ticks).toHaveBeenCalledTimes(1);
  });

  it("a sync on an empty checklist skips a hand-placed card with no derived column", async () => {
    const { eng, dc01, web07 } = await seed({ synced: false });
    await fake.hostMove(dc01.id, "reporting");
    await sync(eng.id, { entity: "host", id: web07.id, change: "updated" });
    expect(await hostOf(eng.id, dc01.id)).toMatchObject({ boardColumn: "reporting", boardDerived: null });
    // Not hand-placed: derived as normal.
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardDerived: "information-gathering" });
  });
});

describe("a full rebuild from the log (Tick from log)", () => {
  it("re-derives missing ticks, drops evidence of deleted entries, keeps completedAt and manual state", async () => {
    const { eng, dc01, web07 } = await seed();
    const s1 = await fake.logCreate(eng.id, scanInput(T));
    await fake.logCreate(eng.id, flagInput("local.txt", [web07.id], T + 1));
    const [scanTick] = ticksForEntry(s1, await loadTickContext(eng.id));
    await put(
      eng.id,
      // Still ticked by s1: completedAt must not move.
      { ownerId: dc01.id, goalId: "h-enum-full-tcp", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: s1.id, commandId: scanTick!.commandId }] },
      // Evidence from an entry no longer in the log.
      { ownerId: dc01.id, goalId: "h-enum-udp", status: "done", completedAt: 60, auto: true, autoFrom: "na", evidence: [{ entryId: "gone", commandId: "x" }] },
      // Set by hand: untouched.
      { ownerId: dc01.id, goalId: "h-enum-versions", status: "na", notes: "skip" },
    );
    const rebuild: SyncChange = { entity: "log", id: eng.id, change: "rebuilt" };
    // h-enum-udp undone, h-orient-proof on web07 ticked.
    expect(await sync(eng.id, rebuild)).toEqual({ rebuilt: 2 });
    expect(await row(eng.id, dc01.id, "h-enum-full-tcp")).toMatchObject({ status: "done", completedAt: 50 });
    expect(await row(eng.id, dc01.id, "h-enum-udp")).toMatchObject({ status: "na", auto: false, evidence: [], completedAt: null });
    expect(await row(eng.id, dc01.id, "h-enum-versions")).toMatchObject({ status: "na", notes: "skip" });
    // F-R2: a rebuilt tick is stamped with the entry's time, not the rebuild's.
    expect(await row(eng.id, web07.id, "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: T + 1, evidence: [{ commandId: "flag" }] });
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "privilege-escalation" });
    // Run again: nothing left to change.
    expect(await sync(eng.id, rebuild)).toEqual({ rebuilt: 0 });
  });

  it("keeps fact ticks, and runs them", async () => {
    const { eng, dc01, web07 } = await seed();
    await fake.hostUpdate(web07.id, { name: "web07", ip: "192.0.2.6", os: "linux" });
    await fake.serviceCreate(dc01.id, { port: 22, nmapService: "ssh", nmapVersion: "OpenSSH 8.9" });
    await fake.hostUpdate(dc01.id, { name: "dc01", ip: "192.0.2.5", os: "linux" });
    await fake.logCreate(eng.id, scanInput(T));
    await put(
      eng.id,
      { ownerId: dc01.id, goalId: "h-enum-os", status: "done", completedAt: 50, auto: true },
      { ownerId: dc01.id, goalId: "h-enum-identified", status: "done", completedAt: 51, auto: true },
    );
    await sync(eng.id, { entity: "log", id: eng.id, change: "rebuilt" });
    expect(await row(eng.id, dc01.id, "h-enum-os")).toMatchObject({ status: "done", auto: true, completedAt: 50, evidence: [] });
    expect(await row(eng.id, dc01.id, "h-enum-identified")).toMatchObject({ status: "done", auto: true, completedAt: 51, evidence: [] });
    expect(await row(eng.id, web07.id, "h-enum-os")).toMatchObject({ status: "done", auto: true });
  });
});

describe("a host, service or access grant changed", () => {
  it("setting the OS ticks OS identified, and clearing it reverts", async () => {
    const { eng, dc01 } = await seed();
    await fake.hostUpdate(dc01.id, { name: "dc01", ip: "192.0.2.5", os: "linux" });
    await sync(eng.id, { entity: "host", id: dc01.id, change: "updated" });
    expect(await row(eng.id, dc01.id, "h-enum-os")).toMatchObject({ status: "done", auto: true });
    await fake.hostUpdate(dc01.id, { name: "dc01", ip: "192.0.2.5", os: null });
    await sync(eng.id, { entity: "host", id: dc01.id, change: "updated" });
    expect(await row(eng.id, dc01.id, "h-enum-os")).toMatchObject({ status: "todo", auto: false });
  });

  async function grant(engagementId: string, hostId: string, level: "admin" | "user") {
    const u = await fake.usernameCreate(engagementId, { username: "svc_web" });
    return fake.accessGrantCreate(engagementId, { usernameId: u.id, hostId, level, via: "winrm" });
  }

  it("an admin grant moves a host in Initial foothold to Post-exploitation with no checklist change", async () => {
    const { eng, web07 } = await seed();
    await put(eng.id, { ownerId: web07.id, goalId: "h-foot-listener", status: "done" });
    await fake.hostSyncBoard(web07.id, "initial-foothold");
    const before = await fake.checklistList(eng.id);
    const g = await grant(eng.id, web07.id, "admin");
    await sync(eng.id, { entity: "accessGrant", id: g.id, change: "created" });
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "post-exploitation" });
    expect(await fake.checklistList(eng.id)).toEqual(before);
  });

  it("removing the only elevated grant falls back to the checklist's column", async () => {
    const { eng, web07 } = await seed();
    await put(eng.id, { ownerId: web07.id, goalId: "h-foot-listener", status: "done" });
    await fake.hostSyncBoard(web07.id, "post-exploitation");
    const g = await grant(eng.id, web07.id, "user");
    await sync(eng.id, { entity: "accessGrant", id: g.id, change: "updated" });
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "initial-foothold" });
  });

  it("a card placed by hand stays until the grant changes the derived column", async () => {
    const { eng, web07 } = await seed();
    await put(eng.id, { ownerId: web07.id, goalId: "h-foot-listener", status: "done" });
    await fake.hostSyncBoard(web07.id, "initial-foothold");
    await fake.hostMove(web07.id, "vulnerability-detection");
    await sync(eng.id, { entity: "host", id: web07.id, change: "updated" });
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "vulnerability-detection", boardManual: true });
    const g = await grant(eng.id, web07.id, "admin");
    await sync(eng.id, { entity: "accessGrant", id: g.id, change: "created" });
    expect(await hostOf(eng.id, web07.id)).toMatchObject({ boardColumn: "post-exploitation", boardManual: false });
  });
});

function hookWrapper(qc = makeQueryClient()) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("a failed sync", () => {
  it("throws one error type, whatever the step, carrying the cause's code so a locked vault reaches the gate", async () => {
    const { eng, dc01 } = await seed({ os: "linux" });
    const locked = new RavenError("locked", "vault is locked");
    const f1 = await fake.logCreate(eng.id, flagInput("local.txt", [dc01.id]));
    type Command = "engagementGet" | "checklistApplyFacts" | "checklistApplyEntryTicks" | "hostSyncBoard" | "logDelete";
    const steps: [Command, SyncChange][] = [
      ["engagementGet", { entity: "host", id: dc01.id, change: "updated" }],
      ["checklistApplyFacts", { entity: "host", id: dc01.id, change: "updated" }],
      ["checklistApplyEntryTicks", { entity: "logEntry", id: f1.id, change: "saved", entry: f1, outputTicks: [] }],
      ["hostSyncBoard", { entity: "logEntry", id: f1.id, change: "updated", entry: f1 }],
      ["logDelete", { entity: "logEntry", id: f1.id, change: "deleted" }],
    ];
    for (const [command, change] of steps) {
      const spy = vi.spyOn(fake as unknown as Record<Command, (...a: unknown[]) => Promise<unknown>>, command).mockRejectedValue(locked);
      const error = await sync(eng.id, change).catch((e: unknown) => e);
      expect(error, command).toBeInstanceOf(ChecklistSyncError);
      expect(error, command).toMatchObject({ code: "locked", reason: locked });
      spy.mockRestore();
    }
  });
});

describe("what the sync reports", () => {
  it("reports only its own writes to the staleness map, and refetches nothing itself", async () => {
    const { eng, web07 } = await seed();
    const hosts = vi.spyOn(fake, "hostsList");
    const checklist = vi.spyOn(fake, "checklistList");
    const qc = makeQueryClient();
    renderHook(() => [useHosts(eng.id), useChecklist(eng.id)], { wrapper: hookWrapper(qc) });
    await waitFor(() => expect(hosts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(1));
    const settle = () => new Promise((r) => setTimeout(r, 20));

    // Nothing to write: the sync's own reads (one of each) and nothing after.
    hosts.mockClear();
    checklist.mockClear();
    await syncChecklist({ engagementId: eng.id, change: { entity: "host", id: web07.id, change: "updated" }, qc });
    await settle();
    expect(hosts).toHaveBeenCalledTimes(1);
    expect(checklist).toHaveBeenCalledTimes(1);

    // A card moves: the hosts refetch; the checklist, unwritten, does not.
    await put(eng.id, { ownerId: web07.id, goalId: "h-foot-listener", status: "done" });
    hosts.mockClear();
    checklist.mockClear();
    await syncChecklist({ engagementId: eng.id, change: { entity: "checklistItem", id: web07.id, change: "updated" }, qc });
    await waitFor(() => expect(hosts).toHaveBeenCalledTimes(2));
    await settle();
    expect(checklist).toHaveBeenCalledTimes(1);
  });
});

describe("service mutations", () => {
  it("confirming a service re-syncs the board", async () => {
    const { eng, dc01 } = await seed();
    // The enumerate goals that apply with only 3000/tcp seen as http are all closed except the web ones.
    const s1 = await fake.serviceCreate(dc01.id, { port: 3000, nmapService: "http" });
    const ctx = await loadTickContext(eng.id);
    const host = ctx.hosts.find((h) => h.id === dc01.id)!;
    const goals = applicableGoals(host, ctx.engagement, ctx.hosts, ctx.servicesByHost).filter((a) => a.stage.id === "information-gathering").flatMap((a) => a.goals);
    expect(goals.some((g) => g.id.startsWith("h-enum-web"))).toBe(true);
    await fake.checklistPut(eng.id, goals.filter((g) => !g.id.startsWith("h-enum-web")).map((g) => ({ ownerId: dc01.id, goalId: g.id, status: "done" as const, completedAt: 1 })));
    const { result } = renderHook(() => useServiceMutations(eng.id, dc01.id), { wrapper: hookWrapper() });
    await act(() => result.current.confirm.mutateAsync({ id: s1.id, input: { product: "Cachestore", version: "5.1" } }));
    await waitFor(async () => expect(await hostOf(eng.id, dc01.id)).toMatchObject({ boardColumn: "vulnerability-detection" }));
  });

  it("a board-sync failure after a service change is not fatal", async () => {
    const { eng, dc01 } = await seed({ synced: false });
    const s1 = await fake.serviceCreate(dc01.id, { port: 80, nmapService: "http" });
    const boards = vi.spyOn(fake, "hostSyncBoard").mockRejectedValue(new Error("board busy"));
    const { result } = renderHook(() => useServiceMutations(eng.id, dc01.id), { wrapper: hookWrapper() });
    await act(() => result.current.remove.mutateAsync(s1.id));
    await waitFor(() => expect(boards).toHaveBeenCalled());
    expect(result.current.remove.isError).toBe(false);
  });
});

describe("useChecklistMutations", () => {
  async function seeded(over: Partial<ChecklistItemInput> = {}) {
    const { eng, dc01 } = await seed();
    await put(eng.id, { ownerId: dc01.id, goalId: "h-enum-udp", status: "done", completedAt: 50, auto: true, autoFrom: "na", notes: "keep", evidence: [{ entryId: "s1", commandId: "x" }], ...over });
    const { result } = renderHook(() => useChecklistMutations(eng.id), { wrapper: hookWrapper() });
    return { eng, dc01, result };
  }

  it("setStatus done is manual, clears autoFrom and stamps completedAt; evidence and notes stay", async () => {
    const { eng, dc01, result } = await seeded({ status: "in_progress", completedAt: null });
    const t0 = Date.now();
    await act(() => result.current.setStatus.mutateAsync({ ownerId: dc01.id, goalId: "h-enum-udp", status: "done" }));
    const r = (await row(eng.id, dc01.id, "h-enum-udp"))!;
    expect(r).toMatchObject({ status: "done", notes: "keep", auto: false, autoFrom: null, statusManual: true, evidence: [{ entryId: "s1", commandId: "x" }] });
    expect(r.completedAt).toBeGreaterThanOrEqual(t0);
  });

  it("setStatus other than done clears completedAt", async () => {
    const { eng, dc01, result } = await seeded();
    await act(() => result.current.setStatus.mutateAsync({ ownerId: dc01.id, goalId: "h-enum-udp", status: "todo" }));
    expect(await row(eng.id, dc01.id, "h-enum-udp")).toMatchObject({
      status: "todo", notes: "keep", completedAt: null, auto: false, autoFrom: null, statusManual: true, evidence: [{ entryId: "s1", commandId: "x" }],
    });
  });

  it("setNotes with blank removes the notes and keeps the rest", async () => {
    const { eng, dc01, result } = await seeded();
    await act(() => result.current.setNotes.mutateAsync({ ownerId: dc01.id, goalId: "h-enum-udp", notes: "   " }));
    expect(await row(eng.id, dc01.id, "h-enum-udp")).toMatchObject({
      status: "done", notes: null, completedAt: 50, auto: true, autoFrom: "na", statusManual: false, evidence: [{ entryId: "s1", commandId: "x" }],
    });
  });
});
