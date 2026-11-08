import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { ChecklistItem } from "../types/checklist";
import type { CredAttempt, Credential, Username } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const svc = (id: string, port: number, nmapService: string): Service => ({
  id, hostId: "h1", port, protocol: "tcp", state: "open", nmapService, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const SERVICES = [svc("s1", 445, "microsoft-ds"), svc("s2", 22, "ssh")];

const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const attempt = (o: Partial<CredAttempt> & { id: string }): CredAttempt => ({
  engagementId: "e1", credId: "c1", usernameId: null, hostId: "h1", service: "smb", port: null, result: "valid",
  authMode: "domain", detail: null, logEntryId: null, at: 1000, ...o,
});

const PW = cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!", createdAt: 5 });
// An NT hash can't be tried over ssh, so that cell is not applicable.
const NT = cred({ id: "c2", type: "hash", username: "svc", domain: "CORP", secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM", createdAt: 1 });

function mount(seed: { creds: Credential[]; attempts?: CredAttempt[]; users?: Username[]; checklist?: ChecklistItem[] }) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.checklistList.mockResolvedValue(seed.checklist ?? []);
  m.servicesListEngagement.mockResolvedValue(SERVICES);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue(seed.creds);
  m.usernamesList.mockResolvedValue(seed.users ?? []);
  m.accessGrantsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue(seed.attempts ?? []);
  m.credAttemptsUpsert.mockResolvedValue([]);
  m.credAttemptDelete.mockResolvedValue(null);
  m.checklistPut.mockResolvedValue([]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/e/e1/s/credentials"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
});

describe("test grid", () => {
  it("grid shows admin, valid, failed and na cells from attempts", async () => {
    mount({
      creds: [PW, NT],
      attempts: [
        attempt({ id: "a1", result: "admin" }),
        attempt({ id: "a2", service: "ssh", result: "failed", authMode: "local" }),
        attempt({ id: "a3", credId: "c2", result: "valid" }),
      ],
    });
    const grid = await screen.findByRole("table", { name: "Test grid" });
    expect(within(grid).getByRole("button", { name: "CORP\\jsmith on dc01 SMB: admin" })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /^CORP\\jsmith on dc01 SSH: failed/ })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "CORP\\svc (hash) on dc01 SMB: valid" })).toBeInTheDocument();
    expect(within(grid).getByRole("img", { name: "CORP\\svc (hash) on dc01 SSH: not applicable" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();
  });

  it("setting a cell result upserts an attempt marked set by hand", async () => {
    const user = userEvent.setup();
    mount({ creds: [PW] });
    await user.click(await screen.findByRole("button", { name: "CORP\\jsmith on dc01 SMB: untested" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Set domain result: valid" }));
    await waitFor(() => expect(m.credAttemptsUpsert).toHaveBeenCalledTimes(1));
    expect(m.credAttemptsUpsert).toHaveBeenCalledWith("e1", [
      expect.objectContaining({ credId: "c1", hostId: "h1", service: "smb", result: "valid", authMode: "domain", detail: "set by hand" }),
    ]);
  });

  it("clear removes it", async () => {
    const user = userEvent.setup();
    mount({ creds: [PW], attempts: [attempt({ id: "a1", result: "failed", detail: "STATUS_LOGON_FAILURE" })] });
    await user.click(await screen.findByRole("button", { name: "CORP\\jsmith on dc01 SMB: domain failed, local untried" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("STATUS_LOGON_FAILURE")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Clear domain result" }));
    await waitFor(() => expect(m.credAttemptDelete).toHaveBeenCalledWith("a1"));
  });
});

describe("credential routine", () => {
  it("routine rows that don't apply are dimmed", async () => {
    mount({ creds: [PW] });
    const routine = await screen.findByRole("region", { name: "Credential routine" });
    const winrm = within(routine).getByRole("listitem", { name: "WinRM" });
    expect(within(winrm).getByText("Doesn't apply")).toBeInTheDocument();
    expect(within(winrm).queryByRole("button", { name: /^Copy/ })).not.toBeInTheDocument();
    expect(within(within(routine).getByRole("listitem", { name: "SMB" })).queryByText("Doesn't apply")).not.toBeInTheDocument();
  });

  it("routine command copy contains the real secret, display masks it", async () => {
    const user = userEvent.setup();
    mount({ creds: [PW] });
    const routine = await screen.findByRole("region", { name: "Credential routine" });
    const smb = within(routine).getByRole("listitem", { name: "SMB" });
    expect(smb).toHaveTextContent("••••••••");
    expect(smb).not.toHaveTextContent("Winter2024!");
    await user.click(within(smb).getByRole("button", { name: "Copy smb domain command" }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Winter2024!");
    expect(copied).toContain("nxc smb 10.10.10.5");
    expect(document.body).not.toHaveTextContent("Winter2024!");
  });

  it("a whitespace-padded NT hash never reaches the DOM and copies trimmed", async () => {
    const user = userEvent.setup();
    const nt = "8846f7eaee8fb117ad06bdd830b7586c";
    mount({ creds: [cred({ id: "c3", type: "hash", username: "padded", domain: "CORP", secret: ` ${nt}\n`, hashType: "NTLM" })] });
    const routine = await screen.findByRole("region", { name: "Credential routine" });
    const smb = within(routine).getByRole("listitem", { name: "SMB" });
    expect(smb).toHaveTextContent("-H ••••••••");
    expect(document.body).not.toHaveTextContent(nt);
    await user.click(within(smb).getByRole("button", { name: "Copy smb domain command" }));
    expect(await navigator.clipboard.readText()).toContain(`-H '${nt}'`);
  });

  it("a secret that is a substring of the username or service only masks the secret", async () => {
    mount({ creds: [cred({ id: "c4", username: "jsmith", secret: "smb" })] });
    const routine = await screen.findByRole("region", { name: "Credential routine" });
    const smb = within(routine).getByRole("listitem", { name: "SMB" });
    expect(within(smb).getAllByText("nxc smb 10.10.10.5 -u 'jsmith' -p •••••••• --local-auth | tee nxc-smb-jsmith-local.txt")).toHaveLength(1);
  });

  it("ticking a routine step sets its checklist item", async () => {
    const user = userEvent.setup();
    mount({ creds: [PW] });
    const routine = await screen.findByRole("region", { name: "Credential routine" });
    await user.click(within(routine).getByRole("button", { name: "Done: SMB" }));
    await waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut.mock.calls[0][1]).toEqual([
      expect.objectContaining({ ownerId: "e1", goalId: "cred-routine-smb", status: "done" }),
    ]);
  });
});
