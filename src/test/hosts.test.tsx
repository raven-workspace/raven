import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import { RavenError } from "../types/errors";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1",
  name: "Mock exam A",
  kind: "lab",
  client: null,
  subLabel: null,
  scopeCidrs: ["10.10.10.0/24"],
  domain: null,
  startsAt: null,
  endsAt: null,
  timeboxStart: null,
  timeboxMinutes: null,
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  lastActivityAt: null,
  lastRanOn: null, msfHostId: null,
};

function host(over: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    engagementId: "e1",
    ip: null,
    os: null,
    boardColumn: "enumerate",
    boardManual: false, dualHomed: false, boardDerived: null,
    access: "none",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

let hosts: Host[];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function mount(path = "/e/e1") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  hosts = [
    host({ id: "h1", name: "dc01", ip: "10.10.10.5", boardColumn: "foothold" }),
    host({ id: "h2", name: "web02", ip: "10.10.10.6", boardColumn: "done" }),
  ];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockImplementation(async () => hosts);
  m.engagementsProgress.mockResolvedValue({
    e1: { hostsTotal: 6, hostsRooted: 3, flagsFound: 7, flagsTotal: 9 },
  });
});

describe("hosts", () => {
  it("sidebar lists hosts and opens host route", async () => {
    const user = userEvent.setup();
    mount();
    const nav = await screen.findByRole("navigation", { name: "Engagement" });
    const dc = await within(nav).findByRole("link", { name: /dc01/ });
    expect(within(dc).getByRole("img", { name: "Foothold" })).toBeInTheDocument();
    expect(within(dc).getByText("10.10.10.5")).toHaveClass("font-mono");
    expect(within(nav).getByRole("img", { name: "Done" })).toBeInTheDocument();
    await user.click(dc);
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/h/h1");
    expect(within(nav).getByRole("link", { name: /dc01/ })).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/e\/e1$/);
  });

  it("add host dialog creates and shows field error for duplicate ip", async () => {
    const user = userEvent.setup();
    m.hostCreate.mockRejectedValueOnce(new RavenError("validation", "A host with this IP already exists", "ip"));
    mount();
    await user.click(await screen.findByRole("button", { name: "+ Add host" }));
    const dialog = await screen.findByRole("dialog", { name: "Add host" });
    await user.type(within(dialog).getByLabelText("Name"), "dc03");
    await user.type(within(dialog).getByLabelText("IP"), "10.10.10.5");
    await user.click(within(dialog).getByRole("button", { name: "Add host" }));
    expect(await within(dialog).findByText("A host with this IP already exists")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("IP")).toHaveAttribute("aria-invalid", "true");

    m.hostCreate.mockImplementationOnce(async (_id, input) => {
      const h = host({ id: "h3", name: input.name, ip: input.ip ?? null });
      hosts = [...hosts, h];
      return h;
    });
    const ip = within(dialog).getByLabelText("IP");
    await user.clear(ip);
    await user.type(ip, "10.10.10.9");
    await user.click(within(dialog).getByRole("button", { name: "Add host" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.hostCreate).toHaveBeenLastCalledWith("e1", { name: "dc03", ip: "10.10.10.9", os: null, access: "none" });
    expect(await within(await screen.findByRole("navigation", { name: "Engagement" })).findByRole("link", { name: /dc03/ })).toBeInTheDocument();
  });

  it("number keys navigate section routes", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("2");
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/s/log");
    await user.keyboard("5");
    expect(screen.getByTestId("where")).toHaveTextContent("/e/e1/s/checklist");
    await user.keyboard("1");
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/e\/e1$/);
  });

  it("status strip shows progress from api", async () => {
    mount();
    const strip = await screen.findByRole("status", { name: "Engagement status" });
    expect(await within(strip).findByText("Rooted 3/6 · flags 7/9")).toBeInTheDocument();
  });

  it("saving engagement scope refreshes hosts", async () => {
    const user = userEvent.setup();
    m.engagementUpdate.mockImplementation(async (_id, input) => ({ ...E1, ...input }) as Engagement);
    mount();
    await within(await screen.findByRole("navigation", { name: "Engagement" })).findByRole("link", { name: /dc01/ });
    expect(m.hostsList).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit engagement" });
    hosts = [...hosts, host({ id: "h4", name: "new04", ip: "10.10.10.20" })];
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(await screen.findByRole("navigation", { name: "Engagement" })).findByRole("link", { name: /new04/ })).toBeInTheDocument();
  });
});
