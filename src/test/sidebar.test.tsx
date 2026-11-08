import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../features/engagements/Sidebar";
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
});
