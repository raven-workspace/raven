import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { discardNotes, resetNotesStore } from "../features/notes/useNotesStore";
import { threadCountsMemory } from "../features/notes/useThreadCounts";
import { api } from "../lib/api";
import { reportError } from "../lib/lockSignal";
import { RavenError } from "../types/errors";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Note } from "../types/notes";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "VEGA", ip: "10.10.10.5", os: "linux", boardColumn: "vulnerability-detection",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};

const stored: Record<string, Note> = {};
const k = (h: string | null) => h ?? "";
function setStored(hostId: string | null, body: string, priv = false) {
  stored[k(hostId)] = { ownerId: hostId ?? "e1", engagementId: "e1", hostId, body, private: priv, updatedAt: 5 };
}
const all = () => Object.values(stored);

let qc: QueryClient;
function mount(path: string) {
  qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  resetNotesStore();
  useCaptureStore.getState().reset();
  for (const key of Object.keys(stored)) delete stored[key];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.vaultLock.mockResolvedValue(null);
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockImplementation(async () => all());
  m.notesGet.mockImplementation(async (_e, hostId) => stored[k(hostId)] ?? { ownerId: hostId ?? "e1", engagementId: "e1", hostId, body: "", private: false, updatedAt: 0 });
  m.noteSave.mockImplementation(async (_e, hostId, body, isPrivate) => {
    setStored(hostId, body, isPrivate);
    return stored[k(hostId)]!;
  });
  m.ruledOutCreate.mockImplementation(async (input) => ({
    id: "r1", engagementId: input.engagementId, hostId: input.hostId ?? null, text: input.text, reason: input.reason,
    private: input.private ?? false, sourceKind: null, sourceId: null, createdAt: 1,
  }));
});

async function openPanel(user: ReturnType<typeof userEvent.setup>, path: string) {
  mount(path);
  await screen.findByText("Mock exam A");
  await user.keyboard("n");
  const p = await screen.findByRole("complementary", { name: /Notes/ });
  const ta = (await within(p).findByLabelText("Notes")) as HTMLTextAreaElement;
  await vi.waitFor(() => expect(ta).not.toHaveAttribute("readonly"));
  return { p, ta };
}

describe("open threads", () => {
  it('a "? " line shows a dot on the board card, the sidebar and a count on the strip', async () => {
    setStored("h1", "x\n? why 8080\n? who owns the share");
    setStored(null, "? is the DC reachable");
    const { container } = mount("/e/e1");
    await screen.findByText("Mock exam A");
    await vi.waitFor(() => expect(container.querySelector('[data-host-id="h1"]')).not.toBeNull());
    const card = container.querySelector<HTMLElement>('[data-host-id="h1"]')!;
    expect(await within(card).findByLabelText("2 open threads")).toBeInTheDocument();
    const strip = screen.getByRole("status", { name: "Engagement status" });
    expect(await within(strip).findByText("Threads 3")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Engagement" })).getByLabelText("2 open threads")).toBeInTheDocument();
  });

  it("the host header shows the host's thread count", async () => {
    setStored("h1", "x\n? why 8080\n? who owns the share");
    setStored(null, "? not this host's");
    mount("/e/e1/h/h1");
    expect(await screen.findByText("2 threads")).toBeInTheDocument();
  });

  it("an unsaved thread counts right away", async () => {
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1/h/h1");
    fireEvent.change(ta, { target: { value: "? typed" } });
    expect(await screen.findByText("1 thread")).toBeInTheDocument();
  });

  it("after a lock the thread-count caches hold no note body, saved or pending (T10-R1)", async () => {
    setStored("h1", "? saved secret");
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1/h/h1");
    expect(await screen.findByText("1 thread")).toBeInTheDocument();
    fireEvent.change(ta, { target: { value: "? pending secret" } });
    await vi.waitFor(() => expect(threadCountsMemory()).toContain("? pending secret"));
    expect(threadCountsMemory()).toContain("? saved secret");
    act(() => reportError(new RavenError("locked", "locked")));
    await screen.findByLabelText("Password");
    const left = threadCountsMemory();
    expect(left).not.toContain("? saved secret");
    expect(left).not.toContain("? pending secret");
  });

  it("the dashboard card shows the engagement's total", async () => {
    setStored("h1", "? a\n? b");
    mount("/");
    expect(await screen.findByText("2 threads")).toBeInTheDocument();
  });

  it("closing as dead end requires a reason and creates a ruled-out item", async () => {
    setStored("h1", "keep\n? try the upload form", true);
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1/h/h1");
    await user.click(await within(p).findByRole("button", { name: "Close thread: try the upload form" }));
    const d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Dead end" }));
    const confirm = within(d).getByRole("button", { name: "Close thread" });
    expect(confirm).toBeDisabled();
    await user.type(within(d).getByLabelText("Reason"), "filter blocks php");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await vi.waitFor(() =>
      expect(m.ruledOutCreate).toHaveBeenCalledWith({
        engagementId: "e1", hostId: "h1", text: "try the upload form", reason: "filter blocks php", private: true,
      }),
    );
    expect(m.noteSave).toHaveBeenCalledWith("e1", "h1", "keep\n✗ try the upload form", true);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(p).getByLabelText("Notes")).toHaveValue("keep\n✗ try the upload form");
  });

  it("panned out rewrites the line and creates no ruled-out item", async () => {
    setStored(null, "? is smb signing off");
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1");
    await user.click(await within(p).findByRole("button", { name: /Close thread: is smb/ }));
    const d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Panned out" }));
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", null, "✓ is smb signing off", false));
    expect(m.ruledOutCreate).not.toHaveBeenCalled();
  });

  it("when the ruled-out create fails the dialog says the line is already rewritten", async () => {
    setStored(null, "? dead");
    m.ruledOutCreate.mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1");
    await user.click(await within(p).findByRole("button", { name: /Close thread: dead/ }));
    const d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Dead end" }));
    await user.type(within(d).getByLabelText("Reason"), "nope");
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/already.*✗.*disk full/s);
    expect(m.noteSave).toHaveBeenCalledWith("e1", null, "✗ dead", false);
  });

  async function openDead(user: ReturnType<typeof userEvent.setup>, p: HTMLElement, name: RegExp) {
    await user.click(await within(p).findByRole("button", { name }));
    const d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Dead end" }));
    await user.type(within(d).getByLabelText("Reason"), "nope");
    return d;
  }

  it("a failed save while closing as dead end keeps the dialog and the reason, and a retry saves then creates the ruled-out item once", async () => {
    setStored(null, "? flaky");
    m.noteSave.mockRejectedValueOnce(new Error("disk busy"));
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1");
    const d = await openDead(user, p, /Close thread: flaky/);
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/disk busy/);
    expect(m.ruledOutCreate).not.toHaveBeenCalled();
    expect(within(d).getByLabelText("Reason")).toHaveValue("nope");
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    await vi.waitFor(() => expect(m.ruledOutCreate).toHaveBeenCalledTimes(1));
    expect(m.ruledOutCreate).toHaveBeenCalledWith(expect.objectContaining({ text: "flaky", reason: "nope" }));
    expect(m.noteSave).toHaveBeenLastCalledWith("e1", null, "✗ flaky", false);
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a lock between the save and the create creates nothing", async () => {
    setStored(null, "? locked");
    m.noteSave.mockImplementation(async (_e, hostId, body, isPrivate) => {
      discardNotes();
      return { ownerId: "e1", engagementId: "e1", hostId, body, private: isPrivate, updatedAt: 9 };
    });
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1");
    const d = await openDead(user, p, /Close thread: locked/);
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(m.ruledOutCreate).not.toHaveBeenCalled();
  });

  it("refuses when the line changed since the dialog opened", async () => {
    setStored(null, "? moved");
    const user = userEvent.setup();
    const { p, ta } = await openPanel(user, "/e/e1");
    const d = await openDead(user, p, /Close thread: moved/);
    fireEvent.change(ta, { target: { value: "no longer a thread" } });
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent(/That line changed/);
    expect(m.ruledOutCreate).not.toHaveBeenCalled();
    expect(m.noteSave).not.toHaveBeenCalledWith("e1", null, expect.stringContaining("✗"), false);
  });

  it("⌘/ toggles the prefix on the caret line", async () => {
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "one\ntwo\nthree" } });
    ta.setSelectionRange(5, 5); // inside "two"
    fireEvent.keyDown(ta, { key: "/", metaKey: true });
    expect(ta).toHaveValue("one\n? two\nthree");
    expect(ta.selectionStart).toBe(7);
    fireEvent.keyDown(ta, { key: "/", metaKey: true });
    expect(ta).toHaveValue("one\ntwo\nthree");
    expect(ta.selectionStart).toBe(5);
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", null, "one\ntwo\nthree", false), { timeout: 2000 });
  });

  it("⌘/ works on non-US layouts: the physical slash key, or / typed with Shift", async () => {
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "one" } });
    ta.setSelectionRange(1, 1);
    // Canadian CSA: the key right of "." types "é", but it is the US slash key.
    fireEvent.keyDown(ta, { key: "é", code: "Slash", metaKey: true });
    expect(ta).toHaveValue("? one");
    // A layout where "/" needs Shift.
    fireEvent.keyDown(ta, { key: "/", code: "Digit7", metaKey: true, shiftKey: true });
    expect(ta).toHaveValue("one");
    // ⌘? (Shift on the US slash key) stays free for macOS Help.
    fireEvent.keyDown(ta, { key: "?", code: "Slash", metaKey: true, shiftKey: true });
    expect(ta).toHaveValue("one");
  });
});
