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
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "foothold",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, access: "user", createdAt: 1, updatedAt: 1,
};
const svc = (id: string, port: number, over: Partial<Service> = {}): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService: null, nmapVersion: null,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, createdAt: 1, updatedAt: 1, ...over,
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
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "" });
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
  m.serviceConfirm.mockResolvedValue(svc("s3", 22));
  m.hostDelete.mockResolvedValue(null);
});

describe("host view", () => {
  it("header shows ip os access and stage", async () => {
    mount();
    const header = within(await screen.findByRole("region", { name: "Host" }));
    expect(header.getByText("dc01")).toBeInTheDocument();
    expect(header.getByText("10.10.10.5")).toHaveClass("font-mono");
    expect(header.getByText("Windows")).toBeInTheDocument();
    expect(header.getByText("user")).toHaveAttribute("data-variant", "accent");
    expect(header.getByText("Foothold")).toBeInTheDocument();
  });

  it("confirmed service shows identity with nmap guess dimmed", async () => {
    mount();
    const row = (await screen.findByRole("button", { name: /80\/tcp/ })).closest("li")!;
    expect(within(row).getByText("nginx 1.18")).toBeInTheDocument();
    expect(within(row).getByText("✓")).toHaveClass("text-accent");
    expect(within(row).getByText("http Apache 2.4")).toHaveClass("text-faint");
  });

  it("unidentified service flagged", async () => {
    mount();
    const row = (await screen.findByRole("button", { name: /445\/tcp/ })).closest("li")!;
    expect(within(row).getByText("unidentified")).toHaveClass("text-warn");
    const ssh = (await screen.findByRole("button", { name: /22\/tcp/ })).closest("li")!;
    expect(within(ssh).getByText("ssh OpenSSH 8.2")).toHaveClass("text-muted");
  });

  it("confirm dialog sends product version and proving entry", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /22\/tcp/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Product"), "OpenSSH");
    await user.type(within(dialog).getByLabelText("Version"), "8.2p1");
    await user.click(within(dialog).getByRole("combobox", { name: "Proved by" }));
    await user.click(await screen.findByRole("option", { name: "older on dc01" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(m.serviceConfirm).toHaveBeenCalledWith("s3", { product: "OpenSSH", version: "8.2p1", entryId: "o" });
  });

  it("service dialog edits port, protocol and nmap guess (I5)", async () => {
    m.serviceUpdate.mockResolvedValue(svc("s3", 2222));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /22\/tcp/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit 22/tcp" });
    const port = within(dialog).getByLabelText("Port");
    expect(port).toHaveValue("22");
    expect(within(dialog).getByLabelText("Service")).toHaveValue("ssh");
    expect(within(dialog).getByLabelText("Version")).toHaveValue("OpenSSH 8.2");
    await user.clear(port);
    await user.type(port, "2222");
    await user.clear(within(dialog).getByLabelText("Version"));
    await user.type(within(dialog).getByLabelText("Version"), "OpenSSH 9.6");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(m.serviceUpdate).toHaveBeenCalledWith("s3", { port: 2222, protocol: "tcp", nmapService: "ssh", nmapVersion: "OpenSSH 9.6" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("service dialog deletes after a confirm (I5)", async () => {
    m.serviceDelete.mockResolvedValue(null);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /445\/tcp/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete 445/tcp?" });
    expect(m.serviceDelete).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete service" }));
    expect(m.serviceDelete).toHaveBeenCalledWith("s2");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a service that is not open shows its state (M1)", async () => {
    m.servicesList.mockResolvedValue([svc("s1", 80, { nmapService: "http" }), svc("s4", 161, { protocol: "udp", state: "open|filtered", nmapService: "snmp" })]);
    mount();
    const snmp = (await screen.findByRole("button", { name: /161\/udp/ })).closest("li")!;
    expect(within(snmp).getByText("open|filtered")).toBeInTheDocument();
    const http = screen.getByRole("button", { name: /80\/tcp/ }).closest("li")!;
    expect(within(http).queryByText("open")).not.toBeInTheDocument();
  });

  it("story tab lists host entries oldest first", async () => {
    mount();
    await screen.findByText("older on dc01");
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("on dc01"));
    expect(items.map((li) => within(li).getAllByRole("button")[0]!.textContent)).toEqual([
      expect.stringContaining("older on dc01"),
      expect.stringContaining("newer on dc01"),
    ]);
    expect(screen.queryByText("other host")).not.toBeInTheDocument();
  });

  it("story order flips to newest first", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("older on dc01");
    await user.click(screen.getByRole("button", { name: /Switch to newest first/ }));
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("on dc01"));
    expect(items.map((li) => within(li).getAllByRole("button")[0]!.textContent)).toEqual([
      expect.stringContaining("newer on dc01"),
      expect.stringContaining("older on dc01"),
    ]);
  });

  it("capture from host view preselects the host", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("older on dc01");
    await user.keyboard("l");
    const dialog = await screen.findByRole("dialog", { name: "Add to log" });
    expect(within(within(dialog).getByRole("group", { name: "Hosts" })).getByText("dc01")).toBeInTheDocument();
  });

  it("esc goes back to board", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("older on dc01");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/e\/e1$/);
  });
});
