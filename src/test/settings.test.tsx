import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { api } from "../lib/api";

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

  it("Back up now creates a backup", async () => {
    const user = userEvent.setup();
    m.backupNow.mockResolvedValue({ file: "b.bak", reason: "manual", createdAt: 1, sizeBytes: 10 });
    mount();
    await user.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(m.backupNow).toHaveBeenCalled();
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
});
