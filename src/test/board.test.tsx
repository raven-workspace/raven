import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
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
    boardColumn: "information-gathering",
    boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
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

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/e/e1"]}>
        <App />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ready() {
  await vi.waitFor(() =>
    expect(
      within(column("Vulnerability detection")).getByRole("link", { name: /dc01/ }),
    ).toBeInTheDocument(),
  );
}

function column(name: string) {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  vi.resetAllMocks();
  hosts = [
    host({
      id: "h1",
      name: "dc01",
      ip: "10.10.10.5",
      os: "windows",
      boardColumn: "vulnerability-detection",
      access: "user",
    }),
    host({
      id: "h2",
      name: "web02",
      ip: "10.10.10.6",
      os: "linux",
      boardColumn: "reporting",
    }),
    host({ id: "h3", name: "mystery", boardColumn: "information-gathering" }),
  ];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30,
    backupRetention: 14,
    machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockImplementation(async () => hosts);
  m.engagementsProgress.mockResolvedValue({});
  m.hostMove.mockImplementation(async (id, col) => {
    hosts = hosts.map((h) => (h.id === id ? { ...h, boardColumn: col } : h));
    return hosts.find((h) => h.id === id)!;
  });
});

describe("board", () => {
  it("cards sit in their column with ip and os chip", async () => {
    mount();
    await ready();
    const foot = column("Vulnerability detection");
    expect(within(foot).getByText("1")).toBeInTheDocument();
    const card = within(foot).getByRole("link", { name: /dc01/ });
    expect(within(card).getByText("10.10.10.5")).toHaveClass("font-mono");
    expect(within(card).getByText("Windows")).toBeInTheDocument();
    expect(within(card).getByText("user")).toHaveAttribute(
      "data-variant",
      "accent",
    );
    expect(
      within(column("Reporting")).getByRole("link", { name: /web02/ }),
    ).toBeInTheDocument();
    const mystery = within(column("Information gathering")).getByRole("link", {
      name: /mystery/,
    });
    expect(within(mystery).queryByText(/Windows|Linux|Other/)).toBeNull();
    expect(within(mystery).queryByText("user")).toBeNull();
    for (const l of ["Information gathering", "Vulnerability detection", "Initial foothold", "Privilege escalation", "Post-exploitation", "Reporting"])
      expect(column(l)).toBeInTheDocument();
  });

  it("drop on another column calls move", async () => {
    mount();
    await ready();
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => (store[k] = v),
      getData: (k: string) => store[k] ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    const card = within(column("Vulnerability detection")).getByRole("link", { name: /dc01/ });
    fireEvent.dragStart(card, { dataTransfer });
    const priv = column("Privilege escalation");
    fireEvent.dragOver(priv, { dataTransfer });
    expect(priv).toHaveAttribute("data-over", "true");
    fireEvent.drop(priv, { dataTransfer });
    await vi.waitFor(() =>
      expect(m.hostMove).toHaveBeenCalledWith("h1", "privilege-escalation"),
    );
    expect(priv).not.toHaveAttribute("data-over");
  });

  it("bracket keys move the focused card", async () => {
    const user = userEvent.setup();
    mount();
    await ready();
    const card = within(column("Vulnerability detection")).getByRole("link", { name: /dc01/ });
    card.focus();
    await user.keyboard("]");
    await vi.waitFor(() =>
      expect(m.hostMove).toHaveBeenLastCalledWith("h1", "initial-foothold"),
    );
    // moved card keeps focus (re-rendered in the new column)
    await vi.waitFor(() =>
      expect(
        within(column("Initial foothold")).getByRole("link", { name: /dc01/ }),
      ).toHaveFocus(),
    );
    await user.keyboard("[[");
    await vi.waitFor(() =>
      expect(m.hostMove).toHaveBeenLastCalledWith("h1", "vulnerability-detection"),
    );
    // edges do nothing
    const done = within(column("Reporting")).getByRole("link", { name: /web02/ });
    m.hostMove.mockClear();
    done.focus();
    await user.keyboard("]");
    expect(m.hostMove).not.toHaveBeenCalled();
  });

  it("a failed move shows the error and does not steal focus later (M9)", async () => {
    const user = userEvent.setup();
    m.hostMove.mockRejectedValueOnce(new Error("db busy"));
    mount();
    await ready();
    within(column("Vulnerability detection")).getByRole("link", { name: /dc01/ }).focus();
    await user.keyboard("]");
    expect(await screen.findByText("Couldn't move dc01: db busy")).toHaveAttribute("role", "alert");
    // Later, an unrelated change refetches hosts: focus stays where the user put it.
    const mystery = within(column("Information gathering")).getByRole("link", { name: /mystery/ });
    mystery.focus();
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => (store[k] = v),
      getData: (k: string) => store[k] ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(within(column("Reporting")).getByRole("link", { name: /web02/ }), { dataTransfer });
    fireEvent.drop(column("Post-exploitation"), { dataTransfer });
    await vi.waitFor(() => expect(within(column("Post-exploitation")).getByRole("link", { name: /web02/ })).toBeInTheDocument());
    expect(within(column("Information gathering")).getByRole("link", { name: /mystery/ })).toHaveFocus();
    // A move that works clears the message.
    expect(screen.queryByText(/Couldn't move/)).not.toBeInTheDocument();
  });

  it("the board lays out one grid track per column", async () => {
    mount();
    await ready();
    const grid = column("Reporting").parentElement!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
    expect(grid.querySelectorAll(":scope > section")).toHaveLength(6);
  });

  it("empty board offers add host", async () => {
    const user = userEvent.setup();
    hosts = [];
    mount();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByText("No hosts yet")).toBeInTheDocument();
    expect(
      main.getByText(
        "Hosts are added from single IPs in the scope, from capture, or by hand.",
      ),
    ).toBeInTheDocument();
    await user.click(main.getByRole("button", { name: "Add host" }));
    expect(
      await screen.findByRole("dialog", { name: "Add host" }),
    ).toBeInTheDocument();
  });
});
