import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
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
const LIN: Host = {
  id: "h3", engagementId: "e1", name: "zzlin03", ip: "198.51.100.20", os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const at = new Date(2026, 10, 7, 14, 2).getTime();
/** A logged payload on the Linux host that returned nothing. */
const failed = (id: string, payloadId: string, t: number): LogEntry => ({
  id, engagementId: "e1", kind: "command", title: payloadId, titleEdited: false, ranOn: "zzlin03", hostIds: ["h3"],
  observations: null, returnedNothing: true, private: false, payloadId,
  content: { kind: "command", blocks: [{ command: "zz", output: "" }] },
  at: t, createdAt: t, updatedAt: t,
});

const def = (id: string) => REVERSE_SHELLS.find((d) => d.id === id)!;

function mount(path: string, engagement: Engagement = E1) {
  m.engagementGet.mockResolvedValue(engagement);
  m.engagementsList.mockResolvedValue([engagement]);
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: LHOST, listenerPort: LPORT, kaliUser: "kali",
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
  useLastEngagementStore.setState({ engagementId: "e1", hostId: "h3" });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: { h3: { context: "bash-prompt" } }, lhost: null, listenerPick: {} });
  useNotesStore.setState({ open: false });
  setImported({ commands: [], cards: [] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([LIN]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  vi.mocked(logCommand).mockResolvedValue(failed("l0", "bash-tcp", at));
});
afterEach(() => setImported({ commands: [], cards: [] }));

const drawer = () => screen.findByRole("complementary", { name: "Payloads" });
const payloadText = (d: ReturnType<typeof within>) => d.getByLabelText("Command: Payload").textContent;
const fitNames = (d: ReturnType<typeof within>) =>
  within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option").map((o) => o.querySelector("[data-fit-name]")?.textContent);
const fitRow = (d: ReturnType<typeof within>, name: string) =>
  within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option").find((o) => o.querySelector("[data-fit-name]")?.textContent === name)!;

async function openDrawer() {
  const user = userEvent.setup();
  mount("/e/e1/h/h3");
  await screen.findByRole("tab", { name: "Next" });
  await user.keyboard("p");
  const d = within(await drawer());
  await d.findByRole("heading", { name: "Bash /dev/tcp" });
  return { user, d };
}

describe("Payloads toggles", () => {
  it("⌥B blocks callbacks: binds come first, reverse shells stay fits marked 'Needs a callback'", async () => {
    const { user, d } = await openDrawer();
    expect(d.getByRole("button", { name: "Callbacks: allowed" })).toBeInTheDocument();
    await user.keyboard("{Alt>}b{/Alt}");
    expect(d.getByRole("button", { name: "Callbacks: allowed" })).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(d.getByRole("button", { name: "Callbacks: blocked" })).toBeInTheDocument();
    expect(fitNames(d)[0]).toBe("mkfifo + nc bind");
    // A bind row says so first.
    expect(within(fitRow(d, "mkfifo + nc bind")).getAllByText(/./).map((s) => s.textContent)).toContain("bind");
    const bash = fitRow(d, "Bash /dev/tcp");
    expect(within(bash).getByText("Needs a callback")).toHaveClass("text-warn");
    // Marks come before the requires reasons.
    const texts = [...bash.querySelectorAll("span span")].map((s) => s.textContent);
    expect(texts.indexOf("Needs a callback")).toBeLessThan(texts.indexOf("uses bash"));
    expect(d.queryByRole("button", { name: /^Don't fit here/ })?.textContent ?? "").not.toContain("Bash /dev/tcp");
  });

  it("a callback clue turns the chip amber but never flips it", async () => {
    m.logList.mockResolvedValue([failed("l1", "bash-tcp", at), failed("l2", "python3", at + 1)]);
    const user = userEvent.setup();
    mount("/e/e1/h/h3");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("p");
    const d = within(await drawer());
    await d.findByRole("heading", { name: "mkfifo + nc" });
    const chip = d.getByRole("button", { name: "Callbacks: allowed" });
    expect(chip.querySelector(".text-warn")).not.toBeNull();
    expect(d.getByText("Callbacks failed here twice")).toBeInTheDocument();
    // Still a reverse shell first: Raven never flips the toggle.
    expect(fitNames(d)[0]).toBe("mkfifo + nc");
  });

  it("⌥F offers filter wrappers only in injection contexts", async () => {
    usePayloadsStore.setState({ overrides: { h3: { context: "injected-linux" } } });
    const { user, d } = await openDrawer();
    expect(d.getByRole("button", { name: "Filter: off" })).toBeInTheDocument();
    await user.keyboard("{Alt>}f{/Alt}");
    expect(d.getByRole("listbox", { name: "Filter" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(d.getByRole("button", { name: "Filter: base64" })).toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("bash-tcp"), "injected-linux", { LHOST, LPORT }, { filter: "b64" }).text);
    await user.keyboard("{Alt>}w{/Alt}");
    await user.keyboard("{Home}{Enter}");
    expect(d.getByRole("button", { name: "Paste into: Bash prompt" })).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /^Filter: / })).not.toBeInTheDocument();
    expect(payloadText(d)).toBe(buildPayload(def("bash-tcp"), "bash-prompt", { LHOST, LPORT }).text);
  });

  it("⌥T marks a missing tool and sorts it after every unmarked fit", async () => {
    const { user, d } = await openDrawer();
    const chip = d.getByRole("button", { name: "Tools: not set" });
    await user.keyboard("{Alt>}t{/Alt}");
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(chip).toHaveFocus();
    // bash, then python3: two steps right is "missing".
    await user.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}");
    expect(d.getByRole("option", { name: "python3: missing" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(d.getByRole("button", { name: "Tools: 1 set" })).toHaveFocus();
    expect(screen.getByRole("complementary", { name: "Payloads" })).toBeInTheDocument();
    const py = fitRow(d, "Python 3 with PTY");
    expect(within(py).getByText("Needs python3")).toHaveClass("text-warn");
    const names = fitNames(d);
    const rows = within(d.getByRole("listbox", { name: "Fits" })).getAllByRole("option");
    const marked = rows.map((r) => r.querySelector(".text-warn") !== null);
    const pyAt = names.indexOf("Python 3 with PTY");
    expect(marked.slice(0, pyAt).every((x) => !x)).toBe(true);
  });

  it("a tool seen in your log shows 'from your log' in the picker", async () => {
    m.logList.mockResolvedValue([{
      ...failed("l1", "zz", at), payloadId: null, returnedNothing: false,
      content: { kind: "command", blocks: [{ command: "which python3 socat", output: "/usr/bin/python3" }] },
    }]);
    const { user, d } = await openDrawer();
    await user.click(d.getByRole("button", { name: "Tools: 2 set" }));
    expect(d.getByRole("option", { name: "python3: on box, from your log" })).toBeInTheDocument();
    expect(d.getByRole("option", { name: "socat: missing, from your log" })).toBeInTheDocument();
  });

  it("the listener pick sticks per payload", async () => {
    usePayloadsStore.setState({ overrides: { h3: { context: "bash-prompt", port: "443" } } });
    const { user, d } = await openDrawer();
    await user.click(fitRow(d, "socat with full TTY"));
    const pick = d.getByRole("button", { name: "Listener: socat (full TTY)" });
    expect(pick.tabIndex).toBe(0);
    await user.click(pick);
    await user.click(within(d.getByRole("listbox", { name: "Listener" })).getByRole("option", { name: /rlwrap nc/ }));
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("rlwrap nc -lvnp 443");
    await user.click(fitRow(d, "Bash /dev/tcp"));
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("penelope -O -p 443");
    // Back on socat: its own pick is still there.
    await user.click(fitRow(d, "socat with full TTY"));
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("rlwrap nc -lvnp 443");
  });

  it("a bind shell connects from Kali to the host's IP", async () => {
    const { user, d } = await openDrawer();
    await user.click(fitRow(d, "mkfifo + nc bind"));
    expect(d.getByRole("heading", { name: "Connect from Kali" })).toBeInTheDocument();
    expect(d.getByLabelText("Command: Listener")).toHaveTextContent("rlwrap nc -nv 198.51.100.20 4444");
  });

  it("the hint line lists ⌥B and ⌥T for the shell generator, not for Transfer", async () => {
    const { user } = await openDrawer();
    const aside = screen.getByRole("complementary", { name: "Payloads" });
    await user.click(within(aside).getByRole("button", { name: "All shortcuts" }));
    expect(await screen.findByText("callbacks")).toBeInTheDocument();
    expect(screen.getByText("tools")).toBeInTheDocument();
    expect(screen.queryByText("filter")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.keyboard("{Alt>}2{/Alt}");
    await user.click(within(aside).getByRole("button", { name: "All shortcuts" }));
    await screen.findAllByText("generator");
    expect(screen.queryByText("callbacks")).not.toBeInTheDocument();
    expect(screen.queryByText("tools")).not.toBeInTheDocument();
  });
});

describe("Workbench toggles", () => {
  const read = () => within(screen.getByRole("complementary", { name: "Raven's read" }));

  it("Callbacks, Filter and Tools sit in Raven's read; ⌥B and ⌥T reach them", async () => {
    usePayloadsStore.setState({ overrides: { h3: { context: "injected-linux" } } });
    const user = userEvent.setup();
    mount("/payloads");
    const w = within(await screen.findByRole("main", { name: "Payloads" }));
    await w.findByRole("heading", { name: "Bash /dev/tcp" });
    const r = read();
    for (const label of ["Callbacks", "Filter", "Tools"]) expect(r.getAllByText(label, { selector: "span.text-muted-2" })[0]).toBeInTheDocument();
    await user.keyboard("{Alt>}b{/Alt}");
    expect(r.getByRole("button", { name: "Allowed" })).toHaveFocus();
    await user.click(r.getByRole("button", { name: "Blocked" }));
    expect(r.getByRole("button", { name: "Blocked" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Alt>}f{/Alt}");
    expect(r.getByRole("button", { name: "Off" })).toHaveFocus();
    await user.keyboard("{Alt>}t{/Alt}");
    expect(r.getByRole("button", { name: "Tools: not set" })).toHaveAttribute("aria-expanded", "true");
    expect(r.getByText("No exam limits.")).toBeInTheDocument();
  });

  it("exam rules in an exam sim name the Meterpreter limit", async () => {
    mount("/payloads", { ...E1, kind: "exam-sim" });
    const w = within(await screen.findByRole("main", { name: "Payloads" }));
    await w.findByRole("heading", { name: "Bash /dev/tcp" });
    expect(read().getByText("Meterpreter: one machine only. Not locked yet.")).toBeInTheDocument();
  });

  it("exam rules say which host Meterpreter is locked to", async () => {
    mount("/payloads", { ...E1, kind: "exam-sim", msfHostId: "h3" });
    const w = within(await screen.findByRole("main", { name: "Payloads" }));
    await w.findByRole("heading", { name: "Bash /dev/tcp" });
    expect(read().getByText("Meterpreter: one machine only. Locked to zzlin03.")).toBeInTheDocument();
  });
});
