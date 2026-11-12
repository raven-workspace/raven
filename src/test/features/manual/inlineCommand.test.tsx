import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseNote, type ManualNote } from "../../../engines/manual";
import { useCredPickStore } from "../../../features/checklist/credPick";
import { logCommand } from "../../../features/capture/logCommand";
import { inlineOf, NoteView, type Ctx } from "../../../features/manual/NoteView";
import { useManualStatus } from "../../../features/manual/useManualStatus";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Credential } from "../../../types/credentials";
import type { Engagement } from "../../../types/engagement";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
vi.mock("../../../features/capture/logCommand", () => ({ logCommand: vi.fn(() => Promise.resolve({})) }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["192.0.2.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "zzdc01.example.test", ip: "192.0.2.10", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const CRED: Credential = {
  id: "c1", engagementId: "e1", type: "password", username: "zzuser", domain: null, secret: "Zz-Secret1", hashType: null, scope: "domain", localHostId: null,
  sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: 1, updatedAt: 1,
};

const note = (lines: string[]): ManualNote => parseNote("03-Tools/Zz Tool.md", ["# Zz Tool", "## Shares", ...lines].join("\n"))!;
function mount(n: ManualNote) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <NoteView note={n} notes={[n]} cards={[]} hostId="h1" engagementId="e1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const status = () => useManualStatus.getState();

beforeEach(() => {
  vi.resetAllMocks();
  useManualStatus.getState().clear();
  useCredPickStore.getState().reset();
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["kali"], attackerIp: "192.0.2.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "", linuxToolsDir: "", fieldManualPath: "/v/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "",
  });
  m.engagementGet.mockResolvedValue(E1);
  m.engagementsList.mockResolvedValue([E1]);
  m.hostsList.mockResolvedValue([H1]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([CRED]);
  m.credAttemptsList.mockResolvedValue([]);
});

describe("inline commands", () => {
  it("inline placeholder command is filled and copyable", async () => {
    const user = userEvent.setup();
    mount(note(["Try `nxc smb {TARGET_IP} --shares` first."]));
    const btn = await screen.findByRole("button", { name: "Copy command: nxc smb 192.0.2.10 --shares" });
    await navigator.clipboard.writeText("untouched");
    await user.click(btn);
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("nxc smb 192.0.2.10 --shares"));
    expect(status()).toMatchObject({ text: "Copied for zzdc01", tone: "ok" });
  });

  it("inline command masks PASS and copies it clear", async () => {
    const user = userEvent.setup();
    useCredPickStore.getState().set("h1", "c1");
    mount(note(["Try `nxc smb {TARGET_IP} -u '{USER}' -p '{PASS}'` first."]));
    const btn = await screen.findByRole("button", { name: /^Copy command: nxc smb 192\.0\.2\.10 -u/ });
    expect(btn.textContent).not.toContain("Zz-Secret1");
    expect(btn.textContent).toContain("••••");
    await user.click(btn);
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain("Zz-Secret1"));
  });

  it("single tokens stay plain code", () => {
    const { container } = mount(note(["Add `--local-auth` here."]));
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent("--local-auth");
  });

  it("an unfilled token holds the first copy back and shows the hint in warn", async () => {
    const user = userEvent.setup();
    mount(note(["Try `zzscan {ZZ_THING}` first."]));
    await navigator.clipboard.writeText("untouched");
    const btn = await screen.findByRole("button", { name: "Copy command: zzscan {ZZ_THING}" });
    await user.click(btn);
    expect(status()).toMatchObject({ text: "{ZZ_THING} not filled. Press ↵ again to copy anyway", tone: "warn" });
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.click(btn);
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("zzscan {ZZ_THING}"));
  });

  it("inline command obeys exam rules", async () => {
    m.engagementGet.mockResolvedValue({ ...E1, kind: "exam-sim" });
    const user = userEvent.setup();
    mount(note(["Never run `sqlmap -u http://{TARGET_IP}/zz` here."]));
    await navigator.clipboard.writeText("untouched");
    const btn = await screen.findByRole("button", { name: "Copy command: sqlmap -u http://192.0.2.10/zz" });
    await user.click(btn);
    expect(status()).toMatchObject({ text: "Not allowed in the exam. Press ↵ again to copy anyway", tone: "warn" });
    expect(await navigator.clipboard.readText()).toBe("untouched");
  });

  it("⌘↵ logs with the table title", async () => {
    const user = userEvent.setup();
    mount(note([
      "**Table 1 — Zz login errors**",
      "| Error | Means | Usually caused by | Do this | Card |",
      "| - | - | - | - | - |",
      "| `STATUS_ZZ_DENIED` | No right | Low user | `nxc smb {TARGET_IP} --shares` | |",
    ]));
    const btn = await screen.findByRole("button", { name: "Copy command: nxc smb 192.0.2.10 --shares" });
    act(() => btn.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      command: "nxc smb 192.0.2.10 --shares", title: "Zz login errors: STATUS_ZZ_DENIED",
    })));
    await waitFor(() => expect(status().text).toBe("Copied and logged to zzdc01"));
  });

  it("inline outside a table logs as the note and section; a block logs as the note and its title", async () => {
    const user = userEvent.setup();
    mount(note(["Try `nxc smb {TARGET_IP} --shares` first.", "```bash", "zzscan {TARGET_IP}", "```"]));
    const btn = await screen.findByRole("button", { name: "Copy command: nxc smb 192.0.2.10 --shares" });
    act(() => btn.focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ title: "Zz Tool: Shares" })));
    act(() => within(screen.getByRole("group", { name: /Note command/ })).getByRole("button", { name: /Copy command/ }).focus());
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(logCommand).toHaveBeenCalledTimes(2));
    expect(vi.mocked(logCommand).mock.calls[1]?.[1]).toMatchObject({ command: "zzscan 192.0.2.10", title: "Zz Tool: Shares" });
  });
});

describe("inline commands are memoized", () => {
  it("the same note, code and log title give the same command object; another title or note gives another", () => {
    const n = note(["Run `zzscan -t {TARGET_IP}` now."]);
    const ctx = { note: n, notes: [n], cards: [], re: null, base: {} as Ctx["base"], section: "Shares" } satisfies Ctx;
    const a = inlineOf("zzscan -t {TARGET_IP}", ctx);
    expect(inlineOf("zzscan -t {TARGET_IP}", { ...ctx })).toBe(a);
    expect(a.title).toBe("Zz Tool: Shares");
    const row = inlineOf("zzscan -t {TARGET_IP}", { ...ctx, rowTitle: "Zz codes: X" });
    expect(row).not.toBe(a);
    expect(row.title).toBe("Zz codes: X");
    const other = note(["Run `zzscan -t {TARGET_IP}` now."]);
    expect(inlineOf("zzscan -t {TARGET_IP}", { ...ctx, note: other })).not.toBe(a);
  });

  it("NoteView is memoized: the same props skip its render", () => {
    expect((NoteView as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });
});
