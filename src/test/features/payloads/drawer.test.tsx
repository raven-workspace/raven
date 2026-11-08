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
import { MemoryRouter } from "react-router";

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

function mount(path: string, settings: { attackerIp?: string } = {}) {
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: settings.attackerIp ?? LHOST, listenerPort: LPORT, kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
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
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: {}, lhost: null });
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
  vi.mocked(logCommand).mockResolvedValue(WEBSHELL_LOG);
});
afterEach(() => setImported({ commands: [], cards: [] }));

const drawer = () => screen.findByRole("complementary", { name: "Payloads" });
const payloadText = (d: ReturnType<typeof within>) => d.getByLabelText("Payload").textContent;

async function openOn(path: string, settings?: { attackerIp?: string }) {
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
    expect(d.getByLabelText("Listener")).toHaveTextContent(`penelope -O -p ${LPORT}`);
    expect(payloadText(d)).toBe(buildPayload(def("ps-b64"), "webshell-param", { LHOST, LPORT }).text);
    expect(d.getByText(/Also fits:/)).toHaveTextContent("nc.exe -e");
    const hint = screen.getByRole("complementary", { name: "Payloads" }).querySelector("[data-hint-line]");
    expect(hint?.textContent).toBe("↵ copy payload · ⌥L copy listener · ⇥ next fit · ⌥O OS · ⌥W where you paste · ⌥1-6 generator · ⌘↵ copy and log · Esc close");
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
    expect(d.getByText("{LHOST} not filled · ↵ again to copy anyway")).toBeInTheDocument();
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
    expect(d.getByLabelText("Listener")).toHaveTextContent(`penelope -O -p ${LPORT}`);
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
    // The last fit: ⇥ moves focus on and the fit stays.
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "nc.exe -e" })).toBeInTheDocument();
    expect(body).not.toHaveFocus();
  });

  it("⇥ from the body eventually reaches the misfit 'show' button and Full screen", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const show = d.getByRole("button", { name: "show" });
    const full = d.getByRole("button", { name: "Full screen" });
    const reached = new Set<Element>();
    // Past the body's last control Tab runs on through the page behind (the drawer is not modal) and comes round.
    for (let i = 0; i < 300 && !(reached.has(show) && reached.has(full)); i++) {
      await user.keyboard("{Tab}");
      if (document.activeElement) reached.add(document.activeElement);
    }
    expect(reached.has(show)).toBe(true);
    expect(reached.has(full)).toBe(true);
  }, 30_000);

  it("⇧⇥ always moves focus out of the body, never the fit", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    const body = document.activeElement;
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(d.getByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    expect(body).not.toHaveFocus();
    // The chips above the body are Tab stops: port, paste context, OS, then Full screen.
    expect(d.getByRole("button", { name: `Port: ${LPORT}` })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{Tab}{Tab}{/Shift}");
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
    const tab = d.getByRole("tab", { name: "Reverse shell" });
    tab.focus();
    await user.keyboard("{Tab}");
    expect(d.getByRole("heading", { name: "PowerShell base64 (-e)" })).toBeInTheDocument();
    expect(tab).not.toHaveFocus();
  });

  it("misfit fold shows 'N don't fit here' and expands with reasons", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    // Five Linux shells plus powercat and Nishang, which do not work in a web shell parameter.
    expect(d.getByText(/7 don't fit here:/)).toBeInTheDocument();
    expect(d.queryByText("Wrong OS (windows)")).not.toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "show" }));
    const fold = within(d.getByRole("list", { name: "Don't fit here" }));
    expect(fold.getAllByRole("listitem")).toHaveLength(7);
    expect(fold.getByText("Bash /dev/tcp")).toBeInTheDocument();
    expect(fold.getAllByText("Wrong OS (windows)")).toHaveLength(5);
    expect(fold.getAllByText("Doesn't work in Web shell ?cmd=")).toHaveLength(2);
  });

  it("overriding the paste context sticks for that host", async () => {
    const { user, d } = await openOn("/e/e1/h/h1");
    await d.findByRole("heading", { name: "PowerShell base64 (-e)" });
    await user.click(d.getByRole("button", { name: "Paste into: Web shell ?cmd=" }));
    await user.click(d.getByRole("option", { name: /^cmd\.exe/ }));
    expect(d.getByRole("button", { name: "Paste into: cmd.exe" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("ps-b64"), "cmd", { LHOST, LPORT }).text);
    // Another host does not get it.
    await user.click(d.getByRole("button", { name: /^Fill for host/ }));
    await user.click(d.getByRole("option", { name: /zzbare02/ }));
    expect(d.getByRole("button", { name: "Paste into: not set" })).toBeInTheDocument();
    // Back on the first host, after closing and reopening, the override is still there.
    await user.click(d.getByRole("button", { name: /^Fill for host/ }));
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
    expect(d.queryByText(/don't fit here/)).not.toBeInTheDocument();
    expect(d.getByText(/Also fits:/)).toHaveTextContent("nc.exe -e");
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

  it("a baked payload built with an older LHOST shows the stale line above the copy block", async () => {
    const old = new Date(2026, 10, 7, 9, 5).getTime();
    m.logList.mockResolvedValue([
      WEBSHELL_LOG,
      entry({ id: "l2", payloadId: "nishang-cradle", payloadValues: { LHOST: "192.0.2.99", LPORT }, at: old, createdAt: old, updatedAt: old }),
    ]);
    usePayloadsStore.setState({ overrides: { h1: { context: "sql-string" } } });
    const { d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "Nishang cradle (served rev.ps1)" })).toBeInTheDocument();
    const line = d.getByText(`Built at 09:05 with 192.0.2.99:${LPORT}; rebuild it`);
    expect(line).toHaveClass("text-warn");
  });

  it("a served cradle shows its Kali-side prepare step, filled, and no field for the derived ports", async () => {
    usePayloadsStore.setState({ overrides: { h1: { context: "sql-string", port: "80" } } });
    const { d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "Nishang cradle (served rev.ps1)" })).toBeInTheDocument();
    expect(d.getByLabelText("Prepare on Kali").textContent).toBe(buildPayload(def("nishang-cradle"), "sql-string", { LHOST, LPORT: "80" }).prepare);
    expect(d.getByLabelText("Prepare on Kali").textContent).toContain("python3 -m http.server 8000");
    expect(payloadText(d)).toContain("http://192.0.2.10:8000/rev.ps1");
    expect(d.queryByRole("textbox", { name: "SERVE_PORT" })).not.toBeInTheDocument();
    expect(d.queryByRole("textbox", { name: "WEB_PORT" })).not.toBeInTheDocument();
    expect(d.getByRole("button", { name: "Copy prepare on kali" })).toBeInTheDocument();
  });

  it("msfvenom opens on the ASPX for an IIS host and on the WAR for a Tomcat host", async () => {
    const tomcat: Service = { ...IIS_SERVICE, id: "s2", hostId: "h2", port: 8080, nmapVersion: "Apache Tomcat/Coyote JSP engine 1.1" };
    m.servicesList.mockResolvedValue([IIS_SERVICE, tomcat]);
    m.servicesListEngagement.mockResolvedValue([IIS_SERVICE, tomcat]);
    usePayloadsStore.setState({ generator: "msfvenom", overrides: { h2: { os: "windows" } } });
    const { user, d } = await openOn("/e/e1/h/h1");
    expect(await d.findByRole("heading", { name: "Windows x64 ASPX" })).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: /^Fill for host/ }));
    await user.click(d.getByRole("option", { name: /zzbare02/ }));
    expect(await d.findByRole("heading", { name: "Java WAR (Tomcat on Windows)" })).toBeInTheDocument();
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
