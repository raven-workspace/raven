import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { loadTickContext, syncEntryTicks, tickFromLog } from "../features/checklist/ticks";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem, ChecklistItemInput } from "../types/checklist";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry, LogEntryInput } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: "Kali (VM)", msfHostId: null,
};

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1", ip: null, os: null, boardColumn: "enumerate", boardManual: false, dualHomed: false,
    boardDerived: "enumerate", access: "none", createdAt: 1, updatedAt: 1, ...over,
  };
}

const T = new Date(2026, 10, 4, 9, 5).getTime();

function entry(over: Partial<LogEntry> & Pick<LogEntry, "id">): LogEntry {
  return {
    engagementId: "e1", kind: "note", title: over.id, titleEdited: false, ranOn: null, hostIds: [], observations: null,
    returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at: T,
    createdAt: T, updatedAt: T, ...over,
  };
}

function item(over: Partial<ChecklistItem> & Pick<ChecklistItem, "ownerId" | "goalId">): ChecklistItem {
  return { status: "todo", notes: null, completedAt: null, auto: false, autoFrom: null, evidence: [], updatedAt: 1, ...over };
}

const FULL_SCAN = "nmap -p- 10.10.10.5";
const FLAG = "0123456789abcdef0123456789abcdef";

let engagement: Engagement;
let hosts: Host[];
let entries: LogEntry[];
let store: ChecklistItem[];
let nextId: number;

/** Every item sent to checklist_put, across calls. */
const putItems = () => m.checklistPut.mock.calls.flatMap((c) => c[1]);
const putFor = (ownerId: string, goalId: string) => putItems().filter((i) => i.ownerId === ownerId && i.goalId === goalId);
const stored = (ownerId: string, goalId: string) => store.find((i) => i.ownerId === ownerId && i.goalId === goalId);

function mount(path = "/e/e1") {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openCapture(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("navigation", { name: "Engagement" });
  await screen.findAllByText("dc01");
  await user.keyboard("l");
  return screen.findByRole("dialog", { name: "Capture" });
}

async function saveCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}{Enter}{/Meta}");
}

const log = () => within(screen.getByRole("region", { name: "Log" }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useCaptureStore.getState().reset();
  engagement = E1;
  hosts = [
    host({ id: "h1", name: "dc01", ip: "10.10.10.5" }),
    host({ id: "h2", name: "web02", ip: "10.10.10.6" }),
  ];
  entries = [];
  store = [];
  nextId = 1;
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "" });
  m.engagementsList.mockImplementation(async () => [engagement]);
  m.engagementGet.mockImplementation(async () => engagement);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockImplementation(async () => hosts);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.servicesUpsertScan.mockResolvedValue([]);
  m.logList.mockImplementation(async () => entries);
  m.logCreate.mockImplementation(async (_e, input: LogEntryInput) => {
    const e = entry({
      id: `l${nextId++}`, kind: input.content.kind, title: input.title, ranOn: input.ranOn, hostIds: input.hostIds,
      observations: input.observations, content: input.content, at: T + nextId,
    });
    entries = [...entries, e];
    return e;
  });
  m.logUpdate.mockImplementation(async (id, input) => {
    entries = entries.map((e) => (e.id === id ? ({ ...e, ...input, titleEdited: input.titleEdited ?? e.titleEdited } as LogEntry) : e));
    return entries.find((e) => e.id === id)!;
  });
  m.logDelete.mockImplementation(async (id) => {
    entries = entries.filter((e) => e.id !== id);
    return null;
  });
  m.checklistList.mockImplementation(async () => store);
  m.checklistPut.mockImplementation(async (_e, items: ChecklistItemInput[]) => {
    for (const it of items) {
      const full = item({ ...it, updatedAt: 2 } as ChecklistItem);
      store = [...store.filter((s) => !(s.ownerId === it.ownerId && s.goalId === it.goalId)), full];
    }
    return store;
  });
  m.hostSyncBoard.mockImplementation(async (id, derived) => {
    hosts = hosts.map((h) => (h.id === id ? { ...h, boardColumn: derived, boardDerived: derived, boardManual: false } : h));
    return hosts.find((h) => h.id === id)!;
  });
  m.engagementSetMsfHost.mockImplementation(async (_e, hostId) => {
    engagement = { ...engagement, msfHostId: hostId };
    return engagement;
  });
});

describe("auto-tick wiring", () => {
  it("saving a full nmap scan ticks h-enum-full-tcp on the host and checklistPut carries evidence for the entry", async () => {
    const user = userEvent.setup();
    mount();
    await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut).toHaveBeenCalledTimes(1);
    expect(m.checklistPut.mock.calls[0]![1]).toEqual([
      {
        ownerId: "h1", goalId: "h-enum-full-tcp", status: "done", notes: null, completedAt: expect.any(Number),
        auto: true, autoFrom: null, evidence: [{ entryId: "l1", commandId: "enum-nmap-full-tcp" }],
      },
    ]);
  });

  it("editing the entry to a different host moves the tick", async () => {
    const user = userEvent.setup();
    entries = [
      entry({ id: "f1", title: "local.txt · dc01", kind: "flag", hostIds: ["h1"], content: { kind: "flag", flagKind: "local", value: FLAG } }),
    ];
    store = [
      item({ ownerId: "h1", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] }),
    ];
    hosts = hosts.map((h) => (h.id === "h1" ? { ...h, boardColumn: "privesc", boardDerived: "privesc" } : h));
    mount("/e/e1/s/log");
    await user.click(await screen.findByRole("button", { name: /local.txt · dc01/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove dc01" }));
    await user.click(screen.getByRole("combobox", { name: "Link a host" }));
    await user.click(await screen.findByRole("option", { name: /web02/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut).toHaveBeenCalledTimes(1);
    expect(stored("h1", "h-orient-proof")).toMatchObject({ status: "todo", completedAt: null, auto: false, evidence: [] });
    expect(stored("h2", "h-orient-proof")).toMatchObject({ status: "done", auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] });
    await vi.waitFor(() => expect(m.hostSyncBoard).toHaveBeenCalledWith("h2", "privesc"));
    expect(m.hostSyncBoard).toHaveBeenCalledWith("h1", "enumerate");
  });

  it("deleting the entry removes its evidence and restores the prior status", async () => {
    const user = userEvent.setup();
    entries = [
      entry({ id: "s1", title: "full scan", kind: "command", hostIds: ["h1"], content: { kind: "command", blocks: [{ command: FULL_SCAN, output: "" }] } }),
    ];
    store = [
      item({
        ownerId: "h1", goalId: "h-enum-full-tcp", status: "done", completedAt: 50, auto: true, autoFrom: "in_progress",
        notes: "slow over VPN", evidence: [{ entryId: "s1", commandId: "enum-nmap-full-tcp" }],
      }),
      item({ ownerId: "h1", goalId: "h-enum-udp", status: "done", completedAt: 40, notes: "manual" }),
    ];
    mount("/e/e1/s/log");
    await user.click(await screen.findByRole("button", { name: /full scan/ }));
    await user.click(log().getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut.mock.calls[0]![1]).toEqual([
      {
        ownerId: "h1", goalId: "h-enum-full-tcp", status: "in_progress", notes: "slow over VPN", completedAt: null,
        auto: false, autoFrom: null, evidence: [],
      },
    ]);
    // The manual tick was not touched.
    expect(stored("h1", "h-enum-udp")).toMatchObject({ status: "done", completedAt: 40, notes: "manual" });
  });

  it("a local.txt flag ticks h-orient-proof and the host moves to Privesc via hostSyncBoard", async () => {
    const user = userEvent.setup();
    mount();
    const dialog = await openCapture(user);
    await user.paste(`whoami; hostname; ip a\nweb02\n    inet 10.10.10.6/24 brd 10.10.10.255 scope global ens3\ncat /home/web/local.txt\n${FLAG}`);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("local.txt · web02");
    await saveCapture(user);
    await vi.waitFor(() => expect(m.hostSyncBoard).toHaveBeenCalled());
    expect(putFor("h2", "h-orient-proof")).toEqual([
      expect.objectContaining({ status: "done", auto: true, evidence: [{ entryId: "l1", commandId: "flag" }] }),
    ]);
    expect(m.hostSyncBoard).toHaveBeenCalledTimes(1);
    expect(m.hostSyncBoard).toHaveBeenCalledWith("h2", "privesc");
  });

  it("a hand-placed card is not moved by a save that does not change the derived column", async () => {
    const user = userEvent.setup();
    hosts = hosts.map((h) => (h.id === "h1" ? { ...h, boardColumn: "loot", boardManual: true, boardDerived: "enumerate" } : h));
    mount();
    await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    await vi.waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    // Give a stray board sync time to run.
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.hostSyncBoard).not.toHaveBeenCalled();
  });

  it('exam-sim: first "use exploit/…" entry locks Metasploit to its host; a later one on another host shows the warning', async () => {
    const user = userEvent.setup();
    engagement = { ...E1, kind: "exam-sim" };
    mount();
    let dialog = await openCapture(user);
    await user.paste("kali@kali:~$ msfconsole -q -x 'use exploit/windows/smb/psexec; set RHOSTS 10.10.10.5; run'");
    expect(within(dialog).queryByText(/Metasploit is already locked/)).toBeNull();
    await saveCapture(user);
    await vi.waitFor(() => expect(m.engagementSetMsfHost).toHaveBeenCalledWith("e1", "h1"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openCapture(user);
    await user.paste("kali@kali:~$ msfconsole -q -x 'use exploit/multi/http/tomcat_mgr_upload; set RHOSTS 10.10.10.6; run'");
    const warning = await within(dialog).findByText(
      "Metasploit is already locked to another host on this engagement. This entry uses it on a different host.",
    );
    expect(warning).toHaveClass("text-warn");
    // Saving is still allowed, and the lock stays where it is.
    await saveCapture(user);
    await vi.waitFor(() => expect(m.logCreate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.engagementSetMsfHost).toHaveBeenCalledTimes(1);
  });

  it("checklist write failure shows the Tick from log message and the entry stays saved", async () => {
    const user = userEvent.setup();
    m.checklistPut.mockRejectedValue(new Error("disk full"));
    mount();
    const dialog = await openCapture(user);
    await user.paste(FULL_SCAN);
    await saveCapture(user);
    expect(
      await within(dialog).findByText("Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist."),
    ).toBeInTheDocument();
    expect(m.logCreate).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    // The draft is gone, so Save does not create the entry twice.
    expect(within(dialog).getByLabelText("Paste")).toHaveValue("");
  });

  it("a delete whose checklist write fails keeps the entry and shows why", async () => {
    const user = userEvent.setup();
    m.checklistPut.mockRejectedValue(new Error("disk full"));
    entries = [
      entry({ id: "f1", title: "local.txt · dc01", kind: "flag", hostIds: ["h1"], content: { kind: "flag", flagKind: "local", value: FLAG } }),
    ];
    store = [
      item({ ownerId: "h1", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] }),
    ];
    mount("/e/e1/s/log");
    await user.click(await screen.findByRole("button", { name: /local.txt · dc01/ }));
    await user.click(log().getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    expect(m.logDelete).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it("a delete that fails after unticking puts the ticks back", async () => {
    const user = userEvent.setup();
    m.logDelete.mockRejectedValue(new Error("db busy"));
    entries = [
      entry({ id: "f1", title: "local.txt · dc01", kind: "flag", hostIds: ["h1"], content: { kind: "flag", flagKind: "local", value: FLAG } }),
    ];
    store = [
      item({ ownerId: "h1", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] }),
    ];
    hosts = hosts.map((h) => (h.id === "h1" ? { ...h, boardColumn: "privesc", boardDerived: "privesc" } : h));
    mount("/e/e1/s/log");
    await user.click(await screen.findByRole("button", { name: /local.txt · dc01/ }));
    await user.click(log().getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(await screen.findByText("db busy")).toBeInTheDocument();
    expect(m.checklistPut).toHaveBeenCalledTimes(2);
    expect(stored("h1", "h-orient-proof")).toMatchObject({
      status: "done", auto: true, completedAt: 50, evidence: [{ entryId: "f1", commandId: "flag" }],
    });
    expect(hosts.find((h) => h.id === "h1")).toMatchObject({ boardColumn: "privesc", boardDerived: "privesc" });
  });

  it("a log edit whose checklist write fails says so", async () => {
    const user = userEvent.setup();
    m.checklistPut.mockRejectedValue(new Error("disk full"));
    entries = [
      entry({ id: "f1", title: "local.txt · dc01", kind: "flag", hostIds: ["h1"], content: { kind: "flag", flagKind: "local", value: FLAG } }),
    ];
    mount("/e/e1/s/log");
    await user.click(await screen.findByRole("button", { name: /local.txt · dc01/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Saved the entry, but the checklist didn't update. Use Tick from log on the Engagement checklist."),
    ).toBeInTheDocument();
    expect(m.logUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("ticks.ts", () => {
  it("an edit unticks every owner holding evidence from the entry, even when it now ticks nothing", async () => {
    // The flag was on both hosts; it becomes a note.
    store = [
      item({ ownerId: "h1", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] }),
      item({ ownerId: "h2", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }, { entryId: "f2", commandId: "flag" }] }),
    ];
    const ctx = await loadTickContext("e1");
    await syncEntryTicks("e1", entry({ id: "f1", hostIds: ["h1", "h2"] }), "f1", ctx);
    expect(m.checklistPut).toHaveBeenCalledTimes(1);
    expect(stored("h1", "h-orient-proof")).toMatchObject({ status: "todo", auto: false, evidence: [], completedAt: null });
    // h2 keeps its other evidence and its completion time.
    expect(stored("h2", "h-orient-proof")).toMatchObject({ status: "done", auto: true, completedAt: 50, evidence: [{ entryId: "f2", commandId: "flag" }] });
  });

  it("nothing changed writes nothing", async () => {
    store = [
      item({ ownerId: "h1", goalId: "h-orient-proof", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] }),
    ];
    const ctx = await loadTickContext("e1");
    const flag = entry({ id: "f1", kind: "flag", hostIds: ["h1"], content: { kind: "flag", flagKind: "local", value: FLAG } });
    hosts = hosts.map((h) => (h.id === "h1" ? { ...h, boardDerived: "privesc" } : h));
    await syncEntryTicks("e1", flag, "f1", await loadTickContext("e1"));
    expect(ctx.hosts).toHaveLength(2);
    expect(m.checklistPut).not.toHaveBeenCalled();
    expect(m.hostSyncBoard).not.toHaveBeenCalled();
  });

  it("tickFromLog re-derives missing ticks, drops evidence of deleted entries, keeps completedAt and manual state", async () => {
    entries = [
      entry({ id: "s1", kind: "command", at: T, content: { kind: "command", blocks: [{ command: FULL_SCAN, output: "" }] } }),
      entry({ id: "f1", kind: "flag", at: T + 1, hostIds: ["h2"], content: { kind: "flag", flagKind: "local", value: FLAG } }),
    ];
    store = [
      // Still ticked by s1: completedAt must not move.
      item({ ownerId: "h1", goalId: "h-enum-full-tcp", status: "done", completedAt: 50, auto: true, evidence: [{ entryId: "s1", commandId: "enum-nmap-full-tcp" }] }),
      // Evidence from an entry no longer in the log.
      item({ ownerId: "h1", goalId: "h-enum-udp", status: "done", completedAt: 60, auto: true, autoFrom: "na", evidence: [{ entryId: "gone", commandId: "x" }] }),
      // Manual: untouched.
      item({ ownerId: "h1", goalId: "h-enum-versions", status: "na", notes: "skip" }),
    ];
    const result = await tickFromLog("e1", await loadTickContext("e1"));
    // h-enum-udp undone, h-orient-proof on h2 ticked.
    expect(result).toEqual({ updated: 2, message: "Updated 2 goals" });
    expect(m.checklistPut).toHaveBeenCalledTimes(1);
    expect(stored("h1", "h-enum-full-tcp")).toMatchObject({ status: "done", completedAt: 50 });
    expect(stored("h1", "h-enum-udp")).toMatchObject({ status: "na", auto: false, evidence: [], completedAt: null });
    expect(stored("h1", "h-enum-versions")).toMatchObject({ status: "na", notes: "skip" });
    expect(stored("h2", "h-orient-proof")).toMatchObject({ status: "done", auto: true, evidence: [{ entryId: "f1", commandId: "flag" }] });
    expect(m.hostSyncBoard).toHaveBeenCalledWith("h2", "privesc");

    // Run again: nothing left to change.
    m.checklistPut.mockClear();
    expect(await tickFromLog("e1", await loadTickContext("e1"))).toEqual({ updated: 0, message: "Updated 0 goals" });
    expect(m.checklistPut).not.toHaveBeenCalled();
  });
});
