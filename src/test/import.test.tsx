import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)"], attackerIp: "", listenerPort: "" });
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
    expect(await screen.findByText("1 added · 0 already present")).toBeInTheDocument();
    expect(screen.getByText("1 added · 2 already present · 3 merged into existing")).toBeInTheDocument();
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
    expect(await screen.findByText("1 added · 0 already present")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Solo", pressed: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select Solo" }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("0 added · 1 already present")).toBeInTheDocument();
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
});
