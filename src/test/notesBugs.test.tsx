import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { resetNotesStore } from "../features/notes/useNotesStore";
import { api } from "../lib/api";
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
  // StrictMode, as in main.tsx: effects mount, unmount and mount again.
  return render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
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
    private: input.private ?? false, createdAt: 1,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A pause long enough for the 500 ms autosave to fire and its save to land. */
const pause = () => act(() => sleep(650));

describe("notes panel: multi-line typing (bug 1)", () => {
  it("keeps every line through autosaves: line, Enter, '- item', Enter, line", async () => {
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1");
    await user.click(ta);
    await user.type(ta, "line one");
    await pause();
    await user.type(ta, "{Enter}");
    await pause();
    await user.type(ta, "- item");
    await pause();
    await user.type(ta, "{Enter}");
    await pause();
    await user.type(ta, "line three");
    await pause();
    const want = "line one\n- item\nline three";
    expect(ta.value).toBe(want);
    expect(stored[""]?.body).toBe(want);
  }, 15000);

  it("keeps the caret at the end while typing across a save that lands mid-word", async () => {
    let release: (() => void) | undefined;
    m.noteSave.mockImplementation(async (_e, hostId, body, isPrivate) => {
      await new Promise<void>((r) => (release = r));
      setStored(hostId, body, isPrivate);
      return stored[k(hostId)]!;
    });
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1");
    await user.click(ta);
    await user.type(ta, "line one");
    await pause(); // save of "line one" starts and hangs
    await user.type(ta, "{Enter}- it");
    act(() => release?.());
    await act(() => sleep(0));
    await user.type(ta, "em");
    await pause();
    act(() => release?.());
    await act(() => sleep(0));
    expect(ta.value).toBe("line one\n- item");
    await vi.waitFor(() => expect(stored[""]?.body).toBe("line one\n- item"));
  }, 15000);
  // jsdom can't run macOS text services (inline predictions, autocapitalisation, substitutions); these attributes are
  // what turns them off in WKWebView. Unverified in the real window.
  it("the notes textarea opts out of macOS text services", async () => {
    const user = userEvent.setup();
    const { ta } = await openPanel(user, "/e/e1");
    expect(ta).toHaveAttribute("spellcheck", "false");
    expect(ta).toHaveAttribute("autocorrect", "off");
    expect(ta).toHaveAttribute("autocapitalize", "off");
    expect(ta).toHaveAttribute("autocomplete", "off");
    expect(ta).toHaveAttribute("writingsuggestions", "false");
  });
});

describe("closing a thread clears every count (bug 2)", () => {
  for (const outcome of ["Panned out", "Dead end"] as const) {
    it(`${outcome}: the strip count, board dot and sidebar dot disappear`, async () => {
      setStored("h1", "keep\n? try the upload form");
      const user = userEvent.setup();
      const { p } = await openPanel(user, "/e/e1/h/h1");
      const strip = screen.getByRole("status", { name: "Engagement status" });
      expect(await within(strip).findByText("Threads 1")).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Engagement" });
      expect(within(nav).getByLabelText("1 open thread")).toBeInTheDocument();

      await user.click(await within(p).findByRole("button", { name: "Close thread: try the upload form" }));
      const d = await screen.findByRole("dialog");
      await user.click(within(d).getByRole("button", { name: outcome }));
      if (outcome === "Dead end") await user.type(within(d).getByLabelText("Reason"), "filter blocks php");
      await user.click(within(d).getByRole("button", { name: "Close thread" }));
      await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      const mark = outcome === "Dead end" ? "✗" : "✓";
      await vi.waitFor(() => expect(stored.h1?.body).toBe(`keep\n${mark} try the upload form`));

      await vi.waitFor(() => expect(within(strip).queryByText(/Threads/)).not.toBeInTheDocument());
      expect(within(nav).queryByLabelText(/open thread/)).not.toBeInTheDocument();
      // Stays cleared after things settle (no stale refetch brings it back).
      await act(() => sleep(700));
      expect(within(strip).queryByText(/Threads/)).not.toBeInTheDocument();
      expect(within(nav).queryByLabelText(/open thread/)).not.toBeInTheDocument();

      // The board too.
      await user.keyboard("{Escape}");
      await user.keyboard("{Escape}");
      await screen.findByRole("status", { name: "Engagement status" });
      await act(() => sleep(100));
      expect(screen.queryByLabelText(/open thread/)).not.toBeInTheDocument();
      expect(within(screen.getByRole("status", { name: "Engagement status" })).queryByText(/Threads/)).not.toBeInTheDocument();
    }, 15000);
  }
  it("the count stays cleared while the notes list refetch is still on its way", async () => {
    setStored("h1", "keep\n? try the upload form");
    const user = userEvent.setup();
    const { p } = await openPanel(user, "/e/e1/h/h1");
    const strip = screen.getByRole("status", { name: "Engagement status" });
    expect(await within(strip).findByText("Threads 1")).toBeInTheDocument();
    // From here on the list answers slowly (a busy backend: every command waits for the vault mutex).
    let releaseList: (() => void) | undefined;
    m.notesList.mockImplementation(async () => {
      await new Promise<void>((r) => (releaseList = r));
      return all();
    });
    await user.click(await within(p).findByRole("button", { name: "Close thread: try the upload form" }));
    const d = await screen.findByRole("dialog");
    await user.click(within(d).getByRole("button", { name: "Panned out" }));
    await user.click(within(d).getByRole("button", { name: "Close thread" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await vi.waitFor(() => expect(stored.h1?.body).toBe("keep\n✓ try the upload form"));
    await act(() => sleep(50));
    expect(within(p).getByLabelText("Notes")).toHaveValue("keep\n✓ try the upload form");
    expect(within(strip).queryByText(/Threads/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Engagement" })).queryByLabelText(/open thread/)).not.toBeInTheDocument();
    act(() => releaseList?.());
  });
});
