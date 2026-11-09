import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setImported, type CardMeta } from "../engines/library/store";
import type { LibraryCommand } from "../engines/library/types";
import { useArsenalStore } from "../features/arsenal/useArsenalStore";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useNotesStore } from "../features/notes/useNotesStore";
import { usePaletteStore } from "../features/palette/usePaletteStore";
import { useLastEngagementStore } from "../features/arsenal/useFillScope";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Credential } from "../types/credentials";
import { guardCopy, useCopyGuard } from "../features/arsenal/copyGuard";

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
const H1: Host = {
  id: "h1", engagementId: "e1", name: "dc01", ip: "10.10.10.5", os: "windows", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};

const cmd = (id: string, over: Partial<LibraryCommand>): LibraryCommand => ({
  id, title: id, tool: "zz", template: "zz", os: "any", runFrom: "attacker", goals: [], source: "field-manual", cardId: "zz-card", ...over,
});
const PROBE = cmd("zz-probe", { title: "Zzprobe the target", template: "zzprobe {TARGET_IP} from {LHOST}" });
const FETCH = cmd("zz-fetch", { title: "Zzfetch the file", template: "zzfetch http://{LHOST}/{FILE}", runFrom: "target", os: "windows" });
const PASSCMD = cmd("zz-pass", { title: "Zzpass login", template: "zzpass -p {PASS}", cardId: undefined, source: "raven" });
const CARD: CardMeta = { id: "zz-card", title: "Zz Card", stage: "initial-foothold", category: "Zz-Cat", os: "any", file: "02-Cards/Zz/Zz-Card.md" };
const HASHCRED: Credential = {
  id: "c1", engagementId: "e1", type: "hash", username: "admin", domain: null, secret: "8846f7eaee8fb117ad06bdd830b7586c", hashType: "NTLM",
  scope: "domain", localHostId: null, sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null,
  createdAt: 1, updatedAt: 1,
};
const cmdK = "{Meta>}k{/Meta}";

const nav: { go: (path: string) => void } = { go: () => {} };
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    nav.go = (p) => void navigate(p);
  }, [navigate]);
  return null;
}

function mount(path: string, engagement = E1) {
  m.engagementGet.mockResolvedValue(engagement);
  m.engagementsList.mockResolvedValue([engagement]);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Nav />
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
  useArsenalStore.setState({ open: false, cardId: null });
  useNotesStore.setState({ open: false });
  setImported({ commands: [PROBE, FETCH, PASSCMD], cards: [CARD] });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "10.10.14.9", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false,
  });
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockResolvedValue([H1]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
});
afterEach(() => setImported({ commands: [], cards: [] }));

describe("guardCopy", () => {
  it("unresolved → focus first token; same command again → copy", () => {
    expect(guardCopy({ id: "a", unresolved: ["LHOST", "PORT"] }, null)).toEqual({ action: "focus", token: "LHOST" });
    expect(guardCopy({ id: "a", unresolved: ["LHOST", "PORT"] }, { id: "a", key: "a|LHOST,PORT" })).toEqual({ action: "copy" });
    expect(guardCopy({ id: "a", unresolved: [] }, null)).toEqual({ action: "copy" });
  });
  it("arm resets when the command or its unresolved set changes", () => {
    expect(guardCopy({ id: "a", unresolved: ["PORT"] }, { id: "a", key: "a|LHOST,PORT" }).action).toBe("focus");
    expect(guardCopy({ id: "b", unresolved: ["LHOST"] }, { id: "a", key: "a|LHOST" }).action).toBe("focus");
  });
});

describe("useCopyGuard", () => {
  const filled = (unresolved: string[], id = "a") => ({ id, unresolved }) as never;
  function setup(repeatKey?: string) {
    const focusToken = vi.fn();
    const focusCred = vi.fn();
    const hook = renderHook(() => useCopyGuard({ focusToken, focusCred, hostName: null, ...(repeatKey ? { repeatKey } : {}) }));
    return { focusToken, focusCred, ...hook };
  }
  it("hint names the repeat key", async () => {
    const { result } = setup("⌘↵ or Copy");
    await act(() => result.current.attempt(filled(["LHOST"]), async () => {}));
    expect(result.current.hint).toBe("{LHOST} not filled. Press ⌘↵ or Copy again to copy anyway");
  });
  it("warn holds the first copy back", async () => {
    const { result } = setup();
    const doCopy = vi.fn(async () => {});
    const opts = { warn: "Metasploit is locked to dc01" };
    expect(await act(() => result.current.attempt(filled([]), doCopy, opts))).toBe("guarded");
    expect(result.current.hint).toBe("Metasploit is locked to dc01. Press ↵ again to copy anyway");
    expect(doCopy).not.toHaveBeenCalled();
    expect(await act(() => result.current.attempt(filled([]), doCopy, opts))).toBe("copied");
    expect(doCopy).toHaveBeenCalledTimes(1);
  });
  it("a different warnKey re-arms", async () => {
    const { result } = setup();
    const doCopy = vi.fn(async () => {});
    await act(() => result.current.attempt(filled([]), doCopy, { warn: "w", warnKey: "a" }));
    expect(await act(() => result.current.attempt(filled([]), doCopy, { warn: "w", warnKey: "b" }))).toBe("guarded");
    expect(doCopy).not.toHaveBeenCalled();
  });
  it("sends USER and DOMAIN to their field, and PASS, HASH and CRED to the credential chip", async () => {
    const { result, focusToken, focusCred } = setup();
    for (const t of ["USER", "DOMAIN"]) await act(() => result.current.attempt(filled([t]), async () => {}));
    expect(focusToken.mock.calls).toEqual([["USER"], ["DOMAIN"]]);
    for (const t of ["PASS", "HASH", "CRED"]) await act(() => result.current.attempt(filled([t]), async () => {}));
    expect(focusCred).toHaveBeenCalledTimes(3);
  });
  it("reset() drops the arm: the next try is held back again", async () => {
    const { result } = setup();
    const doCopy = vi.fn(async () => {});
    await act(() => result.current.attempt(filled(["LHOST"]), doCopy));
    act(() => result.current.reset());
    expect(await act(() => result.current.attempt(filled(["LHOST"]), doCopy))).toBe("guarded");
    expect(await act(() => result.current.attempt(filled(["LHOST"]), doCopy))).toBe("copied");
    expect(doCopy).toHaveBeenCalledTimes(1);
  });
});

describe("copy guard in the app", () => {
  it("hash-only credential guards PASS on the chip", async () => {
    m.credentialsList.mockResolvedValue([HASHCRED]);
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await navigator.clipboard.writeText("untouched");
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzpass");
    await user.keyboard("{Enter}");
    const chip = await screen.findByRole("button", { name: /^Fill with credential/ });
    expect(chip).toHaveFocus();
    expect(screen.queryByRole("listbox", { name: "Fill with credential" })).not.toBeInTheDocument();
    expect(await screen.findByText("{PASS} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.queryByRole("combobox", { name: "Search" })).not.toBeInTheDocument());
    expect(await navigator.clipboard.readText()).toBe("zzpass -p {PASS}");
  });

  it("Copy button in a card guards too and confirms with the host", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await navigator.clipboard.writeText("untouched");
    act(() => useArsenalStore.getState().openCard("zz-card"));
    const d = within(await screen.findByRole("complementary", { name: "Arsenal" }));
    await d.findByText("Zz Card");
    await user.click(await d.findByRole("button", { name: "Copy command: Zzprobe the target" }));
    expect(await d.findByRole("status")).toHaveTextContent("Copied for dc01");
    expect(await navigator.clipboard.readText()).toBe("zzprobe 10.10.10.5 from 10.10.14.9");

    await navigator.clipboard.writeText("untouched");
    const fetchBtn = d.getByRole("button", { name: "Copy command: Zzfetch the file" });
    await user.click(fetchBtn);
    expect(await d.findByText("{FILE} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: "Value for FILE" })).toHaveFocus();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.click(fetchBtn);
    const status = await d.findByText("Copied for dc01. 1 placeholder left");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveClass("text-warn");
    expect(await navigator.clipboard.readText()).toBe("zzfetch http://10.10.14.9/{FILE}");
  });

  it("a checklist row with no field to focus keeps focus on Copy, and Enter copies anyway", async () => {
    const user = userEvent.setup();
    setImported({ commands: [{ ...PROBE, id: "zz-row", title: "Zzrow user", template: "zzrow {USER}", goals: ["h-enum-full-tcp"], cardId: undefined }], cards: [] });
    mount("/e/e1/h/h1");
    await user.click(await screen.findByRole("button", { name: "Full checklist" }));
    await navigator.clipboard.writeText("untouched");
    const btn = await screen.findByRole("button", { name: "Copy command: Zzrow user" });
    await user.click(btn);
    expect(await screen.findByText("{USER} not filled. Press ↵ again to copy anyway")).toBeInTheDocument();
    expect(btn).toHaveFocus();
    expect(await navigator.clipboard.readText()).toBe("untouched");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/^Copied for dc01. 1 placeholder left/)).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("zzrow {USER}");
  });

  it("⌘K preview marks unresolved tokens amber", async () => {
    const user = userEvent.setup();
    mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard(cmdK);
    await user.type(await screen.findByRole("combobox", { name: "Search" }), "zzfetch");
    const marks = await screen.findAllByText("{FILE}");
    const mark = marks.find((el) => el.tagName === "MARK");
    expect(mark).toHaveClass("text-warn");
  });
});
