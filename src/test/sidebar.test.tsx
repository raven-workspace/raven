import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEDGE } from "../features/hosts/HostGlyph";
import { Sidebar, railName } from "../features/engagements/Sidebar";
import { useSidebarStore } from "../features/engagements/useSidebarStore";
import { LogEntryRow } from "../features/log/LogEntryRow";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = (id: string, name: string, ip: string | null): Host => ({
  id, engagementId: "e1", name, ip, os: "linux", boardColumn: "information-gathering",
  boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const FULL = "web-portal-dmz-frontend-01.dmz.acme.corp";

function mount() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1"]}>
        <Sidebar engagementId="e1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useSidebarStore.setState({ collapsed: false });
  m.hostsList.mockResolvedValue([host("h1", FULL, "10.10.20.15"), host("h2", "dc01", null)]);
  m.notesList.mockResolvedValue([]);
});

describe("sidebar", () => {
  it("has an Engagement heading before the section links", async () => {
    mount();
    const h = screen.getByRole("heading", { name: "Engagement" });
    const board = screen.getByRole("link", { name: /Board/ });
    expect(h.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await screen.findByText("dc01");
  });

  it("shows short name and ip as separate nodes, full name in title", async () => {
    mount();
    const link = (await screen.findByText("web-portal-dmz-frontend-01")).closest("a")!;
    expect(link).toHaveAttribute("title", FULL);
    expect(within(link).getByText("10.10.20.15")).toHaveClass("font-mono");
  });

  it("a long host name truncates in the sidebar with its title", async () => {
    mount();
    const short = await screen.findByText("web-portal-dmz-frontend-01");
    expect(short).toHaveClass("truncate");
    expect(short.closest("a")).toHaveAttribute("title", FULL);
  });

  it("add host is an icon button named Add host", async () => {
    mount();
    await screen.findByText("dc01");
    const btn = screen.getByRole("button", { name: "Add host" });
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn).not.toHaveTextContent("+");
  });

  it("collapsed rail names each host", async () => {
    useSidebarStore.setState({ collapsed: true });
    m.hostsList.mockResolvedValue([host("h1", FULL, "10.10.20.15"), host("h2", "dc01", null), host("h3", "", "192.0.2.77")]);
    mount();
    const web = (await screen.findByText("web")).closest("a")!;
    // Name and IP live in a Raven tooltip (shown on keyboard focus), not a native title.
    for (const a of screen.getAllByRole("link")) expect(a).not.toHaveAttribute("title");
    expect(screen.getByRole("link", { name: /dc01/ })).toBeInTheDocument();
    expect(screen.getByText("77").closest("a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add host" })).toBeInTheDocument();
    web.focus();
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText(FULL)).toBeInTheDocument();
    expect(within(tip).getByText("10.10.20.15")).toHaveClass("font-mono");
  });

  it("the collapsed rail keeps the open-thread dot on a host with threads", async () => {
    useSidebarStore.setState({ collapsed: true });
    m.notesList.mockResolvedValue([
      { ownerId: "h2", engagementId: "e1", hostId: "h2", body: "? is 445 reachable\n? other", private: false, updatedAt: 1 },
    ]);
    mount();
    const link = (await screen.findByText("dc01", { selector: "span.sr-only" })).closest("a")!;
    expect(await within(link).findByRole("img", { name: "2 open threads" })).toBeInTheDocument();
    const other = screen.getByText("web").closest("a")!;
    expect(within(other).queryByRole("img", { name: /open thread/ })).toBeNull();
  });

  it("a rail host with no name shows its IP alone in the tooltip", async () => {
    useSidebarStore.setState({ collapsed: true });
    m.hostsList.mockResolvedValue([host("h3", "", "192.0.2.77")]);
    mount();
    const link = (await screen.findByText("77")).closest("a")!;
    expect(link).toHaveAccessibleName(/192\.0\.2\.77$/);
    link.focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/^192\.0\.2\.77$/);
  });

  it("section labels are not truncated, so Engagement checklist fits", async () => {
    mount();
    await screen.findByText("dc01");
    expect(screen.getByText("Engagement checklist")).not.toHaveClass("truncate");
  });

  it("rail has no section numbers and shows Board and 1 in its tooltip", async () => {
    const user = userEvent.setup();
    useSidebarStore.setState({ collapsed: true });
    mount();
    await screen.findByRole("link", { name: /dc01/ });
    const board = screen.getByRole("link", { name: "Board" });
    expect(board).not.toHaveTextContent("1");
    expect(board).not.toHaveAttribute("title");
    await user.tab();
    board.focus();
    const tip = (await screen.findAllByText("Board")).find((n) => n.closest("[role=tooltip]") || n.parentElement?.className.includes("z-50"));
    expect(tip).toBeTruthy();
    expect(await screen.findAllByText("1")).not.toHaveLength(0);
  });

  it("rail host short names fit and the current host is lit", async () => {
    useSidebarStore.setState({ collapsed: true });
    m.hostsList.mockResolvedValue([host("h1", "dc01", null), host("h2", "web-portal", null)]);
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
          <Sidebar engagementId="e1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const dc = await screen.findByText("dc01", { selector: "[aria-hidden]" });
    expect(dc).not.toHaveClass("truncate");
    const a = dc.closest("a")!;
    expect(a).toHaveClass("w-full");
    // Lit = shadcn's active state. The link draws nothing itself: one marker for the whole sidebar, --surface-hi
    // (sidebar-accent) plus the 2px accent bar (sidebar-primary), slides to the active link.
    expect(a).toHaveAttribute("data-active", "true");
    expect(a).toHaveClass("data-active:bg-transparent", "data-active:shadow-none");
    const marker = document.querySelector("nav [data-tab-marker]")!;
    expect(marker).toHaveClass("bg-sidebar-accent");
    expect(marker.className).toContain("shadow-[inset_2px_0_0_var(--sidebar-primary)]");
    expect(screen.getByText("web").closest("a")).toHaveAttribute("data-active", "false");
  });

  it("rail section links are 32px boxes centred on the host glyphs' centre line", async () => {
    useSidebarStore.setState({ collapsed: true });
    mount();
    const host = (await screen.findByText("dc01", { selector: "[aria-hidden]" })).closest("a")!;
    const board = screen.getByRole("link", { name: "Board" });
    // Section links: a fixed 32px box on the rail, the 16px icon centred by 8px padding.
    expect(board.className).toContain("group-data-[collapsible=icon]:size-8!");
    expect(board.className).toContain("group-data-[collapsible=icon]:p-2!");
    // Host rows: 48px wide, glyph centred in a single track.
    expect(host.className).toContain("group-data-[collapsible=icon]:w-12!");
    expect(host).toHaveClass("justify-items-center", "grid-cols-[minmax(0,1fr)]");
    // Both lists centre their items in the same rail column, so the centres share one line.
    const sections = board.closest("ul")!;
    const hosts = host.closest("ul")!;
    expect(sections).not.toBe(hosts);
    for (const ul of [sections, hosts]) expect(ul).toHaveClass("group-data-[collapsible=icon]:items-center");
    expect(sections.closest("[data-sidebar=group]")!.className).toBe(hosts.closest("[data-sidebar=group]")!.className);
  });

  it("the rail shows no section numbers", async () => {
    useSidebarStore.setState({ collapsed: true });
    mount();
    await screen.findByText("dc01", { selector: "[aria-hidden]" });
    const nav = screen.getByRole("navigation", { name: "Engagement" });
    for (const label of ["Board", "Log", "Credentials", "Findings", "Engagement checklist", "Report"]) {
      const link = within(nav).getByRole("link", { name: label });
      expect(link.textContent, label).not.toMatch(/\d/);
    }
  });

  it("expanded section labels are never the truncating last span", async () => {
    mount();
    await screen.findByText("dc01");
    for (const label of ["Board", "Engagement checklist"]) {
      const span = screen.getByText(label);
      expect(span).not.toHaveClass("truncate");
      // shadcn truncates a menu button's last span; the key number comes after the label.
      expect(span.nextElementSibling?.textContent).toMatch(/^\d$/);
    }
  });

  it("expanded Add host sits in the same 16px glyph track as the host rows", async () => {
    mount();
    const row = (await screen.findByText("dc01")).closest("a")!;
    const wrap = screen.getByRole("button", { name: "Add host" }).parentElement!.parentElement ?? screen.getByRole("button", { name: "Add host" }).parentElement!;
    const cols = (el: Element) => /grid-cols-\[(16px)[_\]]/.exec(el.className)?.[1];
    expect(cols(row)).toBe("16px");
    const w = screen.getByRole("button", { name: "Add host" }).closest("div.grid")!;
    expect(cols(w)).toBe("16px");
    expect(w).toHaveClass("px-2");
    expect(row).toHaveClass("px-2");
    expect(wrap).toBeTruthy();
  });

  it("host glyph wedges: pinned paths, rising sweep", () => {
    expect(WEDGE).toEqual([
      "",
      "M8 8V3A5 5 0 0 1 13 8Z",
      "M8 8V3A5 5 0 0 1 8 13Z",
      "M8 8V3A5 5 0 1 1 3 8Z",
      "M8 3A5 5 0 1 1 8 13A5 5 0 1 1 8 3Z",
    ]);
    // 1/4, 1/2 and 3/4 sweeps: large-arc flag is 0 up to a half, 1 beyond it.
    const large = WEDGE.slice(1, 4).map((d) => /A5 5 0 (\d) 1/.exec(d)![1]);
    expect(large).toEqual(["0", "0", "1"]);
  });

  it("toggles with the button and with Cmd+B", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("dc01");
    const btn = screen.getByRole("button", { name: /sidebar/i });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Meta>}b{/Meta}");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Meta>}b{/Meta}");
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem("raven.sidebar.collapsed")).toBe("0");
  });
});

describe("sidebar shortcut under a dialog", () => {
  it("Cmd+B does nothing while a dialog is open", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("dc01");
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.appendChild(dlg);
    try {
      await user.keyboard("{Meta>}b{/Meta}");
      expect(screen.getByRole("button", { name: /sidebar/i })).toHaveAttribute("aria-expanded", "true");
    } finally {
      dlg.remove();
    }
  });
});

describe("log row chip", () => {
  const e: LogEntry = {
    id: "x", engagementId: "e1", kind: "note", title: "t", titleEdited: false, ranOn: null, hostIds: ["h1"], observations: null,
    returnedNothing: false, private: false, content: { kind: "note", text: "b" }, at: 1, createdAt: 1, updatedAt: 1,
  };
  const hosts = [host("h1", FULL, null), host("h2", "dc01", null)];
  const renderRow = (row: React.ReactNode) =>
    render(<QueryClientProvider client={makeQueryClient()}><ul>{row}</ul></QueryClientProvider>);
  it("omits the chip for the current host", () => {
    renderRow(<LogEntryRow entry={e} hosts={hosts} currentHostId="h1" />);
    expect(screen.queryByText("web-portal-dmz-frontend-01")).not.toBeInTheDocument();
  });
  it("shows a short chip for other hosts", () => {
    renderRow(<LogEntryRow entry={e} hosts={hosts} />);
    expect(screen.getByText("web-portal-dmz-frontend-01")).toBeInTheDocument();
  });
  it("caps the host chips at two and folds the rest into +N", () => {
    const many = ["h1", "h2", "h3", "h4", "h5"].map((id, i) => host(id, `box${i}`, null));
    renderRow(<LogEntryRow entry={{ ...e, hostIds: many.map((h) => h.id) }} hosts={many} />);
    expect(screen.getByText("box0")).toBeInTheDocument();
    expect(screen.getByText("box1")).toBeInTheDocument();
    expect(screen.queryByText("box2")).not.toBeInTheDocument();
    expect(screen.getByText(/^\+3/)).toHaveAttribute("title", "box2, box3, box4");
    expect(screen.getByRole("button", { name: /also box2, box3, box4/ })).toBeInTheDocument();
  });
  it("pick mode's caret is an icon button whose tooltip shows on keyboard focus", async () => {
    const user = userEvent.setup();
    renderRow(<LogEntryRow entry={e} hosts={hosts} onPick={() => {}} />);
    const caret = screen.getByRole("button", { name: "Show t" });
    expect(caret).not.toHaveAttribute("title");
    expect(caret).toHaveClass("size-7");
    expect(caret.querySelector("svg")).toHaveAttribute("width", "16");
    caret.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Show the entry");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Hide t" })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("railName", () => {
  it("trims trailing separators and falls back to the last octet", () => {
    expect(railName("web-fin", null)).toBe("web");
    expect(railName("sql01", null)).toBe("sql0");
    expect(railName("a.b", "10.0.0.57")).toBe("a.b");
    expect(railName("w-", "10.0.0.57")).toBe("57");
    expect(railName("-", "10.0.0.57")).toBe("57");
    expect(railName("", "10.0.0.7")).toBe("7");
  });
});
