import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { resetNotesStore } from "../features/notes/useNotesStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import { RavenError } from "../types/errors";
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
  id: "h1", engagementId: "e1", name: "VEGA", ip: "10.10.10.5", os: "linux", boardColumn: "foothold",
  boardManual: false, dualHomed: false, boardDerived: null, access: "none", createdAt: 1, updatedAt: 1,
};

const stored: Record<string, Note> = {};
const noteKey = (h: string | null) => h ?? "";
function setStored(hostId: string | null, body: string, priv = false) {
  stored[noteKey(hostId)] = { ownerId: hostId ?? "e1", engagementId: "e1", hostId, body, private: priv, updatedAt: 5 };
}

let go: (to: string) => void = () => {};
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    go = (to) => void navigate(to);
  }, [navigate]);
  return null;
}

function mount(path: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <input aria-label="probe" />
        <Nav />
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const panel = () => screen.findByRole("complementary", { name: /Notes/ });

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  resetNotesStore();
  useCaptureStore.getState().reset();
  for (const k of Object.keys(stored)) delete stored[k];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.vaultLock.mockResolvedValue(null);
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.notesGet.mockImplementation(async (_e, hostId) => stored[noteKey(hostId)] ?? { ownerId: hostId ?? "e1", engagementId: "e1", hostId, body: "", private: false, updatedAt: 0 });
  m.noteSave.mockImplementation(async (_e, hostId, body, isPrivate) => ({
    ownerId: hostId ?? "e1", engagementId: "e1", hostId, body, private: isPrivate, updatedAt: 9,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

async function open(user: ReturnType<typeof userEvent.setup>, path: string) {
  mount(path);
  await vi.waitFor(() => expect(m.engagementGet).toHaveBeenCalled());
  await screen.findByText("Mock exam A");
  await user.keyboard("n");
  const p = await panel();
  const ta = await within(p).findByLabelText("Notes");
  await vi.waitFor(() => expect(ta).not.toHaveAttribute("readonly"));
  return { p, ta: ta as HTMLTextAreaElement };
}

describe("field notes panel", () => {
  it("N opens host notes in a host view and engagement notes elsewhere", async () => {
    setStored("h1", "host body");
    setStored(null, "eng body");
    const user = userEvent.setup();
    const a = await open(user, "/e/e1/h/h1");
    expect(within(a.p).getByText("Notes · VEGA")).toBeInTheDocument();
    await vi.waitFor(() => expect(a.ta).toHaveValue("host body"));
    expect(m.notesGet).toHaveBeenCalledWith("e1", "h1");
    expect(within(a.p).getByRole("button", { name: "Host" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: /Notes/ })).not.toBeInTheDocument();
  });

  it("opens engagement notes outside a host view", async () => {
    setStored(null, "eng body");
    const user = userEvent.setup();
    const a = await open(user, "/e/e1");
    expect(within(a.p).getByText("Notes · Mock exam A")).toBeInTheDocument();
    await vi.waitFor(() => expect(a.ta).toHaveValue("eng body"));
    expect(m.notesGet).toHaveBeenCalledWith("e1", null);
    expect(within(a.p).getByRole("button", { name: "Host" })).toBeDisabled();
  });

  it("typing autosaves after 500ms", async () => {
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1");
    vi.useFakeTimers({ shouldAdvanceTime: false });
    fireEvent.change(ta, { target: { value: "nmap found 8080" } });
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(m.noteSave).not.toHaveBeenCalled();
    fireEvent.change(ta, { target: { value: "nmap found 8080, creds in .env" } });
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(m.noteSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(m.noteSave).toHaveBeenCalledTimes(1);
    expect(m.noteSave).toHaveBeenCalledWith("e1", null, "nmap found 8080, creds in .env", false);
  });

  it("the Private toggle is saved with the text", async () => {
    const user = userEvent.setup();
    const { p, ta } = await open(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "secret" } });
    await user.click(within(p).getByRole("button", { name: "Private" }));
    expect(within(p).getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenLastCalledWith("e1", null, "secret", true), { timeout: 2000 });
  });

  it("closing flushes pending text immediately", async () => {
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "close me" } });
    expect(m.noteSave).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", null, "close me", false));
  });

  it("switching with cmd+E flushes pending text and loads the other scope", async () => {
    setStored(null, "eng body");
    const user = userEvent.setup();
    const { p, ta } = await open(user, "/e/e1/h/h1");
    fireEvent.change(ta, { target: { value: "host text" } });
    await user.keyboard("{Meta>}e{/Meta}");
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", "h1", "host text", false));
    expect(within(p).getByText("Notes · Mock exam A")).toBeInTheDocument();
    await vi.waitFor(() => expect(within(p).getByLabelText("Notes")).toHaveValue("eng body"));
    await user.click(within(p).getByRole("button", { name: "Host" }));
    expect(await within(p).findByText("Notes · VEGA")).toBeInTheDocument();
  });

  it("navigating flushes pending text immediately", async () => {
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1/h/h1");
    fireEvent.change(ta, { target: { value: "before navigating" } });
    expect(m.noteSave).not.toHaveBeenCalled();
    act(() => go("/e/e1"));
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalledWith("e1", "h1", "before navigating", false));
  });

  it("lock flushes pending notes before locking", async () => {
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "last words" } });
    await user.keyboard("{Meta>}l{/Meta}");
    await vi.waitFor(() => expect(m.vaultLock).toHaveBeenCalled());
    expect(m.noteSave).toHaveBeenCalledWith("e1", null, "last words", false);
    expect(m.noteSave.mock.invocationCallOrder[0]).toBeLessThan(m.vaultLock.mock.invocationCallOrder[0]!);
  });

  it("still locks when the flush fails, and keeps the text for the next unlock", async () => {
    m.noteSave.mockRejectedValue(new RavenError("io", "disk"));
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "keep" } });
    await user.keyboard("{Meta>}l{/Meta}");
    await vi.waitFor(() => expect(m.vaultLock).toHaveBeenCalled());
  });

  it("shows the server's body error and keeps the text", async () => {
    m.noteSave.mockRejectedValue(new RavenError("validation", "Note is too long (over 1 MiB)", "body"));
    const user = userEvent.setup();
    const { p, ta } = await open(user, "/e/e1");
    fireEvent.change(ta, { target: { value: "huge" } });
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(m.noteSave).toHaveBeenCalled());
    await user.keyboard("n");
    const again = await panel();
    expect(await within(again).findByRole("alert")).toHaveTextContent("Note is too long (over 1 MiB)");
    expect(within(again).getByLabelText("Notes")).toHaveValue("huge");
    void p;
    void ta;
  });

  it("N inside an input types the letter", async () => {
    const user = userEvent.setup();
    mount("/e/e1");
    await screen.findByText("Mock exam A");
    await user.click(screen.getByLabelText("probe"));
    await user.keyboard("n");
    expect(screen.getByLabelText("probe")).toHaveValue("n");
    expect(screen.queryByRole("complementary", { name: /Notes/ })).not.toBeInTheDocument();
  });

  it("N inside the notes textarea types the letter", async () => {
    const user = userEvent.setup();
    const { ta } = await open(user, "/e/e1");
    await user.click(ta);
    await user.keyboard("n");
    expect(ta).toHaveValue("n");
  });

  it("resizes from the left-edge handle within 320px and 70% of the window, and remembers it", async () => {
    const user = userEvent.setup();
    window.innerWidth = 1000;
    const { p } = await open(user, "/e/e1");
    const handle = within(p).getByRole("separator");
    expect(p.style.width).toBe("440px");
    fireEvent.mouseDown(handle, { clientX: 560 });
    fireEvent.mouseMove(window, { clientX: 460 });
    expect(p.style.width).toBe("540px");
    fireEvent.mouseMove(window, { clientX: 0 });
    expect(p.style.width).toBe("700px");
    fireEvent.mouseMove(window, { clientX: 990 });
    expect(p.style.width).toBe("320px");
    fireEvent.mouseUp(window);
    expect(localStorage.getItem("raven.notes.width")).toBe("320");
  });
});
