import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { buildPayload } from "../../../engines/payloads/build";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import { setImported } from "../../../engines/library/store";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { logCommand } from "../../../features/capture/logCommand";
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
import { useEffect } from "react";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router";

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
const BARE = host("h2", "zzbare02", "198.51.100.22");
const IIS_SERVICE: Service = {
  id: "s1", hostId: "h1", port: 80, protocol: "tcp", state: "open", nmapService: "http", nmapVersion: "Microsoft IIS httpd 10.0",
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
};
const at = new Date(2026, 10, 7, 14, 2).getTime();
const entry = (over: Partial<LogEntry>): LogEntry => ({
  id: "l1", engagementId: "e1", kind: "command", title: "probe", titleEdited: false, ranOn: "Kali (VM)", hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "command", blocks: [{ command: "curl 'http://198.51.100.21/uploads/zz.aspx?cmd=whoami'", output: "zzweb01\\zzuser" }] },
  at, createdAt: at, updatedAt: at, ...over,
});
const WEBSHELL_LOG = entry({});

const def = (id: string) => REVERSE_SHELLS.find((d) => d.id === id)!;

/** The router's navigate, so a test can move the route (and the host in scope) without moving focus. */
const nav: { to: NavigateFunction } = { to: () => undefined };
function GrabNavigate() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.to = navigate;
  }, [navigate]);
  return null;
}

function mount(path: string, settings: { attackerIp?: string; listenerPort?: string } = {}) {
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: settings.attackerIp ?? LHOST, listenerPort: settings.listenerPort ?? LPORT, kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <GrabNavigate />
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
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: {}, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([IIS, BARE]);
  m.servicesList.mockResolvedValue([IIS_SERVICE]);
  m.servicesListEngagement.mockResolvedValue([IIS_SERVICE]);
  m.logList.mockResolvedValue([WEBSHELL_LOG]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  vi.mocked(logCommand).mockResolvedValue(WEBSHELL_LOG);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const drawer = () => screen.findByRole("complementary", { name: "Payloads" });
/** The hints the line shows (not the full `?` list), as "keys label". */
const shownHints = (surface: HTMLElement) =>
  [...within(surface).getByRole("group", { name: "Payloads shortcuts" }).querySelectorAll(":scope > [data-hint]")].map(
    (u) => `${[...u.querySelectorAll("kbd")].map((k) => k.textContent).join(" ")} ${u.lastElementChild?.textContent}`,
  );
const payloadText = (d: ReturnType<typeof within>) => d.getByLabelText("Command: Payload").textContent;

async function openOn(path: string, settings?: { attackerIp?: string; listenerPort?: string }) {
  const user = userEvent.setup();
  mount(path, settings);
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await drawer());
  return { user, d };
}

describe("Payloads drawer", () => {
  it("P toggles the drawer and A closes it", async () => {
    const { user } = await openOn("/e/e1/h/h1");
    await user.keyboard("p");
    expect(screen.queryByRole("complementary", { name: "Payloads" })).not.toBeInTheDocument();
    await user.keyboard("p");
    await drawer();
    await user.keyboard("a");
    expect(screen.queryByRole("complementary", { name: "Payloads" })).not.toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: "Arsenal" })).toBeInTheDocument();
    // And the other way round: opening Payloads closes the Arsenal.
    act(() => usePayloadsStore.getState().toggle());
    expect(await drawer()).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Arsenal" })).not.toBeInTheDocument();
  });

  it("closing the drawer gives focus back to where it was before P", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    const next = await screen.findByRole("tab", { name: "Next" });
    next.focus();
    await user.keyboard("p");
    const d = within(await drawer());
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    expect(next).not.toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Payloads" })).not.toBeInTheDocument();
    expect(next).toHaveFocus();
  });

  it("opens on the best fit for an IIS host with a logged ?cmd= entry", async () => {
    const { d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "OS: Windows" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" })).toBeInTheDocument();
    expect(d.getByText(/OS from nmap \(Microsoft IIS httpd 10\.0 on 80\)/)).toBeInTheDocument();
    expect(d.getByText(/paste context from your 14:02 log entry/)).toBeInTheDocument();
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent(`penelope -O -p ${LPORT}`);
    expect(payloadText(d)).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    expect(within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option")).toHaveLength(6);
    // At most five hints, by priority: ↵ and Esc never drop, ⇥ next fit stays; the rest are under "?".
    const aside = screen.getByRole("complementary", { name: "Payloads" });
    expect(aside).toHaveAttribute("data-hint-surface");
    expect(shownHints(aside)).toEqual(["↵ copy payload", "⌘↵ copy and log", "⌥L copy listener", "⇥ next fit", "Esc close"]);
    expect(d.getByRole("button", { name: "All shortcuts" })).toBeInTheDocument();
  });

  it("↵ copies the payload, ⌥L copies the listener", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    await user.keyboard("{Alt>}l{/Alt}");
    expect(await navigator.clipboard.readText()).toBe(`penelope -O -p ${LPORT}`);
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
  });

  it("blank LHOST: ↵ focuses the LHOST field and copies nothing", async () => {
    const { user, d } = await openOn("/e/e1/h/h1", { attackerIp: "" });
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe("untouched");
    expect(d.getByRole("textbox", { name: "LHOST" })).toHaveFocus();
    expect(d.getByText("{LHOST} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    // Typing the IP there and pressing ↵ copies the filled payload.
    await user.keyboard(LHOST);
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
  });

  it("a cleared LHOST or LPORT (\"\") is unset: Settings fills it again and the port reads 'from Settings'", async () => {
    usePayloadsStore.setState({ lhost: "", overrides: { h1: { port: "" } } });
    const { d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    expect(payloadText(d)).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    expect(d.getByRole("button", { name: `Port: ${LPORT}` })).toBeInTheDocument();
    expect(d.getByText(/port from Settings/)).toBeInTheDocument();
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent(`penelope -O -p ${LPORT}`);
    // The field stays empty while you type a new value, with Settings' value as the hint.
    const field = d.getByRole("textbox", { name: "LHOST" });
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", `Settings: ${LHOST}`);
  });

  it("⇥ moves to the next fit and, past the last one, releases focus instead of wrapping", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const body = document.activeElement;
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("nc-exe"), "webshell-param", { LHOST, LPORT }).text);
    expect(body).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell TLS (-e)" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("ps-tls"), "webshell-param", { LHOST, LPORT }).text);
    expect(body).toHaveFocus();
    // Then the three Windows binds.
    await user.keyboard("{Tab}{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell TcpListener bind" })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell TcpListener bind (-e)" })).toBeInTheDocument();
    expect(body).toHaveFocus();
    // The last fit: ⇥ moves focus on and the fit stays.
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell TcpListener bind (-e)" })).toBeInTheDocument();
    expect(body).not.toHaveFocus();
  });

  it("⇥ from the body reaches the misfit disclosure and Full screen without leaving the drawer", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const aside = screen.getByRole("complementary", { name: "Payloads" });
    const show = d.getByRole("button", { name: "Don't fit here (27)" });
    const full = d.getByRole("button", { name: "Full screen" });
    const reached: Element[] = [];
    // Past the drawer's last control Tab comes round to its first: focus never runs on through the page behind.
    for (let i = 0; i < 60 && !reached.includes(full); i++) {
      await user.keyboard("{Tab}");
      reached.push(document.activeElement!);
      expect(aside.contains(document.activeElement)).toBe(true);
    }
    expect(reached).toContain(show);
    expect(reached).toContain(full);
    expect(reached.indexOf(show)).toBeLessThan(reached.indexOf(full));
    // And ⇧⇥ from the first control comes round to the last.
    d.getByRole("tab", { name: "Shell" }).focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(aside.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(d.getByRole("tab", { name: "Shell" }));
  }, 30_000);

  it("⇧⇥ always moves focus out of the body, never the fit", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const body = document.activeElement;
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(d.getByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    expect(body).not.toHaveFocus();
    // The pickers above the body are Tab stops: tools, filter (a web shell is an injection point), callbacks, port,
    // paste context, OS, host, then Full screen.
    expect(d.getByRole("button", { name: "Tools: not set" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(d.getByRole("button", { name: "Filter: off" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(d.getByRole("button", { name: "Callbacks: allowed" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(d.getByRole("button", { name: `Port: ${LPORT}` })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{Tab}{Tab}{Tab}{/Shift}");
    expect(d.getByRole("button", { name: "Full screen" })).toHaveFocus();
  });

  it("the OS, paste and port chips are Tab stops; ⌥O and ⌥W open the OS and paste pickers", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    for (const name of ["OS: Windows", "Paste into: Web shell ?cmd=", `Port: ${LPORT}`]) expect(d.getByRole("button", { name }).tabIndex).toBe(0);
    await user.keyboard("{Alt>}o{/Alt}");
    expect(d.getByRole("button", { name: "OS: Windows" })).toHaveAttribute("aria-expanded", "true");
    expect(d.getByRole("listbox", { name: "OS" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
    await user.keyboard("{Alt>}w{/Alt}");
    expect(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(d.getByRole("button", { name: /^Paste into: / })).not.toHaveAccessibleName("Paste into: Web shell ?cmd=");
  });

  it("⇥ on a button moves focus, not the fit", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const tab = d.getByRole("tab", { name: "Shell" });
    tab.focus();
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    expect(tab).not.toHaveFocus();
  });

  it("fits are a visible list near the top and clicking one selects it", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const list = d.getByRole("listbox", { name: "Fits" });
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.querySelector("[data-fit-name]")?.textContent)).toEqual([
      "PowerShell base64 (-e)", "nc.exe -e", "PowerShell TLS (-e)", "nc.exe -e bind", "PowerShell TcpListener bind",
      "PowerShell TcpListener bind (-e)",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    // Each row says why it fits, in its own spans; the best one says so.
    expect(within(options[0]!).getByText("Best fit")).toBeInTheDocument();
    expect(within(options[0]!).getByText("uses PowerShell")).toBeInTheDocument();
    expect(within(options[1]!).getByText("needs nc with -e")).toBeInTheDocument();
    // Near the top: before the listener and the payload.
    expect(list.compareDocumentPosition(d.getByLabelText("Command: Listener")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Hover only highlights; a click selects.
    await user.hover(options[1]!);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.click(options[1]!);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(d.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("nc-exe"), "webshell-param", { LHOST, LPORT }).text);
    // The list keeps focus: ↑ and ↓ move the selected fit, ↵ copies it.
    expect(list).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
  });

  it("⇥ still cycles fits", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Tab}");
    const options = within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("don't-fit line is a disclosure with a count", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const toggle = d.getByRole("button", { name: "Don't fit here (27)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(d.queryByRole("list", { name: "Don't fit here" })).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(d.getByRole("list", { name: "Don't fit here" })).getAllByRole("listitem")).toHaveLength(27);
  });

  it("context pickers are reachable with Tab", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    d.getByRole("button", { name: "Full screen" }).focus();
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await user.keyboard("{Tab}");
      seen.push(document.activeElement?.getAttribute("aria-label") ?? null);
    }
    expect(seen).toEqual(["Host zzweb01", "OS: Windows", "Paste into: Web shell ?cmd=", `Port: ${LPORT}`]);
    // ⌥H, ⌥O and ⌥W still open them.
    await user.keyboard("{Alt>}h{/Alt}");
    expect(d.getByRole("button", { name: "Host zzweb01" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await user.keyboard("{Alt>}o{/Alt}");
    expect(d.getByRole("button", { name: "OS: Windows" })).toHaveAttribute("aria-expanded", "true");
  });

  it("the misfit disclosure shows 'Don't fit here (N)' and expands with reasons", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    // The Linux shells, plus the Windows ones that do not work in a web shell parameter (cradles, uploaded files, code).
    expect(d.getByRole("button", { name: "Don't fit here (27)" })).toBeInTheDocument();
    expect(d.queryByText("Wrong OS (windows)")).not.toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "Don't fit here (27)" }));
    const fold = within(d.getByRole("list", { name: "Don't fit here" }));
    expect(fold.getAllByRole("listitem")).toHaveLength(27);
    expect(fold.getByText("Bash /dev/tcp")).toBeInTheDocument();
    expect(fold.getAllByText("Wrong OS (windows)")).toHaveLength(17);
    expect(fold.getAllByText("Doesn't work in Web shell ?cmd=")).toHaveLength(10);
  });

  it("overriding the paste context sticks for that host", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" }));
    await user.click(d.getByRole("option", { name: /^cmd\.exe/ }));
    expect(d.getByRole("button", { name: "Paste into: cmd.exe" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("ps-b64"), "cmd", { LHOST, LPORT }).text);
    // Another host does not get it.
    await user.click(d.getByRole("button", { name: /^(Host |No host)/ }));
    await user.click(d.getByRole("option", { name: /zzbare02/ }));
    expect(d.getByRole("button", { name: "Paste into: not set" })).toBeInTheDocument();
    // Back on the first host, after closing and reopening, the override is still there.
    await user.click(d.getByRole("button", { name: /^(Host |No host)/ }));
    await user.click(d.getByRole("option", { name: /zzweb01/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Payloads" })).not.toBeInTheDocument();
    await user.keyboard("p");
    const again = within(await drawer());
    expect(again.getByRole("button", { name: "Paste into: cmd.exe" })).toBeInTheDocument();
  });

  it("an OS-unknown host with no services shows the OS and paste chips empty and amber, and lists every payload", async () => {
    m.logList.mockResolvedValue([]);
    const { d } = await openOn("/e/e1/h/h2");
    const os = await d.findByRole("button", { name: "OS: not set" });
    const paste = d.getByRole("button", { name: "Paste into: not set" });
    for (const chip of [os, paste]) expect(chip.querySelector(".text-warn")).not.toBeNull();
    expect(d.getByRole("heading", { name: "Bash /dev/tcp" })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /^Don't fit here/ })).not.toBeInTheDocument();
    expect(within(d.getByRole("listbox", { name: "Fits" })).getByRole("option", { name: /^nc\.exe -e(?! bind)/ })).toBeInTheDocument();
  });

  it("⌘↵ copies and logs with the payload id and the LHOST/LPORT used", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    const text = buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text;
    expect(await navigator.clipboard.readText()).toBe(text);
    expect(logCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      engagementId: "e1", command: text, payloadId: "ps-b64", payloadValues: { LHOST, LPORT },
    }));
  });

  // Task 8 rewires this to build memory (staleBuild); skipped until then.
  it("a served cradle shows its Kali-side prepare step, filled, and no field for the derived ports", async () => {
    usePayloadsStore.setState({ overrides: { h1: { context: "sql-string", port: "80" } } });
    const { d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "Nishang cradle (served rev.ps1)" })).toBeInTheDocument();
    expect(d.getByLabelText("Command: Prepare on Kali").textContent).toBe(buildPayload(def("nishang-cradle"), "sql-string", { LHOST, LPORT: "80" }).prepare);
    expect(d.getByLabelText("Command: Prepare on Kali").textContent).toContain("python3 -m http.server 8000");
    expect(payloadText(d)).toContain("http://192.0.2.10:8000/rev.ps1");
    expect(d.queryByRole("textbox", { name: "SERVE_PORT" })).not.toBeInTheDocument();
    expect(d.queryByRole("textbox", { name: "WEB_PORT" })).not.toBeInTheDocument();
    expect(d.getByRole("button", { name: "Copy prepare on Kali" })).toBeInTheDocument();
  });

  it("msfvenom opens on the ASPX for an IIS host and on the WAR for a Tomcat host", async () => {
    const tomcat: Service = { ...IIS_SERVICE, id: "s2", hostId: "h2", port: 8080, nmapVersion: "Apache Tomcat/Coyote JSP engine 1.1" };
    m.servicesList.mockResolvedValue([IIS_SERVICE, tomcat]);
    m.servicesListEngagement.mockResolvedValue([IIS_SERVICE, tomcat]);
    usePayloadsStore.setState({ generator: "msfvenom", overrides: { h2: { os: "windows" } } });
    const { user, d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "Windows x64 ASPX" })).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: /^(Host |No host)/ }));
    await user.click(d.getByRole("option", { name: /zzbare02/ }));
    expect(await d.findByRole("heading", { name: "Java WAR (Tomcat)" })).toBeInTheDocument();
  });

  it("SQL tab, blank LHOST: an exec payload's Copy jumps to an LHOST field on the SQL tab", async () => {
    const mssql: Service = { ...IIS_SERVICE, id: "s3", hostId: "h2", port: 1433, nmapService: "ms-sql-s", nmapVersion: "Microsoft SQL Server 2019" };
    m.servicesList.mockResolvedValue([IIS_SERVICE, mssql]);
    m.servicesListEngagement.mockResolvedValue([IIS_SERVICE, mssql]);
    m.logList.mockResolvedValue([]);
    const { user, d } = await openOn("/e/e1/h/h2", { attackerIp: "" });
    await user.keyboard("{Alt>}3{/Alt}");
    const sql = within(await d.findByRole("region", { name: "SQL injection" }));
    expect(sql.getByRole("button", { name: "MSSQL" })).toHaveAttribute("aria-pressed", "true");
    await navigator.clipboard.writeText("untouched");
    await user.click(sql.getByRole("button", { name: "Copy xp_cmdshell reverse shell" }));
    expect(await navigator.clipboard.readText()).toBe("untouched");
    const field = sql.getByRole("textbox", { name: "LHOST" });
    expect(field).toHaveFocus();
    await user.type(field, LHOST);
    await user.click(sql.getByRole("button", { name: "Copy xp_cmdshell reverse shell" }));
    expect(await navigator.clipboard.readText()).toContain("xp_cmdshell");
    expect(usePayloadsStore.getState().lhost).toBe(LHOST);
  });

  it("⌥1-6 switches the generator", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Alt>}6{/Alt}");
    expect(d.getByRole("tab", { name: "Upgrade" })).toHaveAttribute("aria-selected", "true");
    expect(d.getByRole("heading", { name: "1. Spawn a PTY (python3)" })).toBeInTheDocument();
    await user.keyboard("{Alt>}5{/Alt}");
    expect(d.getByRole("textbox", { name: "PowerShell command" })).toBeInTheDocument();
  });
});

describe("Payloads drawer: chips and keys", () => {
  it("Port: 'Other…' opens a numeric field; ↵ sets the port for this host and gives focus back to the payload", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: `Port: ${LPORT}` }));
    await user.click(d.getByRole("option", { name: /^Other…/ }));
    const field = d.getByRole("textbox", { name: "Custom port" });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("inputmode", "numeric");
    // Digits only.
    await user.keyboard("90x01");
    expect(field).toHaveValue("9001");
    await user.keyboard("{Enter}");
    expect(d.queryByRole("textbox", { name: "Custom port" })).not.toBeInTheDocument();
    expect(d.getByRole("button", { name: "Port: 9001" })).toBeInTheDocument();
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("penelope -O -p 9001");
    expect(usePayloadsStore.getState().overrides.h1?.port).toBe("9001");
    // ↵ now copies the payload with that port.
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT: "9001" }).text);
  });

  it("Port: Esc in the 'Other…' field drops it, keeps the drawer open, and leaves the port as it was", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const chip = d.getByRole("button", { name: `Port: ${LPORT}` });
    chip.focus();
    await user.keyboard("{Enter}{End}{Enter}");
    const field = d.getByRole("textbox", { name: "Custom port" });
    expect(field).toHaveFocus();
    await user.keyboard("8080{Escape}");
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
    expect(d.queryByRole("textbox", { name: "Custom port" })).not.toBeInTheDocument();
    expect(d.getByRole("button", { name: `Port: ${LPORT}` })).toHaveFocus();
    expect(usePayloadsStore.getState().overrides.h1?.port).toBeUndefined();
  });

  it("Port: an out-of-range port and ↵ keep the field open, marked, and copy nothing", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: `Port: ${LPORT}` }));
    await user.click(d.getByRole("option", { name: /^Other…/ }));
    await navigator.clipboard.writeText("untouched");
    for (const typed of ["70000", "0", ""]) {
      const field = d.getByRole("textbox", { name: "Custom port" });
      await user.clear(field);
      if (typed) await user.type(field, typed);
      await user.keyboard("{Enter}");
      expect(field).toHaveFocus();
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription("1–65535");
      expect(d.getByText("1–65535")).toHaveClass("text-warn");
      expect(usePayloadsStore.getState().overrides.h1?.port).toBeUndefined();
    }
    expect(await navigator.clipboard.readText()).toBe("untouched");
    // Typing again clears the mark; Esc still drops the field.
    await user.type(d.getByRole("textbox", { name: "Custom port" }), "8");
    expect(d.getByRole("textbox", { name: "Custom port" })).not.toHaveAttribute("aria-invalid", "true");
    await user.keyboard("{Escape}");
    expect(d.queryByRole("textbox", { name: "Custom port" })).not.toBeInTheDocument();
    expect(usePayloadsStore.getState().overrides.h1?.port).toBeUndefined();
  });

  it("Port: a custom port is stored without leading zeros", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: `Port: ${LPORT}` }));
    await user.click(d.getByRole("option", { name: /^Other…/ }));
    await user.type(d.getByRole("textbox", { name: "Custom port" }), "00080{Enter}");
    expect(usePayloadsStore.getState().overrides.h1?.port).toBe("80");
    expect(d.getByRole("button", { name: "Port: 80" })).toBeInTheDocument();
  });

  it("Port: a field opened for one host closes when the host changes, and never sets the other host's port", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: `Port: ${LPORT}` }));
    await user.click(d.getByRole("option", { name: /^Other…/ }));
    await user.type(d.getByRole("textbox", { name: "Custom port" }), "9001");
    act(() => void nav.to("/e/e1/h/h2"));
    const after = within(await drawer());
    expect(await after.findByRole("button", { name: "Host zzbare02" })).toBeInTheDocument();
    expect(after.queryByRole("textbox", { name: "Custom port" })).not.toBeInTheDocument();
    expect(usePayloadsStore.getState().overrides.h2?.port).toBeUndefined();
  });

  it("picking an OS drops a paste override that does not exist there; one that does (Web shell ?cmd=) stays", async () => {
    usePayloadsStore.setState({ overrides: { h1: { context: "cmd" } } });
    const { user, d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("button", { name: "Paste into: cmd.exe" })).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "OS: Windows" }));
    await user.click(d.getByRole("option", { name: /^Linux/ }));
    // cmd.exe is Windows-only: the override goes, and the log's paste context reads again.
    expect(usePayloadsStore.getState().overrides.h1).toEqual({ os: "linux" });
    expect(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" })).toBeInTheDocument();
    // An any-OS override survives the OS pick.
    act(() => usePayloadsStore.getState().override("h1", { context: "url-param" }));
    await user.click(d.getByRole("button", { name: "OS: Linux" }));
    await user.click(d.getByRole("option", { name: /^Windows/ }));
    expect(usePayloadsStore.getState().overrides.h1).toEqual({ os: "windows", context: "url-param" });
  });

  it("after a mouse pick on a chip, ↵ copies the payload instead of reopening the chip", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" }));
    await user.click(d.getByRole("option", { name: /^cmd\.exe/ }));
    const chip = d.getByRole("button", { name: "Paste into: cmd.exe" });
    expect(chip).not.toHaveFocus();
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Enter}");
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(await navigator.clipboard.readText()).toBe(buildPayload(def("ps-b64"), "cmd", { LHOST, LPORT }).text);
  });

  it("↵ inside an open chip list picks and copies nothing; Esc closes only the list and ↵ then copies", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Alt>}w{/Alt}");
    await user.keyboard("{Home}{Enter}");
    expect(d.getByRole("button", { name: "Paste into: URL / form parameter" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Alt>}o{/Alt}");
    expect(d.getByRole("listbox", { name: "OS" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.queryByRole("listbox", { name: "OS" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await navigator.clipboard.readText()).not.toBe("untouched");
  });

  it("⌥L with no port set goes through the guard: held once, the Port chip opens", async () => {
    const { user, d } = await openOn("/e/e1/h/h1", { listenerPort: "" });
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("penelope -O -p {LPORT}");
    await navigator.clipboard.writeText("untouched");
    await user.keyboard("{Alt>}l{/Alt}");
    expect(await d.findByText("{LPORT} not filled. Press ⌥L again to copy anyway")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Port: not set" })).toHaveAttribute("aria-expanded", "true");
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });

  it("⌘↵ on Encode logs the command without LHOST or LPORT values", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Alt>}5{/Alt}");
    await user.type(d.getByRole("textbox", { name: "PowerShell command" }), "whoami");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await vi.waitFor(() => expect(logCommand).toHaveBeenCalled());
    const args = vi.mocked(logCommand).mock.calls[0]![1];
    expect(args).toMatchObject({ payloadId: "encode-ps" });
    expect(args.payloadValues).toBeUndefined();
  });

  it("P typed in a field types, and neither closes the drawer nor moves focus", async () => {
    const { user, d } = await openOn("/e/e1/h/h1", { attackerIp: "" });
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const field = d.getByRole("textbox", { name: "LHOST" });
    await user.click(field);
    await user.keyboard("pP");
    expect(field).toHaveValue("pP");
    expect(field).toHaveFocus();
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
  });

  it("⌥1–⌥3 switch the generator over a host view, never the host view's own tabs", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const next = screen.getByRole("tab", { name: "Next" });
    expect(next).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Alt>}2{/Alt}");
    expect(d.getByRole("tab", { name: "Transfer" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Alt>}3{/Alt}");
    expect(d.getByRole("tab", { name: "SQL injection" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Alt>}1{/Alt}");
    expect(d.getByRole("tab", { name: "Shell" })).toHaveAttribute("aria-selected", "true");
    expect(next).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Log" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Findings" })).toHaveAttribute("aria-selected", "false");
  });

  it("tool ticks in another key order are the same list: the fit in view stays", async () => {
    usePayloadsStore.setState({ overrides: { h1: { tools: { python3: "present", perl: "missing" } } } });
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    act(() => usePayloadsStore.getState().override("h1", { tools: { perl: "missing", python3: "present" } }));
    expect(d.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
  });
});
