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
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};

const host = (id: string, name: string): Host => ({
  id, engagementId: "e1", name, ip: null, os: null, boardColumn: "information-gathering", boardManual: false, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
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
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(log().getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}
const titles = () => rows().map((li) => within(li).getAllByRole("button")[0]!.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
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
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "" });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([host("h1", "dc01"), host("h2", "web07")]);
  m.logList.mockImplementation(async () => entries);
  m.logUpdate.mockImplementation(async (id, input) => {
    entries = entries.map((e) => (e.id === id ? { ...e, ...input, titleEdited: input.titleEdited ?? e.titleEdited } as LogEntry : e));
    return entries.find((e) => e.id === id)!;
  });
  m.logDelete.mockResolvedValue(null);
});

describe("log", () => {
  it("a command whose target IP is no known host shows that IP on its row; a known host's IP does not", async () => {
    m.hostsList.mockResolvedValue([{ ...host("h1", "dc01"), ip: "192.0.2.10" }]);
    entries = [
      entry({ id: "u", title: "Full TCP scan", kind: "command", content: { kind: "command", blocks: [{ command: "nmap -p- 192.0.2.77", output: "" }] } }),
      entry({ id: "k", title: "Service scan", kind: "command", at: T + 1, content: { kind: "command", blocks: [{ command: "nmap -sV 192.0.2.10", output: "" }] } }),
    ];
    mount();
    await screen.findByText("Full TCP scan");
    const [known, unknown] = rows();
    expect(within(unknown!).getByText("192.0.2.77")).toBeInTheDocument();
    expect(within(known!).queryByText("192.0.2.10")).toBeNull();
  });

  it("log lists newest first with filters", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("nmap scan");
    expect(titles()[0]).toMatch(/secret thing/);
    expect(titles()[1]).toMatch(/nmap scan/);
    expect(titles()[2]).toMatch(/older note/);
    expect(screen.getByText("09:06")).toHaveAttribute("title", expect.stringContaining("2026"));
    await pick(user, "Kind", "Command");
    expect(rows()).toHaveLength(1);
    await pick(user, "Kind", "All");
    await pick(user, "Host", "No host");
    expect(rows()).toHaveLength(2);
    await pick(user, "Host", "dc01");
    expect(rows()).toHaveLength(1);
    await pick(user, "Host", "All");
    await pick(user, "Ran on", "Kali (VM)");
    expect(rows()).toHaveLength(1);
  });

  it("order button toggles between sort ascending and descending icons", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("nmap scan");
    const btn = screen.getByRole("button", { name: "Newest first" });
    const newestIcon = btn.innerHTML;
    expect(newestIcon).toContain("<svg");
    await user.click(btn);
    const flipped = screen.getByRole("button", { name: "Oldest first" });
    expect(flipped.innerHTML).toContain("<svg");
    expect(flipped.innerHTML).not.toBe(newestIcon);
    await user.click(flipped);
    expect(screen.getByRole("button", { name: "Newest first" })).toBeInTheDocument();
  });

  it("stored titles are shown unchanged", async () => {
    entries = [entry({ id: "z", title: "nmap → host · scan — all" })];
    mount();
    expect(await screen.findByText("nmap → host · scan — all")).toBeInTheDocument();
  });

  it("order flips to oldest first and is remembered", async () => {
    const user = userEvent.setup();
    const first = mount();
    await screen.findByText("nmap scan");
    await user.click(screen.getByRole("button", { name: "Newest first" }));
    expect(titles()[0]).toMatch(/older note/);
    expect(titles()[2]).toMatch(/secret thing/);
    first.unmount();
    mount();
    await screen.findByText("nmap scan");
    expect(titles()[0]).toMatch(/older note/);
    await user.click(screen.getByRole("button", { name: "Oldest first" }));
    expect(titles()[0]).toMatch(/secret thing/);
  });

  it("an expanded flag shows the pasted proof block", async () => {
    const user = userEvent.setup();
    entries = [
      entry({
        id: "f", title: "local.txt · dc01", kind: "flag", hostIds: ["h1"],
        content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef", proof: "whoami; hostname\ndc01\ncat local.txt\n0123456789abcdef0123456789abcdef" },
      }),
    ];
    mount();
    await user.click(await screen.findByText("local.txt · dc01"));
    expect(screen.getByText(/whoami; hostname/)).toBeInTheDocument();
  });

  it("a note-kind entry is labelled Other in rows and the Kind filter", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText("older note");
    const row = rows().find((li) => li.textContent?.includes("older note"))!;
    expect(within(row).getByText("Other")).toBeInTheDocument();
    await pick(user, "Kind", "Other");
    expect(rows().every((li) => !li.textContent?.includes("nmap scan"))).toBe(true);
  });

  it("groups rows under a heading per day, newest day first", async () => {
    const now = Date.now();
    entries = [
      entry({ id: "t", title: "today's entry", at: now }),
      entry({ id: "y", title: "yesterday's entry", at: now - 86_400_000 }),
    ];
    mount();
    await screen.findByText("today's entry");
    const today = log().getByRole("region", { name: "Today" });
    expect(within(today).getByText("today's entry")).toBeInTheDocument();
    const yesterday = log().getByRole("region", { name: "Yesterday" });
    expect(within(yesterday).getByText("yesterday's entry")).toBeInTheDocument();
    expect(today.compareDocumentPosition(yesterday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names hosts as text, keeps private as a chip", async () => {
    mount();
    const row = (await screen.findByText("nmap scan")).closest("li")!;
    expect(row.querySelector("[data-variant]")).toBeNull();
    const priv = within(screen.getByText("secret thing").closest("li")!).getByText("private");
    expect(priv).toHaveAttribute("data-variant", "default");
  });

  it("expanding a command entry shows blocks and observations", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /nmap scan/ }));
    // The command sits in the shared command box, with its own Copy.
    expect(screen.getByRole("group", { name: "Command: nmap scan" })).toHaveTextContent("nmap -sV 10.10.10.5");
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

  it("long output folds at 40 lines and expands", async () => {
    const user = userEvent.setup();
    const out = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n");
    entries = [entry({ id: "l", title: "big", kind: "command", content: { kind: "command", blocks: [{ command: "dump", output: out }] } })];
    mount();
    await user.click(await screen.findByRole("button", { name: /big/ }));
    expect(screen.queryByText(/line60/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show all 60 lines" }));
    expect(screen.getByText(/line60/)).toBeInTheDocument();
  });

  it("empty log shows the capture hint", async () => {
    entries = [];
    mount();
    expect(await screen.findByText("Nothing logged yet. Press L to capture.")).toBeInTheDocument();
  });

  it("delete failure is shown and the dialog stays open", async () => {
    const user = userEvent.setup();
    m.logDelete.mockRejectedValue(new Error("disk is read-only"));
    mount();
    await user.click(await screen.findByRole("button", { name: /older note/ }));
    await user.click(log().getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(await screen.findByText("disk is read-only")).toBeInTheDocument();
    expect(screen.getByText("Delete this entry? Its screenshot goes with it.")).toBeInTheDocument();
  });

  it("load failure shows the error and Retry refetches", async () => {
    const user = userEvent.setup();
    m.logList.mockRejectedValueOnce(new Error("db busy"));
    mount();
    expect(await screen.findByText("Couldn't load the log")).toBeInTheDocument();
    // The raw error sits in the collapsed Details disclosure.
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("db busy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("nmap scan")).toBeInTheDocument();
  });

  it("edit save failure shows a general error, not under the title", async () => {
    const user = userEvent.setup();
    m.logUpdate.mockRejectedValue(new Error("write failed"));
    mount();
    await user.click(await screen.findByRole("button", { name: /older note/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const err = await screen.findByText("write failed");
    expect(err).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText("Title")).not.toHaveAttribute("aria-invalid");
  });

  it("toggles flip private and returned-nothing in the update", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /older note/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Private" }));
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.logUpdate).toHaveBeenCalled());
    expect(m.logUpdate.mock.calls[0]![1]).toMatchObject({ private: true, returnedNothing: false });
  });

  it("returned nothing is offered only for command entries (M7)", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /older note/ }));
    await user.click(log().getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Returned nothing" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const nmap = screen.getByRole("button", { name: /nmap scan/ });
    await user.click(nmap);
    await user.click(within(nmap.closest("li")!).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Returned nothing" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.logUpdate).toHaveBeenCalled());
    expect(m.logUpdate.mock.calls[0]![1]).toMatchObject({ returnedNothing: true });
  });
});
