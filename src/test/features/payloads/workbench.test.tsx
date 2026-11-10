import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { buildPayload } from "../../../engines/payloads/build";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import { buildSql, SQL_STEPS } from "../../../engines/payloads/sql";
import { setImported } from "../../../engines/library/store";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { useNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";
import type { LogEntry } from "../../../types/log";
import type { Service } from "../../../types/service";

vi.mock("../../../lib/api");
vi.mock("../../../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../../../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn() }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const LHOST = "192.0.2.10";
const LPORT = "4444";
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: null, boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const IIS = host("h1", "zzweb01", "198.51.100.21");
const DB = host("h2", "zzdb02", "198.51.100.22");
const service = (id: string, hostId: string, port: number, nmapService: string, nmapVersion: string): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const IIS_SERVICE = service("s1", "h1", 80, "http", "Microsoft IIS httpd 10.0");
const PG_SERVICE = service("s2", "h2", 5432, "postgresql", "PostgreSQL DB 13.4");
const at = new Date(2026, 10, 7, 14, 2).getTime();
const WEBSHELL_LOG: LogEntry = {
  id: "l1", engagementId: "e1", kind: "command", title: "probe", titleEdited: false, ranOn: "Kali (VM)", hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "command", blocks: [{ command: "curl 'http://198.51.100.21/uploads/zz.aspx?cmd=whoami'", output: "zzweb01\\zzuser" }] },
  at, createdAt: at, updatedAt: at,
};

const def = (id: string) => REVERSE_SHELLS.find((d) => d.id === id)!;

function mount(entries: string[]) {
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: LHOST, listenerPort: LPORT, kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: "e1", hostId: "h1" });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: {}, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([IIS, DB]);
  m.servicesList.mockResolvedValue([IIS_SERVICE, PG_SERVICE]);
  m.servicesListEngagement.mockResolvedValue([IIS_SERVICE, PG_SERVICE]);
  m.logList.mockResolvedValue([WEBSHELL_LOG]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const workbench = () => screen.findByRole("main", { name: "Payloads" });
/** The hints the line shows (not the full `?` list), as "keys label". */
const shownHints = (surface: HTMLElement) =>
  [...within(surface).getByRole("group", { name: "Payloads shortcuts" }).querySelectorAll(":scope > [data-hint]")].map(
    (u) => `${[...u.querySelectorAll("kbd")].map((k) => k.textContent).join(" ")} ${u.lastElementChild?.textContent}`,
  );
const read = () => within(screen.getByRole("complementary", { name: "Raven's read" }));

describe("Payloads Workbench", () => {
  it("/payloads renders Raven's read with evidence and the best fit", async () => {
    mount(["/payloads"]);
    const w = within(await workbench());
    expect(await w.findByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    const r = read();
    expect(r.getByRole("button", { name: "Host zzweb01" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Windows" })).toHaveAttribute("aria-pressed", "true");
    expect(r.getByText("from nmap (Microsoft IIS httpd 10.0 on 80)")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Web shell ?cmd=" })).toHaveAttribute("aria-pressed", "true");
    // Filtered by OS: no Linux-only contexts on a Windows host.
    expect(r.queryByRole("button", { name: "Bash prompt" })).not.toBeInTheDocument();
    expect(r.getByText("from your 14:02 log entry")).toBeInTheDocument();
    expect(r.getByRole("textbox", { name: "LHOST" })).toHaveValue(LHOST);
    expect(r.getByRole("textbox", { name: "LPORT" })).toHaveValue(LPORT);
    expect(r.getByText("No exam limits.")).toBeInTheDocument();
    expect(r.getByRole("listbox", { name: "Generator" })).toBeInTheDocument();
    expect(w.getByText("1. Listener on Kali")).toBeInTheDocument();
    expect(w.getByText("2. Paste into Web shell ?cmd=")).toBeInTheDocument();
    expect(w.getByLabelText("Command: Payload").textContent).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    expect(w.getByText("What each part does")).toBeInTheDocument();
    expect(w.getByRole("button", { name: /^Don't fit here \(\d+\)$/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking 'Inside a SQL string' re-wraps the payload", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(read().getByRole("button", { name: "Inside a SQL string" }));
    expect(read().getByRole("button", { name: "Inside a SQL string" })).toHaveAttribute("aria-pressed", "true");
    // A served cradle: prepare the file on Kali, start the listener, then paste.
    expect(w.getByText("1. Prepare on Kali")).toBeInTheDocument();
    expect(w.getByText("2. Listener on Kali")).toBeInTheDocument();
    expect(w.getByText("3. Paste into Inside a SQL string")).toBeInTheDocument();
    // The fit re-ranks for the new context: the cradle, its quotes doubled for the SQL string.
    expect(w.getByRole("heading", { name: "Nishang cradle (served rev.ps1)" })).toBeInTheDocument();
    expect(w.getByLabelText("Command: Payload").textContent).toBe(buildPayload(def("nishang-cradle"), "sql-string", { LHOST, LPORT }).text);
    expect(w.getByLabelText("Command: Payload").textContent).toContain("''http://192.0.2.10/rev.ps1''");
    // The override sticks for the host: the drawer's chip shows it too.
    expect(usePayloadsStore.getState().overrides.h1?.context).toBe("sql-string");
  });

  it("a custom LPORT is a per-host override", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const lport = read().getByRole("textbox", { name: "LPORT" });
    await user.clear(lport);
    await user.type(lport, "8443");
    expect(w.getByLabelText("Command: Listener")).toHaveTextContent("penelope -O -p 8443");
    expect(usePayloadsStore.getState().overrides.h1?.port).toBe("8443");
  });

  it("Transfer from the Arsenal opens Payloads on Transfer", async () => {
    const user = userEvent.setup();
    mount(["/arsenal"]);
    await user.type(await screen.findByRole("textbox", { name: "Search the Arsenal" }), "transfer a file");
    await user.click(await screen.findByRole("option", { name: /^Transfer a file/ }));
    const w = within(await workbench());
    expect(await w.findByRole("region", { name: "Transfer a file" })).toBeInTheDocument();
    expect(read().getByRole("option", { name: /Transfer/ })).toHaveAttribute("aria-selected", "true");
  });

  it("Transfer from the Arsenal drawer opens the Payloads drawer on Transfer", async () => {
    const user = userEvent.setup();
    mount(["/e/e1/h/h1"]);
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    const a = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.type(a.getByRole("textbox", { name: "Search the Arsenal" }), "transfer a file");
    await user.keyboard("{Enter}");
    const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
    expect(d.getByRole("tab", { name: "Transfer" })).toHaveAttribute("aria-selected", "true");
    expect(await d.findByRole("region", { name: "Transfer a file" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("SQL panel picks postgres from port 5432 and lists the 10 steps in order", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const w = within(await workbench());
    const sql = within(await w.findByRole("region", { name: "SQL injection" }));
    expect(await sql.findByRole("button", { name: "PostgreSQL" })).toHaveAttribute("aria-pressed", "true");
    expect(sql.getByText("from nmap (postgresql on 5432)")).toBeInTheDocument();
    const steps = within(sql.getByRole("list", { name: "SQL steps" })).getAllByRole("listitem");
    expect(steps.map((s) => within(s).getByRole("heading").textContent)).toEqual(SQL_STEPS.map((s, i) => `${i + 1}. ${s.title}`));
    // A column count typed once carries into the later steps.
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    expect(within(steps[5]!).getByLabelText("Command: Version payload").textContent).toBe(buildSql("version", "postgres", "url-param", { columns: 3 }).text);
    // Exec payloads for postgres only.
    const exec = within(sql.getByRole("list", { name: "Run commands" }));
    expect(exec.getAllByRole("listitem").map((s) => within(s).getByRole("heading").textContent)).toEqual(["COPY FROM PROGRAM reverse shell"]);
    // A step that does not apply in a client session is a muted line, not a crash.
    await user.click(sql.getByRole("button", { name: "Client session" }));
    expect(within(steps[0]!).getByText(/does not apply in a client session/)).toHaveClass("text-muted");
  });

  it("the SQL generator in the drawer uses the same panel", async () => {
    usePayloadsStore.setState({ generator: "sql" });
    const user = userEvent.setup();
    mount(["/e/e1/h/h2"]);
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("p");
    const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
    const sql = within(await d.findByRole("region", { name: "SQL injection" }));
    expect(sql.getByRole("button", { name: "PostgreSQL" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sql.getByRole("list", { name: "SQL steps" })).getAllByRole("listitem")).toHaveLength(10);
  });

  it("P focuses the generator list; ⇥ on the payload moves the fit, ⇥ on a button moves focus", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Tab}");
    expect(w.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    await user.keyboard("p");
    expect(read().getByRole("listbox", { name: "Generator" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(read().getByRole("option", { name: /Transfer/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    const copy = w.getByRole("button", { name: "Copy payload" });
    copy.focus();
    await user.keyboard("{Tab}");
    expect(w.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    expect(copy).not.toHaveFocus();
  });

  it("an Arsenal drawer over the Workbench gets ⌥H and ⌥1-6; the Workbench host and generator stay", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("a");
    const a = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await user.keyboard("{Alt>}h{/Alt}");
    expect(a.getByRole("button", { name: /^(Host |No host)/ })).toHaveAttribute("aria-expanded", "true");
    expect(read().getByRole("button", { name: "Host zzweb01" })).not.toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await user.keyboard("{Alt>}3{/Alt}");
    expect(usePayloadsStore.getState().generator).toBe("shell");
    expect(read().getByRole("button", { name: "Host zzweb01" })).toBeInTheDocument();
  });

  it("SQL copy guard: an unfilled token jumps to its field, and a changed payload needs a fresh confirm", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = within(await within(await workbench()).findByRole("region", { name: "SQL injection" }));
    await navigator.clipboard.writeText("untouched");
    await user.click(sql.getByRole("button", { name: "Copy Version" }));
    expect(await navigator.clipboard.readText()).toBe("untouched");
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveFocus();
    expect(sql.getByText("{COLUMNS} not filled. Copy again to copy anyway")).toHaveClass("text-warn");
    // Another injection point is another payload: the old confirm does not carry over.
    await user.click(sql.getByRole("button", { name: "Form field" }));
    await user.click(sql.getByRole("button", { name: "Copy Version" }));
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.click(sql.getByRole("button", { name: "Copy Version" }));
    expect(await navigator.clipboard.readText()).toBe(buildSql("version", "postgres", "form-field", {}).text);
    // ↵ in a step's field copies that step.
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildSql("column-count", "postgres", "form-field", { columns: 3 }).text);
  });

  it("the hint line lists only the keys that work for the generator", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const main = screen.getByRole("main", { name: "Payloads" });
    expect(main).toHaveAttribute("data-hint-surface");
    expect(shownHints(main)).toEqual(["↵ copy payload", "⌘↵ copy and log", "⌥L copy listener", "⇥ next fit", "Esc back"]);
    // The rest are one "?" away.
    await user.click(within(main).getByRole("button", { name: "All shortcuts" }));
    expect(await screen.findByText("generators")).toBeInTheDocument();
    expect(screen.getByText("where you paste")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard("{Alt>}3{/Alt}");
    expect(shownHints(main)).toEqual(["↵ copy step", "⌥1–6 generator", "P generators", "Esc back"]);
    await user.keyboard("{Alt>}2{/Alt}");
    expect(shownHints(main)).toEqual(["⌘↵ copy and log", "⌥1–6 generator", "P generators", "Esc back"]);
  });

  it("⌥O and ⌥W jump to the OS and where-you-paste-it choices", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Alt>}o{/Alt}");
    expect(read().getByRole("button", { name: "Windows" })).toHaveFocus();
    await user.keyboard("{Alt>}w{/Alt}");
    expect(read().getByRole("button", { name: "Web shell ?cmd=" })).toHaveFocus();
  });

  it("clearing LHOST and LPORT falls back to Settings without refilling the fields", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.clear(read().getByRole("textbox", { name: "LHOST" }));
    await user.clear(read().getByRole("textbox", { name: "LPORT" }));
    expect(read().getByRole("textbox", { name: "LHOST" })).toHaveValue("");
    expect(read().getByRole("textbox", { name: "LPORT" })).toHaveValue("");
    expect(read().getByRole("textbox", { name: "LPORT" })).toHaveAttribute("placeholder", `Settings: ${LPORT}`);
    expect(w.getByLabelText("Command: Payload").textContent).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    expect(w.getByLabelText("Command: Listener")).toHaveTextContent(`penelope -O -p ${LPORT}`);
  });

  it("P then Esc leaves the Workbench in one press", async () => {
    const user = userEvent.setup();
    mount(["/e/e1/h/h1", "/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("p");
    expect(read().getByRole("listbox", { name: "Generator" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("tab", { name: "Next" })).toBeInTheDocument();
  });

  it("Esc with /payloads as the first history entry goes home, not out of the app", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    await workbench();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("main", { name: "Payloads" })).not.toBeInTheDocument());
  });

  it("P typed in a field types, and does not jump to the generator list", async () => {
    const user = userEvent.setup();
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const field = read().getByRole("textbox", { name: "LHOST" });
    await user.clear(field);
    await user.type(field, "pP");
    expect(field).toHaveValue("pP");
    expect(field).toHaveFocus();
    expect(read().getByRole("listbox", { name: "Generator" })).not.toHaveFocus();
  });

  it("paste-context choices carry their full label as a title; the host chip has a minimum width", async () => {
    mount(["/payloads"]);
    const w = within(await workbench());
    await w.findByRole("heading", { name: "PowerShell base64 (-e)" });
    for (const label of ["URL / form parameter", "Inside a SQL string", "Jenkins / Groovy console"]) {
      expect(read().getByRole("button", { name: label })).toHaveAttribute("title", label);
    }
    // The chip's column never shrinks below 10rem, so a short or missing name still reads as a control.
    const chip = read().getByRole("button", { name: "Host zzweb01" });
    expect(chip.closest("[data-host-chip-cell]")).toHaveClass("grid-cols-[minmax(10rem,max-content)]");
  });

  it("Esc leaves the Workbench", async () => {
    const user = userEvent.setup();
    mount(["/e/e1/h/h1", "/payloads"]);
    await workbench();
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("tab", { name: "Next" })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Payloads" })).not.toBeInTheDocument();
  });
});

describe("SQL panel folds finished steps", () => {
  const sqlIn = async () => within(await within(await workbench()).findByRole("region", { name: "SQL injection" }));
  const stepItems = (sql: ReturnType<typeof within>) => within(sql.getByRole("list", { name: "SQL steps" })).getAllByRole("listitem");
  /** The fold lines (folded steps): buttons that say they are collapsed. */
  const folded = (li: HTMLElement) => [...li.querySelectorAll(":scope > h3 > button[aria-expanded='false']")];

  it("a copied step folds to its number, title and 'copied'; focus moves to the next step", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.click(sql.getByRole("button", { name: "Copy Break the query" }));
    expect(await navigator.clipboard.readText()).toBe(buildSql("detect-error", "postgres", "url-param", {}).text);
    const fold = sql.getByRole("button", { name: "1. Break the query: copied" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(sql.queryByRole("button", { name: "Copy Break the query" })).not.toBeInTheDocument();
    expect(sql.getByRole("button", { name: "Copy Boolean test" })).toHaveFocus();
    // Another engine or injection point is other text, not yet copied: open again; back, it is folded again.
    await user.click(sql.getByRole("button", { name: "MySQL" }));
    expect(sql.queryByRole("button", { name: /^1\. Break the query/ })).not.toBeInTheDocument();
    expect(sql.getByRole("button", { name: "Copy Break the query" })).toBeInTheDocument();
    await user.click(sql.getByRole("button", { name: "PostgreSQL" }));
    expect(sql.getByRole("button", { name: "1. Break the query: copied" })).toHaveAttribute("aria-expanded", "false");
    await user.click(sql.getByRole("button", { name: "Form field" }));
    expect(sql.getByRole("button", { name: "Copy Break the query" })).toBeInTheDocument();
  });

  it("a step held open by typing folds by keyboard at once, by mouse only once the click is done", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    const target = sql.getByRole("button", { name: "Copy Find the shown columns" });
    // Pressed, not yet released: focus has left the field, but the step does not fold under the pointer.
    await user.pointer({ keys: "[MouseLeft>]", target });
    expect(target).toHaveFocus();
    expect(sql.getByRole("textbox", { name: "Columns" })).toBeInTheDocument();
    await user.pointer({ keys: "[/MouseLeft]", target });
    expect(await navigator.clipboard.readText()).toBe(buildSql("reflected-columns", "postgres", "url-param", { columns: 3 }).text);
    expect(await sql.findByRole("button", { name: "4. Count the columns: 3" })).toHaveAttribute("aria-expanded", "false");
    // By keyboard: ⇥ out of a held field folds it straight away.
    await user.click(sql.getByRole("button", { name: "4. Count the columns: 3" }));
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveFocus();
    await user.tab();
    expect(sql.getByRole("button", { name: "4. Count the columns: 3" })).toHaveAttribute("aria-expanded", "false");
  });

  it("a step held open on one host is not held on another", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    usePayloadsStore.setState({ overrides: { h1: { sqlValues: { columns: 5 } } } });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    expect(sql.getByRole("button", { name: "4. Count the columns" })).toHaveAttribute("aria-expanded", "true");
    await user.click(read().getByRole("button", { name: "Host zzdb02" }));
    await user.click(await screen.findByRole("option", { name: /zzweb01/ }));
    expect(await sql.findByRole("button", { name: "4. Count the columns: 5" })).toHaveAttribute("aria-expanded", "false");
  });

  it("a step held on host A is not held again after A → B → A", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    usePayloadsStore.setState({ overrides: { h1: { sqlValues: { columns: 5 } } } });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    expect(sql.getByRole("button", { name: "4. Count the columns" })).toHaveAttribute("aria-expanded", "true");
    // The host in scope moves while focus stays in the field (no leave to release the hold), then comes back.
    act(() => useLastEngagementStore.setState({ hostId: "h1" }));
    expect(await sql.findByRole("button", { name: "4. Count the columns: 5" })).toHaveAttribute("aria-expanded", "false");
    act(() => useLastEngagementStore.setState({ hostId: "h2" }));
    // Back on A, its old hold is gone: the filled step reads folded.
    expect(await sql.findByRole("button", { name: "4. Count the columns: 3" })).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["a cancelled press", (el: HTMLElement) => fireEvent.pointerCancel(el)],
    ["the window losing focus", () => fireEvent.blur(window)],
  ])("after %s, a pending fold runs and keyboard folds are immediate again", async (_, end) => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    const target = sql.getByRole("button", { name: "Copy Find the shown columns" });
    await user.pointer({ keys: "[MouseLeft>]", target });
    expect(sql.getByRole("textbox", { name: "Columns" })).toBeInTheDocument();
    end(target);
    const fold = await sql.findByRole("button", { name: "4. Count the columns: 3" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    // No click since: ↵ reopens the step at its field, and ⇥ out folds it at once.
    fold.focus();
    await user.keyboard("{Enter}");
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveFocus();
    await user.tab();
    expect(sql.getByRole("button", { name: "4. Count the columns: 3" })).toHaveAttribute("aria-expanded", "false");
  });

  it("a filled value folds its step showing the value; ↵ on the fold line reopens it; clearing it unfolds", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    // Typing holds the step open; ↵ copies it and folds it.
    await user.type(sql.getByRole("textbox", { name: "Columns" }), "3");
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveValue("3");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildSql("column-count", "postgres", "url-param", { columns: 3 }).text);
    const fold = sql.getByRole("button", { name: "4. Count the columns: 3" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(sql.queryByRole("textbox", { name: "Columns" })).not.toBeInTheDocument();
    expect(sql.getByRole("textbox", { name: "Shown column" })).toHaveFocus();
    // ↵ on the fold line reopens the step, at its field.
    fold.focus();
    await user.keyboard("{Enter}");
    expect(sql.getByRole("button", { name: "4. Count the columns" })).toHaveAttribute("aria-expanded", "true");
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveFocus();
    // Cleared, it is unfinished again: open, and moving on does not fold it.
    await user.clear(sql.getByRole("textbox", { name: "Columns" }));
    await user.tab();
    await user.tab();
    expect(within(stepItems(sql)[3]!).getByRole("heading").textContent).toBe("4. Count the columns");
    expect(sql.getByRole("textbox", { name: "Columns" })).toBeInTheDocument();
    expect(folded(stepItems(sql)[3]!)).toHaveLength(0);
  });

  it("a value cleared elsewhere unfolds its step", async () => {
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    usePayloadsStore.setState({ overrides: { h2: { sqlValues: { columns: 3, table: "users" } } } });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    expect(sql.getByRole("button", { name: "4. Count the columns: 3" })).toHaveAttribute("aria-expanded", "false");
    expect(sql.getByRole("button", { name: "8. Tables: users" })).toHaveAttribute("aria-expanded", "false");
    act(() => usePayloadsStore.getState().override("h2", { sqlValues: { table: "users" } }));
    expect(sql.queryByRole("button", { name: /^4\. Count the columns/ })).not.toBeInTheDocument();
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveValue("");
    expect(sql.getByRole("button", { name: "8. Tables: users" })).toBeInTheDocument();
  });

  it("run commands fold the same way when copied", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.click(sql.getByRole("button", { name: "Copy COPY FROM PROGRAM reverse shell" }));
    expect(sql.getByRole("button", { name: "COPY FROM PROGRAM reverse shell: copied" })).toHaveAttribute("aria-expanded", "false");
    await user.click(sql.getByRole("button", { name: "COPY FROM PROGRAM reverse shell: copied" }));
    expect(sql.getByRole("button", { name: "Copy COPY FROM PROGRAM reverse shell" })).toBeInTheDocument();
  });

  it("the base64 script's parts get their own list, apart from the text's", async () => {
    const user = userEvent.setup();
    useLastEngagementStore.setState({ engagementId: "e1", hostId: "h2" });
    mount(["/payloads?generator=sql"]);
    const sql = await sqlIn();
    await user.click(sql.getByRole("button", { name: "MSSQL" }));
    const item = within(within(sql.getByRole("list", { name: "Run commands" })).getAllByRole("listitem").find((li) => within(li).queryByRole("heading", { name: "xp_cmdshell reverse shell" }))!);
    await user.click(item.getByRole("button", { name: "What each part does" }));
    await user.click(item.getByRole("button", { name: "Inside the base64 script" }));
    const lists = item.getAllByRole("definition").map((d) => d.closest("dl")!);
    const [text, decoded] = [...new Set(lists)];
    expect(within(text!).getByText("xp_cmdshell")).toBeInTheDocument();
    expect(within(text!).queryByText("iex $data")).not.toBeInTheDocument();
    expect(within(decoded!).getByText("iex $data")).toBeInTheDocument();
  });

  it("in the drawer, finished steps are fold lines and the first open step follows them, focused", async () => {
    usePayloadsStore.setState({ generator: "sql" });
    const user = userEvent.setup();
    mount(["/e/e1/h/h2"]);
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("p");
    const d = within(await screen.findByRole("complementary", { name: "Payloads" }));
    const sql = within(await d.findByRole("region", { name: "SQL injection" }));
    for (const t of ["Break the query", "Boolean test", "Time test"]) await user.click(sql.getByRole("button", { name: `Copy ${t}` }));
    const items = stepItems(sql);
    const open = items.filter((li) => folded(li).length === 0);
    expect(items.length - open.length).toBe(3);
    expect(open).toHaveLength(7);
    // Nothing above the open step but fold lines.
    expect(items.indexOf(open[0]!)).toBe(3);
    expect(sql.getByRole("textbox", { name: "Columns" })).toHaveFocus();
  });
});
