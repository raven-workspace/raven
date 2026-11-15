import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { api } from "../../lib/api";
import { makeQueryClient } from "../../lib/queryClient";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Hop, Tunnel } from "../../types/network";

vi.mock("../../lib/api");
const m = vi.mocked(api, true);

/** The section's measured width; undefined = not measured (jsdom), which draws the tree. */
const width = vi.hoisted(() => ({ value: undefined as number | undefined }));
vi.mock("../../lib/useWidth", () => ({ useWidth: () => [() => {}, width.value] as const }));

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const host = (id: string, name: string, ip: string, over: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "initial-foothold", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const WEB = host("h1", "WEB01", "10.10.10.5", { dualHomed: true });
const DB = host("h2", "DB01", "172.16.5.20");
const FILES = host("h3", "FILES", "10.10.10.9", { dualHomed: true, boardColumn: "information-gathering" });
const hop = (id: string, from: string | null, to: string, via: string, at: number): Hop => ({
  id, engagementId: "e1", fromHostId: from, toHostId: to, via, logEntryId: null, at, updatedAt: at,
});
const TUNNEL: Tunnel = {
  id: "t1", engagementId: "e1", kind: "ligolo", viaHostId: "h1", subnets: ["172.16.5.0/24"], callbackIp: "10.10.14.9",
  status: "up", notes: null, createdAt: 1, updatedAt: 1,
};

function mount({ hosts = [WEB, DB, FILES], hops = [hop("p1", null, "h1", "creds", 1), hop("p2", "h1", "h2", "exploit", 2)], tunnels = [TUNNEL], entry = "/e/e1/s/network" as string | { pathname: string; state: unknown } } = {}) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue(hosts);
  m.hopsList.mockResolvedValue(hops);
  m.tunnelsList.mockResolvedValue(tunnels);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  width.value = undefined;
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.findingsList.mockResolvedValue([]);
});

const section = () => screen.findByRole("region", { name: "Network" });
/** The node for a host: the list item that holds its name link. */
const nodeOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-host-node]")!;

describe("Network section", () => {
  it("pressing 5 opens Network", async () => {
    const user = userEvent.setup();
    mount({ entry: "/e/e1" });
    const nav = await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("5");
    expect(within(nav).getByRole("link", { name: /Network/ })).toHaveAttribute("aria-current", "page");
    expect(await section()).toBeInTheDocument();
  });

  it("draws Kali, then hosts by hop, with each edge labelled by how", async () => {
    mount();
    const s = await section();
    const tree = await within(s).findByRole("list", { name: "Attack path" });
    expect(tree).toHaveAttribute("data-variant", "tree");
    expect(within(tree).getByText("Kali")).toBeInTheDocument();
    expect(within(tree).getByText("10.10.14.9")).toBeInTheDocument();
    const web = within(tree).getByRole("link", { name: "WEB01" });
    expect(web).toHaveAttribute("href", "/e/e1/h/h1");
    expect(within(tree).getByRole("button", { name: "via creds" })).toBeInTheDocument();
    // DB01 hangs under WEB01.
    const webItem = web.closest<HTMLElement>("li")!;
    expect(within(webItem).getByRole("link", { name: "DB01" })).toBeInTheDocument();
    expect(within(webItem).getByRole("button", { name: "via exploit" })).toBeInTheDocument();
  });

  it("a hop chain reads left to right: B sits in A's children stack, not beside A", async () => {
    mount();
    const s = await section();
    const db = await within(s).findByRole("link", { name: "DB01" });
    const web = within(s).getByRole("link", { name: "WEB01" });
    expect(db.closest("[data-children-of]")).toHaveAttribute("data-children-of", "h1");
    expect(web.closest("[data-children-of]")).toHaveAttribute("data-children-of", "kali");
    // How each host was reached is inside its own node.
    expect(within(nodeOf(web)).getByRole("button", { name: "via creds" })).toBeInTheDocument();
    expect(within(nodeOf(db)).getByRole("button", { name: "via exploit" })).toBeInTheDocument();
  });

  it("clicking an edge label edits that hop", async () => {
    const user = userEvent.setup();
    mount();
    const s = await section();
    await user.click(await within(s).findByRole("button", { name: "via creds" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit hop" });
    expect(within(dialog).getByLabelText("Via")).toHaveValue("creds");
  });

  it("a tunnel is a badge on its pivot host that edits the tunnel", async () => {
    const user = userEvent.setup();
    mount();
    const s = await section();
    const chip = await within(s).findByRole("button", { name: /Ligolo tunnel/ });
    expect(chip).toHaveTextContent(/Ligolo\s*172\.16\.5\.0\/24\s*up/);
    expect(nodeOf(chip)).toBe(nodeOf(within(s).getByRole("link", { name: "WEB01" })));
    // WEB01 is dual-homed but has its tunnel: no marker on it.
    expect(within(nodeOf(chip)).queryByRole("button", { name: /Needs tunnel/ })).not.toBeInTheDocument();
    await user.click(chip);
    const dialog = await screen.findByRole("dialog", { name: "Edit tunnel" });
    expect(within(dialog).getByLabelText("Subnets")).toHaveValue("172.16.5.0/24");
  });

  it("a down tunnel is warn", async () => {
    mount({ tunnels: [{ ...TUNNEL, status: "down" }] });
    const s = await section();
    const chip = await within(s).findByRole("button", { name: /Ligolo tunnel/ });
    expect(chip.querySelector("[data-variant]")).toHaveAttribute("data-variant", "warn");
  });

  it("a dual-homed host with no tunnel through it needs one; the marker opens Add tunnel for it", async () => {
    const user = userEvent.setup();
    mount();
    const s = await section();
    const files = await within(s).findByRole("link", { name: "FILES" });
    await user.click(within(nodeOf(files)).getByRole("button", { name: /Needs tunnel/ }));
    const dialog = await screen.findByRole("dialog", { name: "Add tunnel" });
    expect(within(dialog).getByRole("combobox", { name: /^Via host/ })).toHaveTextContent("FILES");
  });

  it("hosts with no way in sit under Not reached", async () => {
    mount();
    const s = await section();
    const tray = await within(s).findByRole("region", { name: "Not reached" });
    expect(within(tray).getByRole("link", { name: "FILES" })).toBeInTheDocument();
    expect(within(tray).queryByRole("link", { name: "WEB01" })).not.toBeInTheDocument();
  });

  it("with no hops: Kali alone and how the first hop arrives", async () => {
    mount({ hops: [], tunnels: [] });
    const s = await section();
    expect(await within(s).findByText("Your first foothold records your first hop.")).toBeInTheDocument();
    expect(within(s).getByText("Kali")).toBeInTheDocument();
    expect(within(s).queryByRole("button", { name: "via creds" })).not.toBeInTheDocument();
  });

  it("an unrecorded way in is marked not recorded", async () => {
    mount({ hops: [hop("p2", "h1", "h2", "exploit", 2)], tunnels: [] });
    const s = await section();
    expect(await within(s).findByText("not recorded")).toBeInTheDocument();
  });

  it("when the tree does not fit, it reads as an indented list", async () => {
    width.value = 500;
    mount();
    const s = await section();
    const list = await within(s).findByRole("list", { name: "Attack path" });
    expect(list).toHaveAttribute("data-variant", "list");
    const web = within(list).getByRole("link", { name: "WEB01" });
    const row = web.closest<HTMLElement>("li")!;
    expect(row).toHaveTextContent(/via\s*creds/);
  });

  it("arriving with a host to focus marks its node", async () => {
    mount({ entry: { pathname: "/e/e1/s/network", state: { hostId: "h2" } } });
    const s = await section();
    const db = await within(s).findByRole("link", { name: "DB01" });
    await vi.waitFor(() => expect(nodeOf(db)).toHaveAttribute("data-focused"));
    expect(nodeOf(within(s).getByRole("link", { name: "WEB01" }))).not.toHaveAttribute("data-focused");
  });
});
