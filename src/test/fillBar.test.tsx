import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setImported } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { CommandPane } from "../features/arsenal/CardView";
import { CredChip, isCredPickKey } from "../features/arsenal/CredChip";
import type { CredChipHandle } from "../features/arsenal/CredChip";
import { FillBar } from "../features/arsenal/FillBar";
import { useCredPickStore } from "../features/checklist/credPick";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { CredAttempt, Credential } from "../types/credentials";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";

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
const cred = (id: string, username: string, type: Credential["type"] = "password"): Credential => ({
  id, engagementId: "e1", type, username, domain: "CORP", secret: "Hunter2!", hashType: null, scope: "domain", localHostId: null,
  sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 1, updatedAt: 1,
});
const attempt = (credId: string, result: CredAttempt["result"]): CredAttempt => ({
  id: `a-${credId}`, engagementId: "e1", credId, usernameId: null, hostId: "h1", service: "smb", port: null, result, authMode: "domain", detail: null, logEntryId: null, at: 1,
});

const SUGGEST = { hosts: [], toolkit: [] };
type Auto = Record<string, { text: string; unresolved: boolean; dcByName?: boolean }>;

function Bar({ tokens, auto, initial = {} }: { tokens: string[]; auto: Auto; initial?: Record<string, string> }) {
  const [overrides, setOverrides] = useState(initial);
  return <FillBar tokens={tokens} auto={auto} overrides={overrides} onOverrides={setOverrides} suggest={SUGGEST} os={null} />;
}
const fieldNames = () => screen.getAllByRole("combobox").map((el) => el.getAttribute("aria-label"));

describe("FillBar", () => {
  it("fields keep template order after editing one", async () => {
    const user = userEvent.setup();
    render(<Bar tokens={["LHOST", "PORT"]} auto={{ LHOST: { text: "10.10.14.9", unresolved: false }, PORT: { text: "", unresolved: true } }} />);
    expect(fieldNames()).toEqual(["Value for LHOST", "Value for PORT"]);
    await user.type(screen.getByRole("combobox", { name: "Value for PORT" }), "8080");
    await user.type(screen.getByRole("combobox", { name: "Value for LHOST" }), "1");
    expect(fieldNames()).toEqual(["Value for LHOST", "Value for PORT"]);
  });

  it("an auto-filled value shows as text, an unfilled field is amber", () => {
    render(<Bar tokens={["LHOST", "PORT"]} auto={{ LHOST: { text: "10.10.14.9", unresolved: false }, PORT: { text: "", unresolved: true } }} />);
    const filled = screen.getByRole("combobox", { name: "Value for LHOST" });
    expect(filled).toHaveValue("10.10.14.9");
    expect(filled).not.toHaveAttribute("placeholder", "10.10.14.9");
    expect(filled).toHaveClass("text-fg-2!");
    expect(filled).not.toHaveClass("border-warn!");
    expect(screen.getByText("LHOST").closest("label")).not.toHaveClass("text-warn");
    const empty = screen.getByRole("combobox", { name: "Value for PORT" });
    expect(empty).toHaveValue("");
    expect(empty).toHaveClass("border-warn!");
    expect(screen.getByText("PORT").closest("label")).toHaveClass("text-warn");
  });

  it("typing over an auto value overrides it and clearing falls back to it", async () => {
    const user = userEvent.setup();
    render(<Bar tokens={["LHOST"]} auto={{ LHOST: { text: "10.10.14.9", unresolved: false } }} />);
    const f = screen.getByRole("combobox", { name: "Value for LHOST" });
    await user.clear(f);
    expect(f).toHaveValue("10.10.14.9");
    await user.type(f, "{Backspace}x");
    expect(f).toHaveValue("10.10.14.x");
  });

  it("the DC by-name note shows once, on DC_IP", () => {
    const auto: Auto = { DC_IP: { text: "10.10.10.5", unresolved: false, dcByName: true }, DC_NAME: { text: "dc01", unresolved: false, dcByName: true } };
    render(<Bar tokens={["DC_IP", "DC_NAME"]} auto={auto} />);
    expect(screen.getAllByText("(by name)")).toHaveLength(1);
    expect(within(screen.getByText("DC_IP").closest("label")!).getByText("(by name)")).toBeInTheDocument();
  });

  it("hands each field's element to fieldRef", () => {
    const seen: Record<string, HTMLInputElement | null> = {};
    render(<FillBar tokens={["LHOST"]} auto={{ LHOST: { text: "x", unresolved: false } }} overrides={{}} onOverrides={() => {}} suggest={SUGGEST} os={null} fieldRef={(t, el) => { seen[t] = el; }} />);
    expect(seen.LHOST).toBe(screen.getByRole("combobox", { name: "Value for LHOST" }));
  });
});

describe("CredChip", () => {
  const CREDS = [cred("c1", "alice"), cred("c2", "bob", "hash")];

  it("reads as a Credential picker, is a Tab stop, and lists tested state", async () => {
    const user = userEvent.setup();
    const ref = createRef<CredChipHandle>();
    const onPick = vi.fn();
    render(
      <form>
        <input aria-label="first" />
        <CredChip ref={ref} credentials={CREDS} value={CREDS[1]!} onPick={onPick} hostId="h1" attempts={[attempt("c1", "admin")]} />
        <input aria-label="last" />
      </form>,
    );
    const chip = screen.getByRole("button", { name: /Fill with credential/ });
    expect(chip).toHaveTextContent(/^Credential\s*CORP\\bob \(hash\)/);
    expect(chip).not.toHaveAttribute("tabindex", "-1");
    await user.click(screen.getByLabelText("first"));
    await user.tab();
    expect(chip).toHaveFocus();
    act(() => ref.current?.open());
    const opts = within(screen.getByRole("listbox", { name: "Fill with credential" })).getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual(["No credential", "CORP\\alicepasswordadmin", "CORP\\bobhashuntested"]);
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onPick).toHaveBeenCalledWith("c1");
  });

  it("reads 'as no credential' with none and picks null", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { rerender } = render(<CredChip credentials={CREDS} value={null} onPick={onPick} />);
    expect(screen.getByRole("button", { name: /Fill with credential/ })).toHaveTextContent(/^Credential\s*No credential/);
    rerender(<CredChip credentials={CREDS} value={CREDS[0]!} onPick={onPick} />);
    const chip = screen.getByRole("button", { name: /Fill with credential/ });
    await user.click(chip);
    await user.click(screen.getByRole("option", { name: /No credential/ }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("⌥C is the pick key, by key code", () => {
    expect(isCredPickKey({ altKey: true, metaKey: false, ctrlKey: false, code: "KeyC", key: "ç" })).toBe(true);
    expect(isCredPickKey({ altKey: false, metaKey: false, ctrlKey: false, code: "KeyC", key: "c" })).toBe(false);
  });
});

describe("credential pick is shared with the host checklist", () => {
  const USERCMD: LibraryCommand = { id: "zz-user", title: "Zzuser login", tool: "zz", template: "zzuser {USER}@{TARGET_IP} {PASS}", os: "any", runFrom: "attacker", goals: [], source: "raven" };

  beforeEach(() => {
    vi.resetAllMocks();
    useCredPickStore.getState().reset();
    setImported({ commands: [USERCMD], cards: [] });
    m.settingsGet.mockResolvedValue({
      autoLockMinutes: 30, backupRetention: 14, machines: [], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
      windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
    });
    m.engagementGet.mockResolvedValue(E1);
    m.hostsList.mockResolvedValue([H1]);
    m.servicesListEngagement.mockResolvedValue([]);
    m.tunnelsList.mockResolvedValue([]);
    m.logList.mockResolvedValue([]);
    m.credentialsList.mockResolvedValue([cred("c1", "alice"), cred("c2", "bob")]);
    m.credAttemptsList.mockResolvedValue([]);
  });

  it("the credential picked for the host supplies USER, and PASS is never a field", async () => {
    useCredPickStore.getState().set("h1", "c2");
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <CommandPane commands={[USERCMD]} engagementId="e1" hostId="h1" overrides={{}} onOverrides={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("combobox", { name: "Value for TARGET_IP" });
    // The pane has no credential chip of its own: the surface's header holds it.
    expect(screen.queryByRole("button", { name: /Fill with credential/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Value for (USER|PASS|HASH|CRED)/ })).not.toBeInTheDocument();
  });

  const mountPane = () =>
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <CommandPane commands={[USERCMD]} engagementId="e1" hostId="h1" overrides={{}} onOverrides={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("an ownerless credential supplies no USER: the field stays", async () => {
    m.credentialsList.mockResolvedValue([{ ...cred("c3", ""), domain: null }]);
    useCredPickStore.getState().set("h1", "c3");
    mountPane();
    expect(await screen.findByRole("combobox", { name: "Value for USER" })).toBeInTheDocument();
  });

  it("a credential with no domain on a domainless engagement leaves DOMAIN a field, and USER hidden", async () => {
    const DOMCMD: LibraryCommand = { ...USERCMD, id: "zz-dom", template: "zzdom -u {USER} -d {DOMAIN} {TARGET_IP}" };
    setImported({ commands: [DOMCMD], cards: [] });
    m.credentialsList.mockResolvedValue([{ ...cred("c4", "alice"), domain: null }]);
    useCredPickStore.getState().set("h1", "c4");
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <CommandPane commands={[DOMCMD]} engagementId="e1" hostId="h1" overrides={{}} onOverrides={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("combobox", { name: "Value for DOMAIN" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Value for USER" })).not.toBeInTheDocument();
  });
});
