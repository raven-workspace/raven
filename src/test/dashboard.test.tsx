import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { dateRange, progressLine, relativeTime, timeLeft } from "../features/engagements/format";
import { api } from "../lib/api";
import type { Engagement } from "../types/engagement";
import { RavenError } from "../types/errors";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const HOUR = 3_600_000;
const MIN = 60_000;

function eng(over: Partial<Engagement> & Pick<Engagement, "id" | "name">): Engagement {
  return {
    kind: "lab",
    client: null,
    subLabel: null,
    scopeCidrs: [],
    domain: null,
    startsAt: null,
    endsAt: null,
    timeboxStart: null,
    timeboxMinutes: null,
    status: "active",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastActivityAt: null,
    lastRanOn: null,
    ...over,
  };
}

let list: Engagement[];

function fixtures(): Engagement[] {
  const now = Date.now();
  return [
    eng({
      id: "e1",
      name: "Mock exam A",
      kind: "exam-sim",
      subLabel: "AD + 3 standalone",
      timeboxStart: now - 2 * HOUR,
      timeboxMinutes: 1425,
      lastActivityAt: now - 12 * MIN,
      lastRanOn: null,
    }),
    eng({ id: "e4", name: "Acme Corp internal", kind: "client", client: "Acme Corp", subLabel: "assumed breach" }),
    eng({ id: "e2", name: "Lumen", kind: "lab", status: "archived" }),
    eng({ id: "e3", name: "Internal", kind: "client", client: "Globex", status: "archived" }),
  ];
}

function mount(path = "/") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  list = fixtures();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.vaultLock.mockResolvedValue(null);
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
  m.backupsList.mockResolvedValue([]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([]);
  m.engagementsList.mockImplementation(async () => list);
  m.engagementGet.mockImplementation(async (id) => {
    const e = list.find((x) => x.id === id);
    if (!e) throw new RavenError("not_found", "not found");
    return e;
  });
});
afterEach(() => vi.useRealTimers());

describe("format", () => {
  it("timeLeft formats", () => {
    const start = 1_700_000_000_000;
    const now = start + 9 * HOUR + 35 * MIN; // 23h45m timebox: 14h 10m left
    expect(timeLeft(start, 1425, now)).toBe("14h 10m left");
    expect(timeLeft(start, 1425, start + 1425 * MIN)).toBe("Time's up");
    expect(timeLeft(start, 1425, start + 2000 * MIN)).toBe("Time's up");
    expect(timeLeft(null, 1425, now)).toBe("Timebox not started");
    expect(timeLeft(start, 1425, start - MIN)).toBe("Timebox not started");
  });

  it("dateRange and relativeTime", () => {
    const y = new Date().getFullYear();
    expect(dateRange(new Date(y, 10, 10).getTime(), new Date(y, 10, 14).getTime())).toBe("Nov 10 – Nov 14");
    const now = Date.now();
    expect(relativeTime(now - 12 * MIN, now)).toBe("12m ago");
    expect(relativeTime(now - 3 * HOUR, now)).toBe("3h ago");
    expect(relativeTime(now - 50 * HOUR, now)).toBe("2d ago");
  });

  it("progressLine formats counts", () => {
    expect(progressLine({ hostsRooted: 0, hostsTotal: 0, flagsFound: 0, flagsTotal: 0 })).toBe("Rooted 0/0 · flags 0/0");
    expect(progressLine({ hostsRooted: 3, hostsTotal: 6, flagsFound: 7, flagsTotal: 9 })).toBe("Rooted 3/6 · flags 7/9");
  });
});

describe("dashboard", () => {
  it("lists active as cards and archived in past table", async () => {
    mount();
    const active = await screen.findByRole("region", { name: "Active" });
    expect(within(active).getByText("Mock exam A")).toBeInTheDocument();
    expect(within(active).getByText("Acme Corp internal")).toBeInTheDocument();
    expect(within(active).getByText("exam sim")).toBeInTheDocument();
    expect(within(active).getByText("AD + 3 standalone")).toBeInTheDocument();
    expect(within(active).getByText(/^21h 4[45]m left$/)).toBeInTheDocument();
    expect(within(active).getAllByText("Rooted 0/0 · flags 0/0")).toHaveLength(2);
    expect(within(active).getByText(/12m ago/)).toBeInTheDocument();
    expect(within(active).queryByText("Lumen")).not.toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Lumen")).toBeInTheDocument();
    expect(within(table).getByText("Internal")).toBeInTheDocument();
    expect(within(table).queryByText("Mock exam A")).not.toBeInTheDocument();
    for (const h of ["Engagement", "Kind", "Dates", "Result", "Report"]) {
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    expect(screen.getByTestId("app-root")).toBeInTheDocument();
  });

  it("clicking a card opens the engagement", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("link", { name: /Mock exam A/ }));
    expect(await within(await screen.findByRole("main")).findByText("No hosts yet")).toBeInTheDocument();
  });

  it("past search filters by name and client", async () => {
    const user = userEvent.setup();
    mount();
    const table = await screen.findByRole("table");
    const search = screen.getByRole("searchbox", { name: "Search past engagements" });
    await user.type(search, "GLOBEX");
    expect(within(table).getByText("Internal")).toBeInTheDocument();
    expect(within(table).queryByText("Lumen")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "reli");
    expect(within(table).getByText("Lumen")).toBeInTheDocument();
    expect(within(table).queryByText("Internal")).not.toBeInTheDocument();
  });

  it("shows the empty state with a New engagement button", async () => {
    const user = userEvent.setup();
    list = [];
    mount();
    expect(await screen.findByText("No engagements yet")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /New engagement/ });
    await user.click(buttons[buttons.length - 1]!);
    expect(await screen.findByRole("dialog", { name: "New engagement" })).toBeInTheDocument();
  });

  it("cmd+N opens new engagement dialog", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("table");
    await user.keyboard("{Meta>}n{/Meta}");
    expect(await screen.findByRole("dialog", { name: "New engagement" })).toBeInTheDocument();
  });

  it("cmd+N does nothing while typing in the past search", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("table");
    const search = screen.getByRole("searchbox", { name: "Search past engagements" });
    await user.click(search);
    await user.type(search, "rel");
    // fireEvent: user-event would also type the "n" into the field, which ⌘N never does on macOS.
    const ev = fireEvent.keyDown(search, { key: "n", metaKey: true });
    expect(ev).toBe(true); // not preventDefault-ed: the field keeps the key
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(search).toHaveFocus();
    expect(search).toHaveValue("rel");
  });

  it("cmd+N with a dialog already open changes nothing", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("table");
    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New engagement" });
    const name = within(dialog).getByLabelText("Name");
    await user.type(name, "Draft");
    expect(name).toHaveValue("Draft");
    fireEvent.keyDown(name, { key: "n", metaKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "New engagement" })).toBe(dialog);
    expect(name).toHaveValue("Draft");
    expect(name).toHaveFocus();
  });

  it("timebox_fields_only_for_exam_sim", async () => {
    const user = userEvent.setup();
    m.engagementCreate.mockImplementation(async (input) => eng({ id: "n1", ...input, kind: input.kind } as Engagement));
    mount();
    await screen.findByRole("table");
    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New engagement" });

    await user.click(within(dialog).getByRole("radio", { name: "Exam sim" }));
    expect(within(dialog).getByLabelText("Timebox start")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Hours")).toHaveValue(23);
    expect(within(dialog).getByLabelText("Minutes")).toHaveValue(45);
    expect(within(dialog).queryByLabelText("Client")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "Client" }));
    expect(within(dialog).getByLabelText("Client")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Timebox start")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "Lab" }));
    expect(within(dialog).queryByLabelText("Timebox start")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Hours")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Client")).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Name"), "Lumen 2");
    await user.type(within(dialog).getByLabelText("Scope"), " 10.10.0.0/24 \n\n  172.31.1.5\n");
    await user.click(within(dialog).getByRole("button", { name: "Create engagement" }));

    await vi.waitFor(() => expect(m.engagementCreate).toHaveBeenCalledTimes(1));
    const input = m.engagementCreate.mock.calls[0]![0];
    expect(input.name).toBe("Lumen 2");
    expect(input.kind).toBe("lab");
    expect(input.scopeCidrs).toEqual(["10.10.0.0/24", "172.31.1.5"]);
    expect(input.timeboxStart ?? null).toBeNull();
    expect(input.timeboxMinutes ?? null).toBeNull();
    expect(input.client ?? null).toBeNull();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("exam sim submits a 23h 45m timebox and the local start time", async () => {
    const user = userEvent.setup();
    m.engagementCreate.mockImplementation(async (input) => eng({ id: "n1", ...input } as Engagement));
    mount();
    await screen.findByRole("table");
    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New engagement" });
    await user.click(within(dialog).getByRole("radio", { name: "Exam sim" }));
    await user.type(within(dialog).getByLabelText("Name"), "Mock exam B");
    fireEvent.change(within(dialog).getByLabelText("Timebox start"), { target: { value: "2026-11-10T09:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Create engagement" }));
    await vi.waitFor(() => expect(m.engagementCreate).toHaveBeenCalledTimes(1));
    const input = m.engagementCreate.mock.calls[0]![0];
    expect(input.kind).toBe("exam-sim");
    expect(input.timeboxMinutes).toBe(1425);
    expect(input.timeboxStart).toBe(new Date(2026, 10, 10, 9, 30).getTime());
  });

  it("create shows field error from server", async () => {
    const user = userEvent.setup();
    m.engagementCreate.mockRejectedValue(new RavenError("validation", "invalid IPv4 CIDR: 10.0.0.300", "scopeCidrs"));
    mount();
    await screen.findByRole("table");
    await user.keyboard("{Meta>}n{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "New engagement" });
    await user.type(within(dialog).getByLabelText("Name"), "Bad scope");
    await user.type(within(dialog).getByLabelText("Scope"), "10.0.0.300");
    await user.click(within(dialog).getByRole("button", { name: "Create engagement" }));
    expect(await within(dialog).findByText(/invalid IPv4 CIDR: 10\.0\.0\.300/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Scope")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "New engagement" })).toBeInTheDocument();
  });

  it("autolock_with_open_dialog_discards_draft_cleanly", async () => {
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 1, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
    m.vaultUnlock.mockResolvedValue({ migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /New engagement/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: "New engagement" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Secret draft" } });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Secret draft");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(m.vaultLock).toHaveBeenCalled();
    const pw = screen.getByLabelText("Password");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Secret draft")).not.toBeInTheDocument();
    expect(m.engagementCreate).not.toHaveBeenCalled();

    fireEvent.change(pw, { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("app-root")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /New engagement/ })[0]!);
    expect(within(screen.getByRole("dialog", { name: "New engagement" })).getByLabelText("Name")).toHaveValue("");
    expect(m.engagementCreate).not.toHaveBeenCalled();
  });
});

describe("engagement shell", () => {
  it("shows sections, the hosts group and the board placeholder", async () => {
    mount("/e/e1");
    expect(await screen.findByRole("heading", { name: "Mock exam A" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Engagement" });
    for (const s of ["Board", "Log", "Credentials", "Findings", "Engagement checklist", "Report"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(s) })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: /Board/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByText("Hosts")).toBeInTheDocument();
    expect(await within(nav).findByText("No hosts yet")).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByText("No hosts yet")).toBeInTheDocument();
    const strip = screen.getByRole("status", { name: "Engagement status" });
    expect(within(strip).getByText(/left$/)).toBeInTheDocument();
  });

  it("number keys switch sections, but not while typing or in a dialog", async () => {
    const user = userEvent.setup();
    mount("/e/e1");
    const nav = await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("2");
    expect(within(nav).getByRole("link", { name: /Log/ })).toHaveAttribute("aria-current", "page");
    await user.keyboard("6");
    expect(within(nav).getByRole("link", { name: /Report/ })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit engagement" });
    await user.type(within(dialog).getByLabelText("Sub-label"), "3");
    // Radix hides the background from the a11y tree while the dialog is open.
    expect(within(nav).getByRole("link", { name: /Report/, hidden: true })).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Esc closed the dialog only; still in the shell.
    expect(screen.getByRole("navigation", { name: "Engagement" })).toBeInTheDocument();
    await user.keyboard("1");
    expect(within(nav).getByRole("link", { name: /Board/ })).toHaveAttribute("aria-current", "page");
  });

  it("Esc returns to the dashboard", async () => {
    const user = userEvent.setup();
    mount("/e/e1");
    await screen.findByRole("navigation", { name: "Engagement" });
    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("app-root")).toBeInTheDocument();
  });

  it("archive and unarchive use engagementSetStatus", async () => {
    const user = userEvent.setup();
    m.engagementSetStatus.mockImplementation(async (id, status) => {
      list = list.map((e) => (e.id === id ? { ...e, status } : e));
      return list.find((e) => e.id === id)!;
    });
    mount("/e/e1");
    await user.click(await screen.findByRole("button", { name: "Archive" }));
    expect(m.engagementSetStatus).toHaveBeenCalledWith("e1", "archived");
    await user.click(await screen.findByRole("button", { name: "Unarchive" }));
    expect(m.engagementSetStatus).toHaveBeenLastCalledWith("e1", "active");
  });

  it("delete requires typing the name", async () => {
    const user = userEvent.setup();
    m.engagementDelete.mockImplementation(async (id) => {
      list = list.filter((e) => e.id !== id);
      return null;
    });
    mount("/e/e1");
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete engagement" });
    const confirm = within(dialog).getByRole("button", { name: "Delete engagement" });
    expect(confirm).toBeDisabled();
    const input = within(dialog).getByLabelText(/Type the engagement name/);
    await user.type(input, "OSCP");
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(m.engagementDelete).not.toHaveBeenCalled();
    await user.type(input, " A");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(m.engagementDelete).toHaveBeenCalledWith("e1");
    expect(await screen.findByTestId("app-root")).toBeInTheDocument();
  });

  it("edit prefills and saves with engagementUpdate", async () => {
    const user = userEvent.setup();
    m.engagementUpdate.mockImplementation(
      async (id, input) => ({ ...list.find((e) => e.id === id)!, ...input }) as Engagement,
    );
    mount("/e/e1");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit engagement" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Mock exam A");
    expect(within(dialog).getByRole("radio", { name: "Exam sim" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("Hours")).toHaveValue(23);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(m.engagementUpdate).toHaveBeenCalledTimes(1));
    const [id, input] = m.engagementUpdate.mock.calls[0]!;
    expect(id).toBe("e1");
    expect(input.timeboxMinutes).toBe(1425);
    expect(input.timeboxStart).toBe(list[0]!.timeboxStart);
  });
});

describe("navigation", () => {
  it("the Raven title bar link goes home", async () => {
    const user = userEvent.setup();
    mount("/settings");
    await user.click(await screen.findByRole("link", { name: "Raven" }));
    expect(await screen.findByTestId("app-root")).toBeInTheDocument();
  });

  it("Esc on settings returns home", async () => {
    const user = userEvent.setup();
    mount("/settings");
    await screen.findByRole("heading", { name: "Settings" });
    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("app-root")).toBeInTheDocument();
  });
});
