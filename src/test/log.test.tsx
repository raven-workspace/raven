import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Mock exam A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null,
};

const host = (id: string, name: string): Host => ({
  id, engagementId: "e1", name, ip: null, os: null, boardColumn: "enumerate", boardManual: false,
  access: "none", createdAt: 1, updatedAt: 1,
});

const T = new Date(2026, 10, 4, 9, 5).getTime();

function entry(over: Partial<LogEntry> & Pick<LogEntry, "id" | "title">): LogEntry {
  return {
    engagementId: "e1", kind: "note", titleEdited: false, ranOn: null, hostIds: [], observations: null,
    returnedNothing: false, private: false, content: { kind: "note", text: "body" }, at: T,
    createdAt: T, updatedAt: T, ...over,
  };
}

let entries: LogEntry[];

function mount() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/log"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const log = () => within(screen.getByRole("region", { name: "Log" }));
const rows = () => log().getAllByRole("listitem");
const titles = () => rows().map((li) => within(li).getAllByRole("button")[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  entries = [
    entry({ id: "a", title: "older note", at: T }),
    entry({
      id: "b", title: "nmap scan", kind: "command", at: T + 60_000, hostIds: ["h1"], ranOn: "Kali (VM)",
      observations: "port 445 open",
      content: { kind: "command", blocks: [{ command: "nmap -sV 10.10.10.5", output: "445/tcp open smb" }] },
    }),
    entry({ id: "c", title: "secret thing", at: T + 120_000, private: true, returnedNothing: true }),
  ];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"] });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([host("h1", "dc01"), host("h2", "web02")]);
  m.logList.mockImplementation(async () => entries);
  m.logUpdate.mockImplementation(async (id, input) => {
    entries = entries.map((e) => (e.id === id ? { ...e, ...input, titleEdited: input.titleEdited ?? e.titleEdited } as LogEntry : e));
    return entries.find((e) => e.id === id)!;
  });
  m.logDelete.mockResolvedValue(null);
});

describe("log", () => {
  it("log lists newest first with filters", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("nmap scan");
    expect(titles()[0]).toMatch(/secret thing/);
    expect(titles()[1]).toMatch(/nmap scan/);
    expect(titles()[2]).toMatch(/older note/);
    expect(screen.getByText("09:06")).toHaveAttribute("title", expect.stringContaining("2026"));
    await user.selectOptions(screen.getByLabelText("Kind"), "command");
    expect(rows()).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Kind"), "all");
    await user.selectOptions(screen.getByLabelText("Host"), "none");
    expect(rows()).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("Host"), "h1");
    expect(rows()).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Host"), "all");
    await user.selectOptions(screen.getByLabelText("Ran on"), "Kali (VM)");
    expect(rows()).toHaveLength(1);
  });

  it("expanding a command entry shows blocks and observations", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /nmap scan/ }));
    expect(screen.getByText("$ nmap -sV 10.10.10.5")).toHaveClass("font-mono");
    expect(screen.getByText("445/tcp open smb").tagName).toBe("PRE");
    expect(screen.getByText("Observations")).toBeInTheDocument();
    expect(screen.getByText("port 445 open")).toBeInTheDocument();
  });

  it("edited title survives host change", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /nmap scan/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "my title");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.logUpdate).toHaveBeenCalledTimes(1));
    expect(m.logUpdate.mock.calls[0]![1]).toMatchObject({ title: "my title", titleEdited: true, hostIds: ["h1"] });
    expect(m.logUpdate.mock.calls[0]![1].content).toEqual(entries[1]!.content);

    // The mock store now holds the edited entry; a hosts-only edit must keep it.
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByRole("button", { name: /my title/ });
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove dc01" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.logUpdate).toHaveBeenCalledTimes(2));
    expect(m.logUpdate.mock.calls[1]![1]).toMatchObject({ title: "my title", titleEdited: true, hostIds: [] });
  });

  it("private entry shows marker", async () => {
    mount();
    await screen.findByText("secret thing");
    const row = screen.getByRole("button", { name: /secret thing/ });
    expect(within(row).getByText("private")).toBeInTheDocument();
    expect(within(row).getByText("returned nothing")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /older note/ })).queryByText("private")).toBeNull();
  });

  it("delete asks first", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /older note/ }));
    await user.click(log().getByRole("button", { name: "Delete" }));
    expect(m.logDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this entry? Its screenshot goes with it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    await vi.waitFor(() => expect(m.logDelete).toHaveBeenCalledWith("a"));
  });
});
