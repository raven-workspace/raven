import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { getLibrary, setImported } from "../engines/library/store";
import { filePickFor, useFilePickStore } from "../features/checklist/filePick";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useCredPickStore } from "../features/checklist/credPick";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

vi.mock("../lib/api");
vi.mock("../features/checklist/ticks", async (orig) => ({
  ...(await orig<typeof import("../features/checklist/ticks")>()),
  resyncBoards: vi.fn().mockResolvedValue(undefined),
}));
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const host = (id: string, name: string, ip: string, over: Partial<Host> = {}): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1, ...over,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "web07", "10.10.10.6", { os: "linux" });
function mount(opts: { hosts?: Host[] } = {}) {
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue(opts.hosts ?? [H1, H2]);
  m.checklistList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/h/h1"]}>
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
  useCredPickStore.getState().reset();
  useFilePickStore.setState({ hostId: "", file: "" });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "",
  });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.hopCreate.mockResolvedValue({ id: "hp1", engagementId: "e1", fromHostId: null, toHostId: "h1", via: "x", logEntryId: null, at: 1, updatedAt: 1 });
});


const GOAL = "h-enum-full-tcp";
const TOOLKIT = [
  { os: "windows" as const, purpose: "Enumeration", file: "winPEASx64_ofs.exe", note: "", where: "", staged: true },
  { os: "linux" as const, purpose: "Enumeration", file: "linpeas.sh", note: "", where: "", staged: true },
];
beforeEach(() => {
  // The goal's first command takes {FILE}, so the Now panel (first command only) shows it too.
  const first = getLibrary().find((c) => c.goals.includes(GOAL))!;
  setImported({ commands: [{ ...first, template: "zzrun {FILE} on {TARGET_IP}", exam: undefined }], cards: [], toolkit: TOOLKIT });
});
afterEach(() => setImported({ commands: [], cards: [] }));

const copyOf = async (user: ReturnType<typeof userEvent.setup>, root: ReturnType<typeof within>) => {
  await user.click(root.getAllByRole("button", { name: /^Copy command: / })[0]!);
  return navigator.clipboard.readText();
};

describe("{FILE} chip on checklist steps", () => {
  it("a step with {FILE} shows the chip; picking a Toolkit file fills its text and copy", async () => {
    const user = userEvent.setup();
    mount({ hosts: [H1, H2] });
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    const panel = within(await screen.findByRole("tabpanel"));
    const row = within((await panel.findByText("Scan all 65,535 TCP ports")).closest("li")!);
    const text = (t: string) => row.findByText((_, el) => el?.tagName === "PRE" && el.textContent === t);
    expect(await text("zzrun {FILE} on 10.10.10.5")).toBeInTheDocument();
    await user.click(row.getByRole("combobox", { name: "Value for FILE" }));
    const list = await row.findByRole("listbox", { name: "Suggestions for FILE" });
    // Windows host: only its Toolkit files.
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await user.click(within(list).getByRole("option", { name: /winPEASx64_ofs/ }));
    expect(await text("zzrun winPEASx64_ofs.exe on 10.10.10.5")).toBeInTheDocument();
    expect(await copyOf(user, row)).toBe("zzrun winPEASx64_ofs.exe on 10.10.10.5");
    // Back on the current stage's steps, the same pick holds.
    await user.click(screen.getByRole("button", { name: "Full checklist" }));
    expect(await panel.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzrun winPEASx64_ofs.exe on 10.10.10.5")).toBeInTheDocument();
  });

  it("a pick is for one host: another host starts unfilled", async () => {
    const user = userEvent.setup();
    mount({ hosts: [H1, H2] });
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    const row = within((await within(await screen.findByRole("tabpanel")).findByText("Scan all 65,535 TCP ports")).closest("li")!);
    await user.type(row.getByRole("combobox", { name: "Value for FILE" }), "a.exe");
    expect(await row.findByText((_, el) => el?.tagName === "PRE" && el.textContent === "zzrun a.exe on 10.10.10.5")).toBeInTheDocument();
    expect(useFilePickStore.getState()).toMatchObject({ hostId: "h1", file: "a.exe" });
    expect(filePickFor("h2")).toBe("");
  });
});
