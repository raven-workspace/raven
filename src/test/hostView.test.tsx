import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "vulnerability-detection",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "user", createdAt: 1, updatedAt: 1,
};
const svc = (id: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1, ...over,
});
const T = new Date(2026, 10, 4, 9, 5).getTime();
const entry = (id: string, title: string, at: number, hostIds: string[]): LogEntry => ({
  id, engagementId: "e1", kind: "note", title, titleEdited: false, ranOn: null, hostIds, observations: null,
  returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at, createdAt: at, updatedAt: at,
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function mount() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([
    svc("s1", 80, { nmapService: "http", nmapVersion: "Apache 2.4", confirmedProduct: "nginx", confirmedVersion: "1.18" }),
    svc("s2", 445, { nmapService: "microsoft-ds?" }),
    svc("s3", 22, { nmapService: "ssh", nmapVersion: "OpenSSH 8.2" }),
  ]);
  m.logList.mockResolvedValue([
    entry("n", "newer on dc01", T + 60_000, ["h1"]),
    entry("o", "older on dc01", T, ["h1"]),
    entry("x", "other host", T + 1000, ["h2"]),
  ]);
  m.hostDelete.mockResolvedValue(null);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
});

async function openLog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Log" }));
  await screen.findByText("older on dc01");
}

describe("host view", () => {
  it("has exactly the tabs Next, Log and Findings, Next first and selected", async () => {
    mount();
    await screen.findByRole("tab", { name: "Next" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Next", "Log", "Findings"]);
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Story" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Credentials" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Checklist" })).not.toBeInTheDocument();
  });

  it("⌥2 selects Log, ⌥3 Findings and ⌥1 Next", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("{Alt>}2{/Alt}");
    expect(screen.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("older on dc01")).toBeInTheDocument();
    await user.keyboard("{Alt>}3{/Alt}");
    expect(screen.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Alt>}1{/Alt}");
    expect(screen.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  });

  it("⌥2 does nothing while typing in a field", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("l");
    const dialog = await screen.findByRole("dialog", { name: "Add to log" });
    await user.keyboard("{Alt>}2{/Alt}");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Next", hidden: true })).toHaveAttribute("aria-selected", "true");
  });

  it("has no Now panel", async () => {
    mount();
    await screen.findByRole("region", { name: "Facts" });
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Now" })).not.toBeInTheDocument();
  });

  it("the page is a host container: Facts beside the work column from 760px, stacked below", async () => {
    mount();
    const facts = await screen.findByRole("region", { name: "Facts" });
    const root = screen.getByRole("region", { name: "Host" }).parentElement!;
    expect(root.className).toMatch(/@container\/host/);
    expect(root.className).toMatch(/grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
    const body = facts.parentElement!.parentElement!;
    expect(body.className).toContain("@min-[760px]/host:grid-cols-[minmax(16rem,1fr)_minmax(0,1.4fr)]");
    expect(body).toContainElement(screen.getByRole("tablist"));
  });

  it("header shows ip os access and stage", async () => {
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    expect(header.getByText("dc01")).toBeInTheDocument();
    expect(header.getByText("10.10.10.5")).toHaveClass("font-mono");
    expect(header.getByText("Windows")).toBeInTheDocument();
    expect(header.getByText("user")).toHaveAttribute("data-variant", "accent");
    expect(header.getByText("Vulnerability detection")).toBeInTheDocument();
  });

  it("host header has no Delete button", async () => {
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    expect(header.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("Tab reaches Delete host in the edit dialog; Enter opens the confirm; Esc closes only the confirm", async () => {
    const user = userEvent.setup();
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    await user.click(header.getByRole("button", { name: "Edit" }));
    const edit = await screen.findByRole("dialog", { name: "Edit host" });
    const del = within(edit).getByRole("button", { name: "Delete host" });
    for (let i = 0; i < 40 && document.activeElement !== del; i++) await user.tab();
    expect(del).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Delete dc01?" })).toBeInTheDocument();
    expect(m.hostDelete).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete dc01?" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Edit host" })).toBeInTheDocument();
  });

  it("header shows the Windows brand icon beside the OS name", async () => {
    mount();
    const header = await screen.findByRole("region", { name: "Host" });
    expect(header.querySelector('img[data-brand="windows"]')).not.toBeNull();
  });

  it("a 255-character host name truncates and keeps its title", async () => {
    const long = "h".repeat(255);
    m.hostsList.mockResolvedValue([{ ...H1, name: long }]);
    mount();
    const title = within(await screen.findByRole("region", { name: "Host" })).getByRole("heading", { level: 1 });
    expect(title).toHaveAttribute("title", long);
    expect(title).toHaveClass("truncate");
  });

  it("host delete confirm says what goes with it and what stays", async () => {
    const user = userEvent.setup();
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    await user.click(header.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Delete host" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete dc01?" });
    expect(confirm).toHaveAccessibleDescription(
      "Its services, checklist items, credential test results, access grants on it, finding links, field notes, " +
        "ruled-out items, tunnels through it and hops to or from it go with it; " +
        "log entries, credentials and findings stay but lose this host.",
    );
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(m.hostDelete).not.toHaveBeenCalled();
  });

  it("host delete confirm names notes, ruled-out items, tunnels and hops", async () => {
    const user = userEvent.setup();
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    await user.click(header.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Delete host" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete dc01?" });
    const text = confirm.getAttribute("aria-describedby") ? document.getElementById(confirm.getAttribute("aria-describedby")!)!.textContent! : "";
    for (const part of ["field notes", "ruled-out items", "tunnels", "hops"]) expect(text).toContain(part);
  });

  it("log tab lists host entries oldest first", async () => {
    const user = userEvent.setup();
    mount();
    await openLog(user);
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("on dc01"));
    expect(items.map((li) => within(li).getAllByRole("button")[0]!.textContent)).toEqual([
      expect.stringContaining("older on dc01"),
      expect.stringContaining("newer on dc01"),
    ]);
    expect(screen.queryByText("other host")).not.toBeInTheDocument();
  });

  it("log order flips to newest first", async () => {
    const user = userEvent.setup();
    mount();
    await openLog(user);
    await user.click(screen.getByRole("button", { name: "Oldest first" }));
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("on dc01"));
    expect(items.map((li) => within(li).getAllByRole("button")[0]!.textContent)).toEqual([
      expect.stringContaining("newer on dc01"),
      expect.stringContaining("older on dc01"),
    ]);
  });

  it("capture from host view preselects the host", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("l");
    const dialog = await screen.findByRole("dialog", { name: "Add to log" });
    expect(within(within(dialog).getByRole("group", { name: "Hosts" })).getByText("dc01")).toBeInTheDocument();
  });

  it("esc goes back to board", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/e\/e1$/);
  });
});
