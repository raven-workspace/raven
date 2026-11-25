import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialDock } from "../features/credentials/CredentialDock/CredentialDock";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { CredAttempt, Credential, Username } from "../types/credentials";
import type { Host } from "../types/host";
import type { Service } from "../types/service";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const H1 = host("h1", "dc01", "10.10.10.5");
const H2 = host("h2", "sql01", "10.10.10.6");
const svc = (id: string, hostId: string, port: number, nmapService: string): Service => ({
  id, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion: null, confirmedProduct: null,
  confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: 1, updatedAt: 1,
});
const SBH = new Map<string, Service[]>([
  ["h1", [svc("s1", "h1", 445, "microsoft-ds"), svc("s2", "h1", 22, "ssh")]],
  ["h2", [svc("s3", "h2", 1433, "ms-sql-s")]],
]);

const cred = (o: Partial<Credential> & { id: string }): Credential => ({
  engagementId: "e1", type: "password", username: "", domain: null, secret: "", hashType: null, scope: "domain",
  localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: 1, updatedAt: 1, ...o,
});
const attempt = (o: Partial<CredAttempt> & { id: string }): CredAttempt => ({
  engagementId: "e1", credId: "c1", usernameId: null, hostId: "h2", service: "mssql", port: null, result: "valid",
  authMode: "domain", detail: null, logEntryId: null, at: 1000, ...o,
});

const PW = cred({ id: "c1", username: "jsmith", domain: "CORP", secret: "Winter2024!", source: "lsass" });
const NT_SECRET = "8846f7eaee8fb117ad06bdd830b7586c";
const NT = cred({ id: "h", type: "hash", username: "svc", domain: "CORP", secret: NT_SECRET, hashType: "NTLM", crackStatus: "uncracked" });

interface Seed {
  cred: Credential;
  attempts?: CredAttempt[];
  folded?: boolean;
  usernames?: Username[];
  all?: Credential[];
}

function mount(seed: Seed) {
  const handlers = { onFold: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onCracked: vi.fn() };
  m.engagementGet.mockResolvedValue({ id: "e1", domain: null } as never);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialConvertToAccess.mockResolvedValue(seed.cred as never);
  const ui = render(
    <QueryClientProvider client={makeQueryClient()}>
      <CredentialDock
        eid="e1"
        cred={seed.cred}
        all={seed.all ?? [seed.cred]}
        creds={seed.all ?? [seed.cred]}
        hosts={[H1, H2]}
        servicesByHost={SBH}
        attempts={seed.attempts ?? []}
        usernames={seed.usernames ?? []}
        folded={seed.folded ?? false}
        {...handlers}
      />
    </QueryClientProvider>,
  );
  return { ...ui, ...handlers };
}

const codeMatching = (re: RegExp) => (_: string, el: Element | null) => el?.tagName === "CODE" && re.test(el.textContent ?? "");
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(within(screen.getByRole("dialog")).getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

describe("credential dock", () => {
  it("header shows name, type and scope as separate cells, the state chip, and icon actions", () => {
    mount({ cred: PW });
    const header = screen.getByTestId("dock-header");
    expect(within(header).getByText("CORP\\jsmith")).toBeInTheDocument();
    expect(within(header).getByText("password")).toBeInTheDocument();
    expect(within(header).getByText("domain")).toBeInTheDocument();
    expect(header.textContent).not.toContain(" · ");
    for (const name of ["Reveal secret for CORP\\jsmith", "Copy secret for CORP\\jsmith", "Edit CORP\\jsmith", "Delete CORP\\jsmith", "Fold credential"]) {
      expect(within(header).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(header).getByText("untested")).toBeInTheDocument();
  });

  it("state chip shows only the level; where it works is listed once, under Works on", () => {
    mount({ cred: PW, attempts: [attempt({ id: "a1" }), attempt({ id: "a2", hostId: "h1", service: "smb" })] });
    const header = screen.getByTestId("dock-header");
    expect(within(header).getByText("valid")).toBeInTheDocument();
    expect(header.textContent).not.toMatch(/sql01|dc01|\+1/);
    expect(screen.getByText(/sql01 MSSQL/)).toBeInTheDocument();
  });

  it("a later failure or a service the host no longer has removes it from works on", () => {
    const later = [attempt({ id: "a1", at: 1000 }), attempt({ id: "a2", result: "failed", at: 2000 })];
    const { unmount } = mount({ cred: PW, attempts: later });
    expect(within(screen.getByTestId("dock-header")).queryByText(/^valid$/)).not.toBeInTheDocument();
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
    unmount();
    // WinRM is not open on either host, so a valid winrm attempt is not a live cell.
    mount({ cred: PW, attempts: [attempt({ id: "a3", hostId: "h1", service: "winrm" })] });
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
    expect(within(screen.getByTestId("dock-header")).queryByText(/^valid$/)).not.toBeInTheDocument();
  });

  it("facts list source, scope and works on", () => {
    const { unmount } = mount({ cred: PW, attempts: [attempt({ id: "a1" })] });
    const facts = screen.getByTestId("dock-facts");
    expect(within(facts).getByText("lsass")).toBeInTheDocument();
    expect(within(facts).getByText("sql01 MSSQL")).toBeInTheDocument();
    unmount();
    mount({ cred: PW });
    expect(screen.getByText("nothing yet")).toBeInTheDocument();
  });

  it("a local credential whose host was deleted reads local (host deleted) in the header and the facts", () => {
    mount({ cred: cred({ id: "l1", username: "administrator", secret: "Local-1", scope: "local", localHostId: null }) });
    expect(within(screen.getByTestId("dock-header")).getByText("local (host deleted)")).toBeInTheDocument();
    const facts = screen.getByTestId("dock-facts");
    expect(within(facts).getByText("local (host deleted)")).toBeInTheDocument();
    expect(facts.querySelector(".credential-dock__scope-host")).toBeNull();
  });

  it("a credential with no work tabs lays its facts out across the dock", () => {
    mount({ cred: cred({ id: "m1", type: "ticket", username: "admin", domain: "CORP", secret: "ticket-data", source: "rubeus" }) });
    const facts = screen.getByTestId("dock-facts");
    expect(facts).toHaveAttribute("data-layout", "row");
    for (const label of ["Source", "Scope", "Works on"]) expect(within(facts).getByText(label)).toHaveClass("credential-dock__fact-label");
    expect(within(facts).getByText("rubeus")).toBeInTheDocument();
    expect(within(facts).getByText("nothing yet")).toBeInTheDocument();
  });

  it("an uncracked NTLM hash opens on the Crack tab with masked commands; copy has the real hash", async () => {
    const user = userEvent.setup();
    mount({ cred: NT });
    expect(screen.getByRole("tab", { name: "Crack" })).toHaveAttribute("aria-selected", "true");
    const pane = await screen.findByRole("tabpanel", { name: "Crack" });
    expect(within(pane).getByText(codeMatching(/hashcat -m 1000 /))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(NT_SECRET);
    await user.click(within(pane).getByRole("button", { name: "Copy hashcat command" }));
    expect(await navigator.clipboard.readText()).toBe(`hashcat -m 1000 '${NT_SECRET}' /usr/share/wordlists/rockyou.txt`);
  });

  it("a hash containing a quote is never in the DOM unrevealed", async () => {
    mount({ cred: cred({ id: "h", type: "hash", username: "jsmith", secret: "$6$sa'lt$abcdefgh", crackStatus: "uncracked" }) });
    const pane = await screen.findByRole("tabpanel", { name: "Crack" });
    expect(within(pane).getByText(codeMatching(/hashcat -m 1800/))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sa'lt");
    expect(document.body.textContent).not.toContain("abcdefgh");
  });

  it("Record plaintext opens the crack dialog and reports the new password", async () => {
    const user = userEvent.setup();
    const newPw = cred({ id: "p", username: "svc", domain: "CORP", secret: "Summer25!" });
    m.credentialCrack.mockResolvedValue(newPw);
    const { onCracked } = mount({ cred: NT });
    await user.click(await screen.findByRole("button", { name: "Record plaintext" }));
    const dlg = await screen.findByRole("dialog");
    await user.type(within(dlg).getByLabelText("Plaintext"), "Summer25!");
    await user.click(within(dlg).getByRole("button", { name: "Save password" }));
    await waitFor(() => expect(onCracked).toHaveBeenCalledWith(newPw));
    expect(m.credentialCrack).toHaveBeenCalledWith("h", "Summer25!");
  });

  it("Mark uncrackable, then Reset", async () => {
    const user = userEvent.setup();
    m.credentialSetCrackStatus.mockImplementation(async (id, status) => ({ ...NT, id, crackStatus: status }));
    const { rerender } = mount({ cred: NT });
    await user.click(await screen.findByRole("button", { name: "Mark uncrackable" }));
    expect(m.credentialSetCrackStatus).toHaveBeenCalledWith("h", "uncrackable");
    // The list refreshes the credential; the dock then offers Reset.
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <CredentialDock eid="e1" cred={{ ...NT, crackStatus: "uncrackable" }} all={[NT]} creds={[NT]} hosts={[H1, H2]} servicesByHost={SBH}
          attempts={[]} usernames={[]} folded={false} onFold={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCracked={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Reset" }));
    expect(m.credentialSetCrackStatus).toHaveBeenLastCalledWith("h", "uncracked");
  });

  it("Test tab lists the routine's service steps with Done toggles; steps that don't apply say so", async () => {
    const user = userEvent.setup();
    mount({ cred: PW });
    const pane = await screen.findByRole("tabpanel", { name: "Test" });
    const winrm = within(pane).getByRole("listitem", { name: "WinRM" });
    expect(within(winrm).getByText("Doesn't apply")).toBeInTheDocument();
    expect(within(winrm).queryByRole("button", { name: /^Copy/ })).not.toBeInTheDocument();
    const smb = within(pane).getByRole("listitem", { name: "SMB" });
    expect(within(smb).queryByText("Doesn't apply")).not.toBeInTheDocument();
    expect(smb).toHaveTextContent("••••••••");
    expect(smb).not.toHaveTextContent("Winter2024!");
    await user.click(within(smb).getByRole("button", { name: "Copy smb domain command" }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain("Winter2024!");
    expect(copied).toContain("nxc smb 10.10.10.5");
    expect(document.body).not.toHaveTextContent("Winter2024!");
    await user.click(within(smb).getByRole("button", { name: "Done: SMB" }));
    await waitFor(() => expect(m.checklistPut).toHaveBeenCalled());
    expect(m.checklistPut.mock.calls[0][1]).toEqual([
      expect.objectContaining({ ownerId: "e1", goalId: "cred-routine-smb", status: "done" }),
    ]);
  });

  it("a ticket shows facts only, full width", () => {
    mount({ cred: cred({ id: "t", type: "ticket", username: "svc", secret: "doIF..." }) });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
  });

  it("a placeholder secret shows 'no secret' and Convert to access-only", async () => {
    const user = userEvent.setup();
    mount({ cred: cred({ id: "c1", username: "guest", domain: "CORP", secret: "none" }) });
    const header = screen.getByTestId("dock-header");
    expect(within(header).getByText("no secret")).toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /^(Reveal|Copy)/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert to access-only" }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    expect(await within(dlg).findByText("Choose a host")).toBeInTheDocument();
    expect(m.credentialConvertToAccess).not.toHaveBeenCalled();
    await pick(user, "Access on host", "dc01");
    await pick(user, "Access level", "admin");
    await user.type(within(dlg).getByLabelText("Access via"), "null session");
    await user.click(within(dlg).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(m.credentialConvertToAccess).toHaveBeenCalledWith("c1", { hostId: "h1", level: "admin", via: "null session" }));
  });

  it("Fold collapses the dock to its header", async () => {
    const user = userEvent.setup();
    const { onFold, rerender } = mount({ cred: PW });
    await user.click(screen.getByRole("button", { name: "Fold credential" }));
    expect(onFold).toHaveBeenCalledWith(true);
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <CredentialDock eid="e1" cred={PW} all={[PW]} creds={[PW]} hosts={[H1, H2]} servicesByHost={SBH} attempts={[]} usernames={[]}
          folded onFold={onFold} onEdit={vi.fn()} onDelete={vi.fn()} onCracked={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("Source")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open credential" }));
    expect(onFold).toHaveBeenLastCalledWith(false);
  });

  it("Esc inside the dock folds it", async () => {
    const user = userEvent.setup();
    const { onFold } = mount({ cred: PW });
    // A focused icon button would have its tooltip consume the first Esc; the tab has none.
    screen.getByRole("tab", { name: "Test" }).focus();
    await user.keyboard("{Escape}");
    expect(onFold).toHaveBeenCalledWith(true);
    // The body goes away on fold: focus lands on the fold button, not <body>.
    expect(screen.getByRole("button", { name: "Fold credential" })).toHaveFocus();
  });
});
