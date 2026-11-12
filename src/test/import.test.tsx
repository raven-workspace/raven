import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../lib/api";
import type { ImportCount, ImportSummary } from "../types/import";
import { backupV3, encryptedEnvelope, standalone, toText } from "./engines/import/fixtures";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const zero: ImportCount = { added: 0, present: 0, merged: 0 };
const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  engagements: zero, hosts: zero, services: zero, logEntries: zero, notes: zero, checklist: zero, tunnels: zero,
  hops: zero, findings: zero, credentials: zero, usernames: zero, accessGrants: zero, credAttempts: zero, ...over,
});

/** The summary row for one record type: its Added, Already present and Merged counts. */
const counts = (label: string) =>
  within(screen.getByRole("row", { name: new RegExp(`^${label}\\b`) }))
    .getAllByRole("cell")
    .map((c) => c.textContent);

let qc: QueryClient;
function mount() {
  qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPage onRestored={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function choose(user: ReturnType<typeof userEvent.setup>, content: unknown) {
  const file = new File([typeof content === "string" ? content : toText(content)], "backup.json", { type: "application/json" });
  await user.upload(await screen.findByTestId("import-file"), file);
}

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "", kaliUser: "kali", windowsToolsDir: "~/tools/windows", linuxToolsDir: "~/tools/linux", fieldManualPath: "~/fm", nvdKeySet: false, reportName: "", reportEmail: "", reportOsid: "", reportMethodology: "" });
  m.backupsList.mockResolvedValue([]);
});

describe("settings import", () => {
  it("an encrypted file shows the export-unencrypted message", async () => {
    const user = userEvent.setup();
    mount();
    await choose(user, encryptedEnvelope());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This backup is encrypted. Export an unencrypted backup from old Raven and import that.",
    );
  });

  it("the picker starts with nothing selected and Import disabled", async () => {
    const user = userEvent.setup();
    mount();
    await choose(user, await backupV3());
    expect(await screen.findByText("Solo")).toBeInTheDocument();
    expect(screen.getByText("Lab One")).toBeInTheDocument();
    expect(screen.queryByText("Catalog Box")).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Select Solo" }));
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("importing a selected standalone calls import_apply with its plan and shows the summary", async () => {
    const user = userEvent.setup();
    m.importApply.mockResolvedValue(
      summary({ engagements: { added: 1, present: 0, merged: 0 }, hosts: { added: 1, present: 2, merged: 3 }, logEntries: zero }),
    );
    mount();
    const inv = vi.spyOn(qc, "invalidateQueries");
    await choose(user, await backupV3());
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(m.importApply).toHaveBeenCalledTimes(1));
    const plan = m.importApply.mock.calls[0]![0];
    expect(plan.engagements.map((e) => e.id)).toEqual(["custom-solo-1#e"]);
    await screen.findByLabelText("Import summary");
    expect(counts("Engagements")).toEqual(["1", "0", "0"]);
    expect(counts("Hosts")).toEqual(["1", "2", "3"]);
    expect(screen.queryByText(/Usernames/)).toBeNull();
    expect(inv).toHaveBeenCalledWith();
  });

  it("the summary lists skipped redacted credentials", async () => {
    const user = userEvent.setup();
    m.importApply.mockResolvedValue(summary());
    mount();
    await choose(
      user,
      await backupV3({
        machines: [standalone({ id: "custom-solo-1", name: "Solo" })],
        credentials: [{ id: "c1", type: "password", username: "alice", secret: "[REDACTED]", createdAt: "2024-01-01T00:00:00.000Z", engagementId: "custom-solo-1" }],
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(/Redacted credentials/)).toBeInTheDocument();
  });

  it("a second import shows everything already present", async () => {
    const user = userEvent.setup();
    m.importApply.mockResolvedValueOnce(summary({ engagements: { added: 1, present: 0, merged: 0 } }));
    m.importApply.mockResolvedValueOnce(summary({ engagements: { added: 0, present: 1, merged: 0 } }));
    mount();
    await choose(user, await backupV3());
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByLabelText("Import summary");
    expect(counts("Engagements")).toEqual(["1", "0", "0"]);
    expect(screen.getByRole("button", { name: "Select Solo", pressed: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(counts("Engagements")).toEqual(["0", "1", "0"]));
    expect(m.importApply).toHaveBeenCalledTimes(2);
  });

  it("an import_apply error shows in an alert and re-enables Import", async () => {
    const user = userEvent.setup();
    m.importApply.mockRejectedValue(new Error("boom"));
    mount();
    await choose(user, await backupV3());
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("a failed import still refreshes the backups list (the pre-import backup exists)", async () => {
    const user = userEvent.setup();
    m.importApply.mockRejectedValue(new Error("boom"));
    mount();
    const inv = vi.spyOn(qc, "invalidateQueries");
    await choose(user, await backupV3());
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(inv).toHaveBeenCalledWith({ queryKey: ["backups"] }));
  });

  it("log counts read as entry / entries", async () => {
    const user = userEvent.setup();
    mount();
    await choose(
      user,
      await backupV3({
        machines: [
          standalone({ id: "custom-one", name: "One", logEntries: [{ id: "l1", at: 1, blocks: [] }] as never }),
          standalone({ id: "custom-two", name: "Two", ip: "10.10.10.6", logEntries: [{ id: "l1", at: 1, blocks: [] }, { id: "l2", at: 2, blocks: [] }] as never }),
        ],
      }),
    );
    expect(await screen.findByText("1 log entry")).toBeInTheDocument();
    expect(screen.getByText("2 log entries")).toBeInTheDocument();
    expect(screen.getAllByText("1 host")).toHaveLength(2);
  });

  it("choosing a new file resets the selection, the summary and any error", async () => {
    const user = userEvent.setup();
    m.importApply.mockResolvedValueOnce(summary({ engagements: { added: 1, present: 0, merged: 0 } }));
    m.importApply.mockRejectedValueOnce(new Error("boom"));
    mount();
    await choose(user, await backupV3());
    await user.click(await screen.findByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByLabelText("Import summary");
    expect(counts("Engagements")).toEqual(["1", "0", "0"]);
    await user.click(screen.getByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Select Lab One" }));
    await choose(user, await backupV3());
    expect(await screen.findByText("Solo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Import summary")).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    // An import error is cleared by the next file too.
    await user.click(screen.getByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    await choose(user, await backupV3());
    await screen.findByText("Solo");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a read error clears an earlier picker", async () => {
    const user = userEvent.setup();
    mount();
    await choose(user, await backupV3());
    expect(await screen.findByText("Solo")).toBeInTheDocument();
    await choose(user, encryptedEnvelope());
    expect(await screen.findByRole("alert")).toHaveTextContent("This backup is encrypted.");
    expect(screen.queryByText("Solo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
  });

  it("a file that cannot be read shows an error instead of failing silently", async () => {
    const user = userEvent.setup();
    mount();
    await choose(user, await backupV3());
    await screen.findByText("Solo");
    const file = new File(["x"], "broken.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.reject(new Error("disk went away")) });
    await user.upload(screen.getByTestId("import-file"), file);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk went away");
    expect(screen.queryByText("Solo")).toBeNull();
  });

  it("the last chosen file wins when an earlier read finishes late", async () => {
    const user = userEvent.setup();
    mount();
    let release!: (text: string) => void;
    const slow = new File(["x"], "slow.json", { type: "application/json" });
    Object.defineProperty(slow, "text", { value: () => new Promise<string>((r) => (release = r)) });
    await user.upload(await screen.findByTestId("import-file"), slow);
    await choose(user, await backupV3({ machines: [standalone({ id: "custom-new", name: "Newer" })] }));
    expect(await screen.findByText("Newer")).toBeInTheDocument();
    release(toText(await backupV3({ machines: [standalone({ id: "custom-old", name: "Older" })] })));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Newer")).toBeInTheDocument();
    expect(screen.queryByText("Older")).toBeNull();
    expect(screen.getByText("backup.json")).toBeInTheDocument();
  });
});
