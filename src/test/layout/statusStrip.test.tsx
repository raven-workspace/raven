import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { resyncBoards } from "../../features/checklist/ticks";
import { api } from "../../lib/api";
import { makeQueryClient } from "../../lib/queryClient";
import type { Engagement } from "../../types/engagement";

vi.mock("../../lib/api");
vi.mock("../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../features/checklist/ticks")>()),
  resyncBoards: vi.fn(),
}));
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: ["192.0.2.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};

beforeEach(() => {
  vi.mocked(resyncBoards).mockReset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ attackerIp: "192.0.2.9", listenerPort: "443", autoLockMinutes: 30 } as never);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  for (const k of ["hostsList", "servicesList", "servicesListEngagement", "checklistList", "checklistPut", "logList", "notesList", "tunnelsList"] as const)
    (m[k] as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([]);
  m.notesGet.mockResolvedValue({ engagementId: "e1", hostId: null, body: "", updatedAt: 1 } as never);
});

async function mountStrip() {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByRole("status", { name: "Engagement status" });
}

describe("status strip and title bar", () => {
  it("status strip has no keyboard hints", async () => {
    const strip = await mountStrip();
    expect(strip.querySelector("kbd")).toBeNull();
    expect(strip).not.toHaveTextContent(/sections|engagements/);
  });

  it("cells are labelled in priority order", async () => {
    const strip = await mountStrip();
    await within(strip).findByText("LHOST");
    const labels = [...strip.querySelectorAll("span")]
      .filter((s) => /^(Dates|Timebox|Rooted|Flags|Metasploit|Threads|Cleanup|LHOST)$/.test(s.textContent ?? "") && s.children.length === 0)
      .map((s) => s.textContent);
    expect(labels).toEqual(["Dates", "Rooted", "Flags", "Metasploit", "LHOST"]);
  });

  it("with a timebox, open threads and cleanup, every cell is in the documented order", async () => {
    const timed: Engagement = { ...E1, timeboxStart: 1, timeboxMinutes: 1440 };
    m.engagementGet.mockResolvedValue(timed);
    m.engagementsList.mockResolvedValue([timed]);
    m.notesList.mockResolvedValue([{ ownerId: "e1", engagementId: "e1", hostId: null, body: "? why is 445 filtered\n? retry the share", private: false, updatedAt: 1 }] as never);
    m.cleanupCounts.mockResolvedValue({ e1: 2 });
    const strip = await mountStrip();
    await within(strip).findByText("Cleanup");
    await within(strip).findByText("Threads");
    const labels = [...strip.querySelectorAll("span")]
      .filter((s) => /^(Dates|Timebox|Rooted|Flags|Metasploit|Threads|Cleanup|LHOST)$/.test(s.textContent ?? "") && s.children.length === 0)
      .map((s) => s.textContent);
    expect(labels).toEqual(["Timebox", "Rooted", "Flags", "Metasploit", "Threads", "Cleanup", "LHOST"]);
  });

  it("metasploit cell shows the brand icon", async () => {
    const strip = await mountStrip();
    const btn = await within(strip).findByRole("button", { name: /Metasploit unused/ });
    const img = btn.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toMatch(/Metasploit/);
    expect(img).toHaveAttribute("alt", "");
  });

  it("settings is the last title bar control and is an icon button named Settings", async () => {
    await mountStrip();
    const controls = [...screen.getByRole("button", { name: "Settings" }).closest("[data-tauri-drag-region] > div")!.querySelectorAll("button")];
    expect(controls.at(-1)).toBe(screen.getByRole("button", { name: "Settings" }));
    expect(controls.slice(0, -1).map((b) => b.getAttribute("aria-label") ?? b.textContent?.replace(/\s*(⌘\w|A|M|P)$/, "").trim())).toEqual(["Arsenal", "Manual", "Payloads", "Search", "Shortcuts", "Lock"]);
    expect(screen.getByRole("button", { name: "Settings" }).querySelector("svg")).not.toBeNull();
  });

  it("controls are the last track, inset like the content column", async () => {
    await mountStrip();
    const bar = document.querySelector<HTMLElement>("[data-tauri-drag-region]")!;
    expect(bar.className).toMatch(/grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
    expect(bar.className).toMatch(/\bpr-6\b/);
    const group = screen.getByRole("button", { name: "Settings" }).closest("[data-tauri-drag-region] > div")!;
    expect(bar.lastElementChild).toBe(group);
    expect(bar.firstElementChild!.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lock is an icon button whose key is in its tooltip and aria-keyshortcuts, not on the bar", async () => {
    await mountStrip();
    const lock = screen.getByRole("button", { name: "Lock" });
    expect(lock.querySelector("svg")).not.toBeNull();
    expect(lock.querySelector("kbd")).toBeNull();
    expect(lock).toHaveAttribute("aria-keyshortcuts", "Meta+L");
  });

  it("title bar controls are borderless chrome; the page on screen sits on the surface tint", async () => {
    await mountStrip();
    for (const name of ["Arsenal", "Manual", "Payloads", "Search", "Shortcuts", "Lock", "Settings"])
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) }).className).not.toMatch(/\bborder\b/);
  });
  it("Rooted and Flags show a dash, never 0/0, while progress loads or after it fails", async () => {
    m.engagementsProgress.mockImplementation(() => new Promise(() => {}));
    const strip = await mountStrip();
    await within(strip).findByText("LHOST");
    expect(within(strip).getByRole("group", { name: "Rooted \u2014" })).toBeInTheDocument();
    expect(within(strip).getByRole("group", { name: "Flags \u2014" })).toBeInTheDocument();
    expect(strip).not.toHaveTextContent("0/0");
  });

  it("a failed progress query flags Rooted and Flags as unavailable, not 0/0", async () => {
    m.engagementsProgress.mockRejectedValue(new Error("db locked"));
    const strip = await mountStrip();
    expect(await within(strip).findByRole("group", { name: "Rooted unavailable" })).toBeInTheDocument();
    expect(strip).not.toHaveTextContent("0/0");
  });
  it("a running exam-sim timebox shows a pause button and its time in the accent", async () => {
    const running: Engagement = { ...E1, timeboxStart: Date.now() - 60 * 60_000, timeboxMinutes: 1425 };
    m.engagementGet.mockResolvedValue(running);
    m.engagementsList.mockResolvedValue([running]);
    m.engagementSetTimeboxPaused.mockResolvedValue({ ...running, timeboxPausedAt: Date.now() });
    const strip = await mountStrip();
    const pause = await within(strip).findByRole("button", { name: "Pause timebox" });
    expect(within(strip).getByText(/left$/).className).toMatch(/\btext-accent\b/);
    fireEvent.click(pause);
    await waitFor(() => expect(m.engagementSetTimeboxPaused).toHaveBeenCalledWith("e1", true));
    expect(await within(strip).findByRole("button", { name: "Resume timebox" })).toBeInTheDocument();
  });

  it("a paused timebox shows its frozen time in grey and a resume button", async () => {
    const start = Date.now() - 30 * 60 * 60_000;
    const paused: Engagement = { ...E1, timeboxStart: start, timeboxMinutes: 1425, timeboxPausedAt: start + 2 * 60 * 60_000 };
    m.engagementGet.mockResolvedValue(paused);
    m.engagementsList.mockResolvedValue([paused]);
    const strip = await mountStrip();
    expect(await within(strip).findByRole("button", { name: "Resume timebox" })).toBeInTheDocument();
    const time = within(strip).getByText("21h 45m left");
    expect(time.className).toMatch(/\btext-muted\b/);
  });

  it("a timebox that is over or not started has no pause button", async () => {
    const notStarted: Engagement = { ...E1, timeboxStart: null, timeboxMinutes: 1425 };
    m.engagementGet.mockResolvedValue(notStarted);
    m.engagementsList.mockResolvedValue([notStarted]);
    const strip = await mountStrip();
    await within(strip).findByText("Not started");
    expect(within(strip).queryByRole("button", { name: /timebox/ })).toBeNull();
  });
});
