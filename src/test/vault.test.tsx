import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { RavenError } from "../types/errors";
import { VaultGate } from "../features/vault/VaultGate";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const unlockOk = { migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null };

function mount() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VaultGate>
          <div data-testid="inside">inside</div>
        </VaultGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14 });
  m.vaultLock.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe("vault gate", () => {
  it("shows setup when no vault", async () => {
    m.vaultStatus.mockResolvedValue({ exists: false, unlocked: false });
    mount();
    expect(await screen.findByText("Create your Raven password")).toBeInTheDocument();
    expect(screen.getByText(/can't be recovered/)).toBeInTheDocument();
  });

  it("shows unlock when locked", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    mount();
    const input = await screen.findByLabelText("Password");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
  });

  it("wrong password shows inline error", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    m.vaultUnlock.mockRejectedValue(new RavenError("wrong_password", "bad"));
    mount();
    const input = await screen.findByLabelText("Password");
    await user.type(input, "nope{Enter}");
    expect(await screen.findByText("Wrong password")).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("unlocks on Enter and shows migration notice", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    m.vaultUnlock.mockResolvedValue({ ...unlockOk, migratedFrom: 2, migratedTo: 3 });
    mount();
    await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
    expect(await screen.findByTestId("inside")).toBeInTheDocument();
    expect(screen.getByText("Updated Raven's data (backup saved)")).toBeInTheDocument();
  });

  it("setup enforces 12 chars and matching confirmation", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValueOnce({ exists: false, unlocked: false });
    m.vaultCreate.mockResolvedValue(null);
    mount();
    const pw = await screen.findByLabelText("Password");
    const confirm = screen.getByLabelText("Confirm password");
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    await user.type(pw, "short");
    await user.type(confirm, "short{Enter}");
    expect(m.vaultCreate).not.toHaveBeenCalled();
    await user.clear(pw);
    await user.clear(confirm);
    await user.type(pw, "twelve chars long");
    await user.type(confirm, "twelve chars lonx{Enter}");
    expect(m.vaultCreate).not.toHaveBeenCalled();
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    await user.clear(confirm);
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    await user.type(confirm, "twelve chars long{Enter}");
    expect(m.vaultCreate).toHaveBeenCalledWith("twelve chars long");
    expect(await screen.findByTestId("inside")).toBeInTheDocument();
  });

  it("shows the daily backup failure as a muted line", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    m.vaultUnlock.mockResolvedValue({ ...unlockOk, dailyBackupError: "disk full" });
    mount();
    await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
    expect(await screen.findByText("Daily backup failed: disk full")).toBeInTheDocument();
    expect(screen.getByTestId("inside")).toBeInTheDocument();
  });

  it("cmd+L locks", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    mount();
    await screen.findByTestId("inside");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(m.vaultLock).toHaveBeenCalled();
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByTestId("inside")).not.toBeInTheDocument();
  });

  it("auto-locks after the idle time and activity resets the timer", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 1, backupRetention: 14 });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("inside")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000);
    });
    expect(m.vaultLock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(m.vaultLock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // locked: no further lock calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(m.vaultLock).toHaveBeenCalledTimes(1);
  });
});

