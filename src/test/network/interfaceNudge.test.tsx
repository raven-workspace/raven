import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactsColumn } from "../../features/hosts/facts/FactsColumn/FactsColumn";
import { api } from "../../lib/api";
import { makeQueryClient } from "../../lib/queryClient";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

vi.mock("../../lib/api");
const m = vi.mocked(api, true);

const H1: Host = {
  id: "h1", engagementId: "e1", name: "web07", ip: "10.10.10.5", os: "linux", boardColumn: "initial-foothold",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  access: "user", createdAt: 1, updatedAt: 1,
};

const IP_A = [
  "1: lo: <LOOPBACK,UP> mtu 65536",
  "    inet 127.0.0.1/8 scope host lo",
  "2: eth0: <BROADCAST,UP> mtu 1500",
  "    inet 10.10.10.5/24 brd 10.10.10.255 scope global eth0",
  "3: eth1: <BROADCAST,UP> mtu 1500",
  "    inet 172.16.5.10/24 brd 172.16.5.255 scope global eth1",
  "4: docker0: <NO-CARRIER,UP> mtu 1500",
  "    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0",
].join("\n");

const entry = (output: string): LogEntry => ({
  id: "l1", engagementId: "e1", kind: "command", title: "ip a", titleEdited: false, ranOn: null, hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false, content: { kind: "command", blocks: [{ command: "ip a", output }] },
  at: 10, createdAt: 10, updatedAt: 10,
});

function mount(host: Host, output = IP_A) {
  m.hostsList.mockResolvedValue([host]);
  m.logList.mockResolvedValue([entry(output)]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <FactsColumn engagementId="e1" host={host} variant="column" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowText = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.servicesList.mockResolvedValue([]);
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.engagementGet.mockResolvedValue(null as never);
  m.tunnelsList.mockResolvedValue([]);
  m.interfaceDismissalsList.mockResolvedValue([]);
});

describe("InterfaceNudge", () => {
  it("names the new subnet, marks the host dual-homed, then opens the tunnel form prefilled", async () => {
    const user = userEvent.setup();
    m.hostUpdate.mockResolvedValue({ ...H1, dualHomed: true });
    mount(H1);
    expect(await screen.findByText(rowText("eth1 172.16.5.10/24 reaches 172.16.5.0/24."))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark dual-homed and add tunnel" }));
    expect(m.hostUpdate).toHaveBeenCalledWith("h1", expect.objectContaining({ name: "web07", ip: "10.10.10.5", dualHomed: true }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    expect(within(dialog).getByLabelText("Subnets")).toHaveValue("172.16.5.0/24");
    expect(within(dialog).getByRole("combobox", { name: /^Via host/ })).toHaveTextContent("web07");
  });

  it("a dual-homed host skips the update and just offers Add tunnel", async () => {
    const user = userEvent.setup();
    mount({ ...H1, dualHomed: true });
    await user.click(await screen.findByRole("button", { name: "Add tunnel" }));
    expect(m.hostUpdate).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Add tunnel" })).toBeInTheDocument();
  });

  it("dismiss is remembered for this host and subnet, and the row goes", async () => {
    const user = userEvent.setup();
    const stored: { engagementId: string; hostId: string; subnet: string }[] = [];
    m.interfaceDismissalsList.mockImplementation(async () => [...stored] as never);
    m.interfaceDismiss.mockImplementation(async (engagementId, hostId, subnet) => {
      stored.push({ engagementId, hostId, subnet });
      return null as never;
    });
    mount(H1);
    await user.click(await screen.findByRole("button", { name: "Dismiss 172.16.5.0/24 on web07" }));
    expect(m.interfaceDismiss).toHaveBeenCalledWith("e1", "h1", "172.16.5.0/24");
    await vi.waitFor(() => expect(screen.queryByText(rowText("eth1 172.16.5.10/24 reaches 172.16.5.0/24."))).not.toBeInTheDocument());
  });

  it("virtual adapters show as one quiet line, never a nudge", async () => {
    mount(H1);
    expect(await screen.findByText("Also seen:")).toBeInTheDocument();
    expect(screen.getByText("docker0 172.17.0.1/16 (virtual)")).toBeInTheDocument();
    expect(screen.queryByText(/172\.17\.0\.0\/16\./)).not.toBeInTheDocument();
  });

  it("a host with no IP shows no rows", async () => {
    mount({ ...H1, ip: null }, IP_A.replace(/docker0[\s\S]*$/, ""));
    await screen.findByRole("region", { name: "Facts" });
    expect(screen.queryByText(/reaches/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark dual-homed and add tunnel" })).not.toBeInTheDocument();
  });
});
