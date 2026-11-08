import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setImported, type CardMeta } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { browseList } from "../features/arsenal/browseList";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../features/arsenal/useFillScope";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const cmd = (id: string, over: Partial<LibraryCommand>): LibraryCommand => ({
  id, title: id, tool: "zz", template: "zz", os: "any", runFrom: "attacker", goals: [], source: "raven", ...over,
});
const KERB_CARD: CardMeta = { id: "kerb-card", title: "Aardvark roasting", stage: "initial-foothold", category: "Active-Directory", os: "windows", file: "02-Cards/AD/Aardvark.md" };
const KERBRUTE_RAVEN = cmd("kerbrute-userenum", { title: "Aakerbrute user enum", tool: "aakerbrute", template: "kerbrute userenum {TARGET_IP}", category: "Active-Directory", why: "Find valid users." });
const NXC_RAVEN = cmd("nxc-smb", { title: "NXC SMB sweep", tool: "aanxc", template: "nxc smb {TARGET_IP}", category: "Active-Directory" });
const FM_CMD_IN_CARD = cmd("kerb-fm", { title: "GetUserSPNs", tool: "impacket", template: "GetUserSPNs {TARGET_IP}", source: "field-manual", cardId: "kerb-card" });
const SOCKS = cmd("socks-chisel", { title: "Zzchisel socks proxy", tool: "zzchisel", template: "chisel client {LHOST}", category: "Pivoting", why: "Reach the inner net." });
const CARD_B: CardMeta = { id: "web-card", title: "Zz Web card", stage: "initial-foothold", category: "Web", os: "any", file: "02-Cards/Web/Zz.md" };

describe("browseList", () => {
  it("cards first, then card-less commands under tool headings", () => {
    const NXC_2 = cmd("nxc-2", { title: "Second nxc", tool: "aanxc", category: "Active-Directory" });
    const KERB_2 = cmd("kerbrute-2", { title: "Kerbrute password spray", tool: "aakerbrute", category: "Active-Directory" });
    const s = browseList("Active-Directory", [KERBRUTE_RAVEN, KERB_2, NXC_RAVEN, NXC_2, FM_CMD_IN_CARD], [KERB_CARD], []);
    expect(s[0]).toEqual({ heading: null, rows: [expect.objectContaining({ type: "card", id: KERB_CARD.id })] });
    expect(s.slice(1).map((x) => x.heading)).toEqual(["aakerbrute", "aanxc"]);
    expect(s.flatMap((x) => x.rows).some((r) => r.id === FM_CMD_IN_CARD.id)).toBe(false);
  });

  it("puts a category's generators with its cards and skips other categories", () => {
    const s = browseList("Shells-and-Transfers", [KERBRUTE_RAVEN], [KERB_CARD], [{ id: "transfer", title: "Transfer a file", category: "Shells-and-Transfers" }]);
    expect(s).toEqual([{ heading: null, rows: [expect.objectContaining({ type: "generator", id: "transfer" })] }]);
  });
});

const nav: { current: string } = { current: "/arsenal" };
function mount(pending?: (release: (e: Engagement) => void) => void) {
  if (pending) m.engagementGet.mockImplementation(() => new Promise<Engagement>((r) => pending(r)));
  else m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[nav.current]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const categories = () => within(screen.getByRole("navigation", { name: "Categories" }));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null, lastRead: null });
  setImported({ commands: [KERBRUTE_RAVEN, NXC_RAVEN, FM_CMD_IN_CARD, SOCKS], cards: [KERB_CARD, CARD_B] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  nav.current = "/arsenal";
});
afterEach(() => setImported({ commands: [], cards: [] }));

describe("browseList tools", () => {
  it("single-command tools share one closing 'Other tools' heading with their tool tag", () => {
    const solo = cmd("solo-dig", { title: "DC SRV records", tool: "dig", category: "Active-Directory" });
    const s = browseList("Active-Directory", [KERBRUTE_RAVEN, solo, NXC_RAVEN, cmd("nxc-2", { title: "Second nxc", tool: "aanxc", category: "Active-Directory" })], [], []);
    expect(s.map((x) => x.heading)).toEqual(["aanxc", "Other tools"]);
    expect(s[1]!.rows.map((r) => r.id)).toEqual(["kerbrute-userenum", "solo-dig"]);
  });
});

describe("three-pane browse", () => {
  it("opens on the first category's first item, never 'Pick a card.'", async () => {
    mount();
    // Active-Directory is first by label; its first row is the first card (A..).
    expect(await screen.findByRole("heading", { name: "Aardvark roasting" })).toBeInTheDocument();
    expect(screen.queryByText("Pick a card.")).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Aardvark roasting/ })).toHaveAttribute("aria-selected", "true");
  });

  it("hovering another row changes neither the selection nor the reading pane", async () => {
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    const list = within(screen.getByRole("listbox", { name: "Arsenal results" }));
    const first = await list.findByRole("option", { name: /Aardvark roasting/ });
    const other = list.getByRole("option", { name: /Aakerbrute user enum/ });
    fireEvent.mouseMove(other);
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(other).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("heading", { name: "Aardvark roasting" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Aakerbrute user enum" })).not.toBeInTheDocument();
  });

  it("opens where you stopped", async () => {
    useArsenalStore.setState({ lastRead: { kind: "command", id: "socks-chisel" } });
    mount();
    expect(await screen.findByRole("heading", { name: "Zzchisel socks proxy" })).toBeInTheDocument();
    expect(screen.getByText("Reach the inner net.")).toBeInTheDocument();
  });

  it("lists categories with counts and has no Stage filter", async () => {
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    expect(screen.queryByRole("region", { name: "Stage" })).toBeNull();
    // Cards plus card-less commands (plus generators) in the category: the number of rows pane 2 lists.
    const ad = categories().getByRole("tab", { name: /Active Directory/ });
    const rows = within(screen.getByRole("listbox", { name: "Arsenal results" })).getAllByRole("option");
    expect(ad).toHaveTextContent(String(rows.length));
    expect(categories().getByRole("tab", { name: /Pivoting/ })).toHaveAttribute("tabindex", "-1");
  });

  it("shows nothing, not even categories, until the engagement kind is known", async () => {
    let release!: (e: Engagement) => void;
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
    mount((r) => (release = r));
    await screen.findByRole("button", { name: /^Fill for host/ });
    expect(categories().queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await act(async () => release({ ...E1, kind: "exam-sim" }));
    expect(await screen.findByRole("heading", { name: "Aardvark roasting" })).toBeInTheDocument();
  });

  it("shows tool headings as plain labels, and a command reads in pane 3", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    const list = within(screen.getByRole("listbox", { name: "Arsenal results" }));
    expect(list.getByText("aakerbrute")).toBeInTheDocument();
    expect(list.getByText("aanxc")).toBeInTheDocument();
    await user.click(list.getByRole("option", { name: /Aakerbrute user enum/ }));
    expect(await screen.findByRole("heading", { name: "Aakerbrute user enum" })).toBeInTheDocument();
    expect(screen.getByText("Find valid users.")).toBeInTheDocument();
    expect(await screen.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "kerbrute userenum {TARGET_IP}")).toBeInTheDocument();
  });

  it("typing filters pane 2 to grouped results and marks categories with hits", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    await user.type(screen.getByRole("textbox", { name: "Search the Arsenal" }), "zzchisel");
    const list = within(screen.getByRole("listbox", { name: "Arsenal results" }));
    expect(await list.findByRole("option", { name: /Zzchisel socks proxy/ })).toBeInTheDocument();
    expect(list.queryByRole("option", { name: /Aakerbrute/ })).toBeNull();
    expect(list.getByRole("group", { name: "Pivoting" })).toBeInTheDocument();
    expect(categories().getByRole("tab", { name: /Pivoting/ })).toHaveTextContent("1");
    expect(categories().getByRole("tab", { name: /Active Directory/ })).toHaveAttribute("data-dim", "true");
  });

  it("searching 'lateral movement' shows Pivoting items", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    await user.type(screen.getByRole("textbox", { name: "Search the Arsenal" }), "lateral movement");
    expect(await screen.findByRole("option", { name: /Zzchisel socks proxy/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pivoting" })).toBeInTheDocument();
    expect(categories().getByRole("tab", { name: /Pivoting/ })).not.toHaveAttribute("data-dim");
    expect(categories().getByRole("tab", { name: /Client Side Attacks/ })).toHaveAttribute("data-dim", "true");
  });

  it("/ focuses the search with no engagement", async () => {
    m.engagementsList.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/arsenal"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("no active engagement");
    await user.keyboard("/");
    expect(screen.getByRole("textbox", { name: "Search the Arsenal" })).toHaveFocus();
  });

  it("browsing a command or generator leaves the drawer's open card alone", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    act(() => useArsenalStore.setState({ cardId: "web-card" }));
    await user.click(screen.getByRole("option", { name: /Aakerbrute user enum/ }));
    expect(await screen.findByRole("heading", { name: "Aakerbrute user enum" })).toBeInTheDocument();
    expect(useArsenalStore.getState().cardId).toBe("web-card");
  });

  it("Esc clears the search before it leaves", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    const box = screen.getByRole("textbox", { name: "Search the Arsenal" });
    await user.type(box, "zzchisel");
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(screen.getByRole("navigation", { name: "Categories" })).toBeInTheDocument();
  });

  it("/ and A focus the search", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    await user.keyboard("/");
    expect(screen.getByRole("textbox", { name: "Search the Arsenal" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await user.click(document.body);
    await user.keyboard("a");
    expect(screen.getByRole("textbox", { name: "Search the Arsenal" })).toHaveFocus();
    expect(useArsenalStore.getState().open).toBe(false);
  });

  it("←/→ move focus between panes, ↑/↓ move within one", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("heading", { name: "Aardvark roasting" });
    const active = categories().getByRole("tab", { name: /Active Directory/ });
    active.focus();
    await user.keyboard("{ArrowDown}");
    expect(categories().getByRole("tab", { name: /Client Side Attacks/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(categories().getByRole("tab", { name: /Active Directory/ })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const list = screen.getByRole("listbox", { name: "Arsenal results" });
    expect(list).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(list).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(list).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("region", { name: "Reading" }).contains(document.activeElement)).toBe(true);
    await user.keyboard("{ArrowLeft}");
    expect(list).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(categories().getByRole("tab", { name: /Active Directory/ })).toHaveFocus();
  });

  it("the transfer generator is a link to Payloads", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByRole("textbox", { name: "Search the Arsenal" }), "transfer a file");
    await user.keyboard("{ArrowDown}");
    // Selected, pane 3 points to Payloads; the generator itself is no longer rendered here.
    const link = await screen.findByRole("link", { name: /Open in Payloads/ });
    expect(link).toHaveAttribute("href", "/payloads?generator=transfer");
    expect(screen.queryByRole("region", { name: "Transfer a file" })).not.toBeInTheDocument();
  });
});
