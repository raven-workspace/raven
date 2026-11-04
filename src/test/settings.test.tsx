import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../lib/api";
import { RavenError } from "../types/errors";

vi.mock("../lib/api");
const m = vi.mocked(api, true);
const onLocked = vi.fn();

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SettingsPage onRestored={onLocked} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14 });
  m.backupsList.mockResolvedValue([
    { file: "a.bak", reason: "daily", createdAt: 1_700_000_000_000, sizeBytes: 1_258_291 },
  ]);
});

describe("settings", () => {
  it("lists backups with human-readable size and reason chip", async () => {
    mount();
    expect(await screen.findByText("1.2 MB")).toBeInTheDocument();
    expect(screen.getByText("daily")).toBeInTheDocument();
  });

  it("saves auto-lock minutes on blur", async () => {
    const user = userEvent.setup();
    m.settingsUpdate.mockResolvedValue({ autoLockMinutes: 10, backupRetention: 14 });
    mount();
    const input = await screen.findByLabelText("Auto-lock (minutes)");
    await user.clear(input);
    await user.type(input, "10");
    await user.tab();
    expect(m.settingsUpdate).toHaveBeenCalledWith({ autoLockMinutes: 10 });
  });

  it("shows the backend field error and rejects out-of-range input", async () => {
    const user = userEvent.setup();
    m.settingsUpdate.mockRejectedValue(new RavenError("validation", "Must be 1 to 240", "autoLockMinutes"));
    mount();
    const input = await screen.findByLabelText("Auto-lock (minutes)");
    expect(input).toHaveAttribute("max", "240");
    await user.clear(input);
    await user.type(input, "5");
    await user.tab();
    expect(await screen.findByText("Must be 1 to 240")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "999");
    await user.tab();
    expect(m.settingsUpdate).toHaveBeenCalledTimes(1);
  });

  it("Back up now creates a backup", async () => {
    const user = userEvent.setup();
    m.backupNow.mockResolvedValue({ file: "b.bak", reason: "manual", createdAt: 1, sizeBytes: 10 });
    mount();
    await user.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(m.backupNow).toHaveBeenCalled();
  });

  it("Back up now shows Backing up… while pending", async () => {
    const user = userEvent.setup();
    let finish: (b: { file: string; reason: string; createdAt: number; sizeBytes: number }) => void = () => {};
    m.backupNow.mockReturnValue(new Promise((r) => (finish = r)));
    mount();
    await user.click(await screen.findByRole("button", { name: "Back up now" }));
    const btn = await screen.findByRole("button", { name: "Backing up…" });
    expect(btn).toBeDisabled();
    finish({ file: "b.bak", reason: "manual", createdAt: 1, sizeBytes: 10 });
    expect(await screen.findByRole("button", { name: "Back up now" })).toBeEnabled();
  });

  it("restore asks for confirmation then locks", async () => {
    const user = userEvent.setup();
    m.backupRestore.mockResolvedValue(null);
    mount();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Restore this backup? Raven will save a backup of the current data first, then lock. Unlock with your password to continue.",
      ),
    ).toBeInTheDocument();
    expect(m.backupRestore).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(m.backupRestore).toHaveBeenCalledWith("a.bak");
    await vi.waitFor(() => expect(onLocked).toHaveBeenCalled());
  });

  it("restore dialog names the backup by date and reason", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(new Date(1_700_000_000_000).toLocaleString())).toBeInTheDocument();
    expect(within(dialog).getByText("daily")).toBeInTheDocument();
  });

  it("a failed restore that left the backend locked moves the UI to locked", async () => {
    const user = userEvent.setup();
    m.backupRestore.mockRejectedValue(new RavenError("io", "rename failed"));
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    mount();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    await vi.waitFor(() => expect(onLocked).toHaveBeenCalled());
    expect(m.vaultStatus).toHaveBeenCalled();
  });

  it("a failed restore with the backend still unlocked shows the error", async () => {
    const user = userEvent.setup();
    m.backupRestore.mockRejectedValue(new RavenError("validation", "This backup was made with a different password", "file"));
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    mount();
    await user.click(await screen.findByRole("button", { name: "Restore" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("This backup was made with a different password")).toBeInTheDocument();
    expect(onLocked).not.toHaveBeenCalled();
  });
});
