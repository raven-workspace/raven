import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROP, StatusBar } from "../features/workspace/StatusBar/StatusBar";
import { ringLabel } from "../features/workspace/TimeboxCell/TimeboxCell";
import { api } from "../lib/api";
import { setOs } from "../lib/shortcuts";
import type { Engagement } from "../types/engagement";
import type { Settings } from "../types/settings";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const MIN = 60_000;
const HOUR = 60 * MIN;

const sim = (over: Partial<Engagement> = {}): Engagement => ({
  id: "e1", name: "Mock exam", kind: "exam-sim", client: null, subLabel: null, scopeCidrs: [], domain: null,
  startsAt: null, endsAt: null, timeboxStart: Date.now() - 3 * HOUR, timeboxMinutes: 24 * 60, status: "active",
  createdAt: 0, updatedAt: 0, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0,
  timeboxPausedAt: null, ...over,
});
const settings = (over: Partial<Settings> = {}) => ({ attackerIp: "192.0.2.10", listenerPort: "4444", ...over }) as Settings;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/e/e1"]}>
        <StatusBar engagementId="e1" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders the bar and waits for it. */
const bar = () => {
  renderBar();
  return screen.findByRole("status", { name: "Engagement status" });
};

beforeEach(() => {
  m.engagementGet.mockResolvedValue(sim());
  m.settingsGet.mockResolvedValue(settings());
  m.tun0Address.mockResolvedValue(null);
  m.engagementsProgress.mockResolvedValue({ e1: { hostsTotal: 3, hostsRooted: 0, flagsFound: 2, flagsTotal: 6 } });
  m.cleanupCounts.mockResolvedValue({ e1: 1 });
  m.notesList.mockResolvedValue([]);
  m.hostsList.mockResolvedValue([]);
});

afterEach(() => {
  setOs("mac");
  vi.restoreAllMocks();
});

describe("the status bar's cells", () => {
  it("shows LHOST, listeners, Rooted, Flags, Metasploit and Cleanup in order, then the timebox", async () => {
    const b = await bar();
    await within(b).findByRole("link", { name: "LHOST 192.0.2.10" });
    await within(b).findByText("0 listeners");
    await within(b).findByRole("group", { name: "Rooted 0/3" });
    expect(within(b).getByRole("group", { name: "Flags 2/6" })).toBeInTheDocument();
    expect(within(b).getByRole("button", { name: /Metasploit/ })).toBeInTheDocument();
    await within(b).findByRole("group", { name: "Cleanup 1" });
    // No open threads: no Threads cell.
    expect(within(b).queryByRole("group", { name: /^Threads/ })).toBeNull();
    const text = b.textContent ?? "";
    const order = ["LHOST", "0 listeners", "Rooted", "Flags", "Metasploit", "Cleanup", "Timebox"].map((t) => text.indexOf(t));
    expect(order).toEqual([...order].sort((a, z) => a - z));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("drops cells in the strip's order, and never LHOST or the timebox", async () => {
    const b = await bar();
    await within(b).findByRole("group", { name: "Cleanup 1" });
    const step = (el: Element | null) => Number((el?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? NaN);
    expect(step(within(b).getByText("0 listeners"))).toBe(DROP.listeners);
    const cleanup = step(within(b).getByRole("group", { name: "Cleanup 1" }));
    const msf = step(within(b).getByRole("button", { name: /Metasploit/ }));
    const flags = step(within(b).getByRole("group", { name: "Flags 2/6" }));
    const rooted = step(within(b).getByRole("group", { name: "Rooted 0/3" }));
    expect(DROP.threads).toBeGreaterThan(cleanup);
    expect(msf).toBeGreaterThan(DROP.threads);
    expect(Math.min(flags, rooted)).toBeGreaterThan(msf);
    expect(within(b).getByRole("group", { name: "LHOST" }).closest("[data-drop]")).toBeNull();
    expect(within(b).getByRole("group", { name: "Timebox" }).closest("[data-drop]")).toBeNull();
  });

  it("an engagement with no timebox shows its dates at the right end, and no Metasploit", async () => {
    m.engagementGet.mockResolvedValue(sim({ kind: "lab", timeboxStart: null, timeboxMinutes: null }));
    const b = await bar();
    await within(b).findByRole("group", { name: /^Dates/ });
    expect(within(b).queryByRole("group", { name: "Timebox" })).toBeNull();
    expect(within(b).queryByRole("button", { name: /Metasploit/ })).toBeNull();
  });
});

describe("LHOST", () => {
  it("opens Settings from the value", async () => {
    const b = await bar();
    await userEvent.click(await within(b).findByRole("link", { name: /^LHOST/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/settings");
  });

  it("shows the address alone, never the listener port", async () => {
    const b = await bar();
    const value = await within(b).findByRole("link", { name: "LHOST 192.0.2.10" });
    expect(value).toHaveTextContent(/^192\.0\.2\.10$/);
    expect(b).not.toHaveTextContent("4444");
  });

  it("not set reads amber, and Copy is off", async () => {
    m.settingsGet.mockResolvedValue(settings({ attackerIp: "", listenerPort: "" }));
    const b = await bar();
    const value = await within(b).findByRole("link", { name: "LHOST not set" });
    expect(value).toHaveClass("lhost-cell__value--warn");
    expect(within(b).getByRole("button", { name: "Copy LHOST" })).toBeDisabled();
  });

  it("Copy and ⌘⇧L copy the address alone", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const b = await bar();
    await within(b).findByRole("link", { name: /^LHOST/ });
    await userEvent.click(within(b).getByRole("button", { name: "Copy LHOST" }));
    expect(write).toHaveBeenLastCalledWith("192.0.2.10");
    write.mockClear();
    fireEvent.keyDown(window, { key: "L", code: "KeyL", metaKey: true, shiftKey: true });
    expect(write).toHaveBeenCalledWith("192.0.2.10");
    // ⌘L alone is the lock, not a copy.
    write.mockClear();
    fireEvent.keyDown(window, { key: "l", code: "KeyL", metaKey: true });
    expect(write).not.toHaveBeenCalled();
  });

  it("on Linux the copy key is Ctrl+Alt+L", async () => {
    setOs("linux");
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const b = await bar();
    await within(b).findByRole("link", { name: /^LHOST/ });
    fireEvent.keyDown(window, { key: "l", code: "KeyL", ctrlKey: true, altKey: true });
    expect(write).toHaveBeenCalledWith("192.0.2.10");
  });

  it("turns amber when tun0 differs from Settings, and a click sets tun0's address", async () => {
    m.tun0Address.mockResolvedValue("10.10.14.7");
    m.settingsUpdate.mockResolvedValue(settings({ attackerIp: "10.10.14.7" }));
    const b = await bar();
    const offer = await within(b).findByRole("button", { name: "LHOST 192.0.2.10. tun0 is 10.10.14.7. Use it" });
    expect(offer).toHaveClass("lhost-cell__value--warn");
    await userEvent.click(offer);
    expect(m.settingsUpdate).toHaveBeenCalledWith({ attackerIp: "10.10.14.7" });
    // Settings now match tun0: back to the plain value.
    await within(b).findByRole("link", { name: "LHOST 10.10.14.7" });
  });

  it("no change when tun0 matches Settings, or there is no tun0", async () => {
    m.tun0Address.mockResolvedValue("192.0.2.10");
    const b = await bar();
    const value = await within(b).findByRole("link", { name: "LHOST 192.0.2.10" });
    expect(value).toHaveClass("lhost-cell__value--set");
    await waitFor(() => expect(m.tun0Address).toHaveBeenCalled());
    expect(within(b).queryByRole("button", { name: /tun0/ })).toBeNull();
  });
});

describe("the timebox", () => {
  it("running: Pause, an accent ring and time left", async () => {
    const b = await bar();
    const t = await within(b).findByRole("group", { name: "Timebox" });
    expect(within(t).getByRole("button", { name: "Pause timebox" })).toBeInTheDocument();
    expect(within(t).getByRole("img", { name: "13% of 24 hours used" })).toBeInTheDocument();
    expect(within(t).getByText(/^2[01]h \d+m left$/)).toHaveClass("timebox-text--running");
    expect(t.querySelector(".time-ring__used--running")).not.toBeNull();
  });

  it("paused: Resume (a click), the ring and text muted", async () => {
    const pausedAt = Date.now() - HOUR;
    m.engagementGet.mockResolvedValue(sim({ timeboxPausedAt: pausedAt }));
    m.engagementSetTimeboxPaused.mockResolvedValue(sim());
    const b = await bar();
    const t = await within(b).findByRole("group", { name: "Timebox" });
    expect(within(t).getByText(/^2[12]h \d+m left$/)).toHaveClass("timebox-text--paused");
    expect(t.querySelector(".time-ring__used--paused")).not.toBeNull();
    await userEvent.click(within(t).getByRole("button", { name: "Resume timebox" }));
    expect(m.engagementSetTimeboxPaused).toHaveBeenCalledWith("e1", false);
  });

  it("over time: no button, a full amber ring and Time's up", async () => {
    m.engagementGet.mockResolvedValue(sim({ timeboxStart: Date.now() - 25 * HOUR }));
    const b = await bar();
    const t = await within(b).findByRole("group", { name: "Timebox" });
    expect(within(t).queryByRole("button")).toBeNull();
    expect(within(t).getByText("Time's up")).toHaveClass("timebox-text--over");
    expect(t.querySelector(".time-ring__used--over")?.getAttribute("stroke-dasharray")).toBe("37.70 37.7");
  });

  it("not started: no button, the track only", async () => {
    m.engagementGet.mockResolvedValue(sim({ timeboxStart: null }));
    const b = await bar();
    const t = await within(b).findByRole("group", { name: "Timebox" });
    expect(within(t).queryByRole("button")).toBeNull();
    expect(within(t).getByText("Not started")).toHaveClass("timebox-text--not-started");
    expect(within(t).getByRole("img", { name: "Not started" })).toBeInTheDocument();
    expect(t.querySelector(".time-ring__used")).toBeNull();
  });

  it("no key pauses it", async () => {
    const b = await bar();
    await within(b).findByRole("button", { name: "Pause timebox" });
    for (const key of [" ", "p", "P", "Enter"]) fireEvent.keyDown(window, { key });
    expect(m.engagementSetTimeboxPaused).not.toHaveBeenCalled();
  });

  it("the ring's label carries the total", () => {
    expect(ringLabel("running", 0.12, 1440)).toBe("12% of 24 hours used");
    expect(ringLabel("paused", 0.12, 1440)).toBe("12% of 24 hours used, paused");
    expect(ringLabel("over", 1, 1440)).toBe("24 hours used");
    expect(ringLabel("not-started", 0, 1440)).toBe("Not started");
    expect(ringLabel("running", 0.5, 1425)).toBe("50% of 23h 45m used");
    expect(ringLabel("running", 0.5, 60)).toBe("50% of 1 hour used");
  });
});
