import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../../App";
import { tabsStorageKey } from "../../../engines/tabs";
import { setImported } from "../../../engines/library/store";
import { useArsenalStore } from "../../../features/arsenal/useArsenalStore";
import { useLastEngagementStore } from "../../../features/arsenal/useFillScope";
import { useCaptureStore } from "../../../features/capture/useCaptureStore";
import { resetNotesStore } from "../../../features/notes/useNotesStore";
import { usePaletteStore } from "../../../features/palette/usePaletteStore";
import { usePayloadsStore } from "../../../features/payloads/usePayloadsStore";
import { useEditorTabsStore } from "../../../features/workspace/useEditorTabsStore";
import { useTargetStore } from "../../../features/workspace/useTargetStore";
import { api } from "../../../lib/api";
import { makeQueryClient } from "../../../lib/queryClient";
import type { Engagement } from "../../../types/engagement";
import type { Finding } from "../../../types/findings";
import type { Host } from "../../../types/host";

vi.mock("../../../lib/api");
// The workspace shell, as `npm run tauri:overhaul` runs it.
vi.mock("../../../lib/shell", () => ({ WORKSPACE_SHELL: true, readWorkspaceShell: () => true }));
const m = vi.mocked(api, true);

// Synthetic fixtures only (RFC 5737 addresses, invented names).
const E1: Engagement = {
  id: "e1", name: "Lab Zz", kind: "lab", client: null, subLabel: null, scopeCidrs: ["198.51.100.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const E2: Engagement = { ...E1, id: "e2", name: "Lab Yy" };
const host = (id: string, name: string, ip: string): Host => ({
  id, engagementId: "e1", name, ip, os: null, boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
});
const WEB = host("h1", "zzweb01", "198.51.100.21");
const DB = host("h2", "zzdb02", "198.51.100.22");
const FINDING: Finding = {
  id: "f1", engagementId: "e1", title: "Zz upload fetch SSRF", severity: "high", cvssVector: null, cvssScore: null, status: "draft",
  description: "", impact: "", remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: ["h1"], serviceIds: [], stepEntryIds: [],
  createdAt: 1, updatedAt: 1,
};

const nav: { to: NavigateFunction; path: string } = { to: () => undefined, path: "" };
function GrabRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    nav.to = navigate;
    nav.path = `${location.pathname}${location.search}`;
  });
  return null;
}

/** Renders the app at `path` and waits for the shell (the vault answers first), so later moves start from there. */
async function mount(path: string) {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <GrabRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Search hosts, notes and commands" });
}

const go = (to: string) => act(() => void nav.to(to));
const tablist = () => screen.findByRole("tablist", { name: "Open editors" });
/** The open tabs' labels, in order, with the selected one marked. */
async function tabs(): Promise<string[]> {
  return within(await tablist()).getAllByRole("tab").map((t) => (t.getAttribute("aria-selected") === "true" ? `[${t.textContent}]` : t.textContent ?? ""));
}
const stored = () => JSON.parse(localStorage.getItem(tabsStorageKey("e1")) ?? "null");

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useEditorTabsStore.getState().reset();
  useTargetStore.getState().reset();
  useCaptureStore.getState().reset();
  usePaletteStore.getState().close();
  useLastEngagementStore.setState({ engagementId: null, hostId: null });
  useArsenalStore.setState({ open: false, cardId: null, blockId: null, solo: null, lastRead: null });
  usePayloadsStore.setState({ open: false, generator: "shell", overrides: {}, lhost: null, listenerPick: {} });
  resetNotesStore();
  setImported({ commands: [], cards: [] });
  m.settingsGet.mockResolvedValue({
    autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "192.0.2.10", listenerPort: "4444", kaliUser: "kali",
    windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [],
  });
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.engagementGet.mockImplementation(async (id) => (id === "e2" ? E2 : E1));
  m.engagementsList.mockResolvedValue([E1, E2]);
  m.engagementsProgress.mockResolvedValue({});
  m.hostsList.mockImplementation(async (id) => (id === "e1" ? [WEB, DB] : []));
  m.hostIdentityGet.mockResolvedValue(null);
  m.vectorsList.mockResolvedValue([]);
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.logList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.checklistPut.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.usernamesList.mockResolvedValue([]);
  m.accessGrantsList.mockResolvedValue([]);
  m.payloadBuildsList.mockResolvedValue([]);
  m.findingsList.mockImplementation(async (id) => (id === "e1" ? [FINDING] : []));
  m.notesList.mockResolvedValue([]);
  m.notesGet.mockImplementation(async (engagementId, hostId) => ({
    ownerId: hostId ?? engagementId, engagementId, hostId, body: "", private: false, createdAt: 1, updatedAt: 1,
  }));
  m.ruledOutList.mockResolvedValue([]);
});

describe("editor tabs", () => {
  it("opens each page in a tab, labelled from the vault, and focuses a page's tab rather than opening it twice", async () => {
    await mount("/e/e1/h/h1");
    await waitFor(async () => expect(await tabs()).toEqual(["[zzweb01]"]));
    await go("/e/e1/s/log");
    await go("/e/e1/notes/h1");
    await go("/e/e1/notes");
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "Log", "Notes: zzweb01", "[Notes: Lab Zz]"]));
    await go("/e/e1/h/h1");
    expect(await tabs()).toEqual(["[zzweb01]", "Log", "Notes: zzweb01", "Notes: Lab Zz"]);
  });

  it("shows a tab's page at the route it was last on, from a click or the arrow keys", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/s/log");
    await go("/e/e1/h/h1");
    await waitFor(async () => expect(await tabs()).toEqual(["Log", "[zzweb01]"]));
    await user.click(within(await tablist()).getByRole("tab", { name: "Log" }));
    expect(nav.path).toBe("/e/e1/s/log");
    expect(await tabs()).toEqual(["[Log]", "zzweb01"]);
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(nav.path).toBe("/e/e1/h/h1"));
    expect(within(await tablist()).getByRole("tab", { name: "zzweb01" })).toHaveAttribute("tabindex", "0");
  });

  it("⌘W closes the tab in view and shows the one to its right, else its left", async () => {
    const user = userEvent.setup();
    await mount("/e/e1");
    await go("/e/e1/h/h1");
    await go("/e/e1/s/log");
    await go("/e/e1/h/h1");
    await waitFor(async () => expect(await tabs()).toEqual(["Board", "[zzweb01]", "Log"]));
    await user.keyboard("{Meta>}w{/Meta}");
    await waitFor(async () => expect(await tabs()).toEqual(["Board", "[Log]"]));
    expect(nav.path).toBe("/e/e1/s/log");
    await user.keyboard("{Meta>}w{/Meta}");
    await waitFor(async () => expect(await tabs()).toEqual(["[Board]"]));
  });

  it("a tab's close button closes that tab; closing the last one leaves the board", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await go("/e/e1/s/log");
    await waitFor(async () => expect(await tabs()).toEqual(["zzweb01", "[Log]"]));
    const list = await tablist();
    const closeOf = (name: string) => within(within(list).getByRole("tab", { name }).parentElement!).getByRole("button", { name: "Close tab" });
    await user.click(closeOf("zzweb01"));
    expect(await tabs()).toEqual(["[Log]"]);
    expect(nav.path).toBe("/e/e1/s/log");
    await user.click(closeOf("Log"));
    await waitFor(async () => expect(await tabs()).toEqual(["[Board]"]));
    expect(nav.path).toBe("/e/e1");
  });

  it("each engagement remembers its tabs, storing route ids only, and restores them on return", async () => {
    await mount("/e/e1/h/h1");
    await go("/e/e1/f/f1");
    await go("/e/e1/notes/h2");
    await go("/e/e1/h/h1");
    await waitFor(async () => expect(await tabs()).toEqual(["[zzweb01]", "Zz upload fetch SSRF", "Notes: zzdb02"]));
    expect(stored()).toEqual({ v: 1, tabs: ["/e/e1/h/h1", "/e/e1/f/f1", "/e/e1/notes/h2"], active: "/e/e1/h/h1" });
    // No name from the vault is on disk.
    expect(localStorage.getItem(tabsStorageKey("e1"))).not.toMatch(/zz|Lab/i);

    // Another engagement has its own tabs; coming back to this one's home shows the tab that was in view.
    await go("/e/e2");
    await waitFor(async () => expect(await tabs()).toEqual(["[Board]"]));
    await go("/");
    await go("/e/e1");
    await waitFor(() => expect(nav.path).toBe("/e/e1/h/h1"));
    expect(await tabs()).toEqual(["[zzweb01]", "Zz upload fetch SSRF", "Notes: zzdb02"]);
  });

  it("restores stored tabs after a fresh start, dropping pages that are gone", async () => {
    localStorage.setItem(tabsStorageKey("e1"), JSON.stringify({ v: 1, tabs: ["/e/e1/h/h9", "/e/e1/notes/h2", "/e/e1/s/log"], active: "/e/e1/notes/h2" }));
    await mount("/e/e1");
    await waitFor(() => expect(nav.path).toBe("/e/e1/notes/h2"));
    // h9 is not in the vault: its tab goes once the hosts have loaded.
    await waitFor(async () => expect(await tabs()).toEqual(["[Notes: zzdb02]", "Log"]));
    expect(stored().tabs).toEqual(["/e/e1/notes/h2", "/e/e1/s/log"]);
  });

  it("a deep link keeps its own page and joins the restored tabs", async () => {
    localStorage.setItem(tabsStorageKey("e1"), JSON.stringify({ v: 1, tabs: ["/e/e1/s/log"], active: "/e/e1/s/log" }));
    await mount("/e/e1/h/h2");
    await waitFor(async () => expect(await tabs()).toEqual(["Log", "[zzdb02]"]));
    expect(nav.path).toBe("/e/e1/h/h2");
  });

  it("a stored value that can't be read gives a fresh start", async () => {
    localStorage.setItem(tabsStorageKey("e1"), "{not json");
    await mount("/e/e1");
    await waitFor(async () => expect(await tabs()).toEqual(["[Board]"]));
  });
});

describe("drawers become tabs", () => {
  it("A, P and N open Arsenal, Payloads and the host's notes as tabs; no drawer opens", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("a");
    await screen.findByRole("main", { name: "Arsenal" });
    await go("/e/e1/h/h1");
    await user.keyboard("p");
    await screen.findByRole("main", { name: "Payloads" });
    await go("/e/e1/h/h1");
    await screen.findByRole("tab", { name: "Next" });
    await user.keyboard("n");
    await screen.findByRole("region", { name: "Notes: zzweb01" });
    expect(await tabs()).toEqual(["zzweb01", "Arsenal", "Payloads", "[Notes: zzweb01]"]);
    for (const name of ["Arsenal", "Payloads", /^Notes/]) expect(screen.queryByRole("complementary", { name })).toBeNull();
  });

  it("an opener of the old drawer (a card link, ⌘K's generator) opens the tab instead", async () => {
    await mount("/e/e1/s/log");
    await tablist();
    act(() => usePayloadsStore.getState().show("sql"));
    await screen.findByRole("main", { name: "Payloads" });
    expect(nav.path).toBe("/e/e1/payloads?generator=sql");
    expect(usePayloadsStore.getState().open).toBe(false);
    act(() => useArsenalStore.getState().openCard());
    await screen.findByRole("main", { name: "Arsenal" });
    expect(useArsenalStore.getState().open).toBe(false);
    expect(await tabs()).toEqual(["Log", "Payloads", "[Arsenal]"]);
  });

  it("A on the Arsenal tab focuses its search; from another page it returns to the tab where it was left", async () => {
    const user = userEvent.setup();
    await mount("/e/e1/arsenal?q=zz");
    await screen.findByRole("main", { name: "Arsenal" });
    await go("/e/e1/s/log");
    await user.keyboard("a");
    await waitFor(() => expect(nav.path).toBe("/e/e1/arsenal?q=zz"));
    await user.keyboard("a");
    expect(document.activeElement).toHaveAttribute("id", "arsenal-search");
  });

  it("from the Dashboard the Arsenal is a full page with no tabs", async () => {
    const user = userEvent.setup();
    await mount("/");
    await screen.findByRole("button", { name: "Search hosts, notes and commands" });
    await user.keyboard("a");
    await screen.findByRole("main", { name: "Arsenal" });
    expect(nav.path).toBe("/arsenal");
    expect(screen.queryByRole("tablist", { name: "Open editors" })).toBeNull();
  });
});

describe("forgetting tabs", () => {
  it("a deleted engagement's tabs leave memory and disk", () => {
    localStorage.setItem(tabsStorageKey("e1"), JSON.stringify({ v: 1, tabs: ["/e/e1/s/log"], active: null }));
    useEditorTabsStore.getState().restore("e1");
    useEditorTabsStore.getState().forget("e1");
    expect(localStorage.getItem(tabsStorageKey("e1"))).toBeNull();
    expect(useEditorTabsStore.getState().byEngagement.e1).toBeUndefined();
  });
});
