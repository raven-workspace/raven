import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { makeQueryClient } from "../lib/queryClient";
import { RavenError } from "../types/errors";
import { SetupScreen } from "../features/vault/SetupScreen";
import { VaultGate } from "../features/vault/VaultGate";

vi.mock("../lib/api");
const m = vi.mocked(api, true);

const unlockOk = { migratedFrom: 3, migratedTo: 3, dailyBackup: null, dailyBackupError: null };

function mount() {
  const qc = makeQueryClient();
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
  m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
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

  it("a failed status check shows a calm error with Try again", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockRejectedValueOnce(new RavenError("io", "disk")).mockResolvedValue({ exists: true, unlocked: false });
    mount();
    expect(await screen.findByText("Raven couldn't check its data.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("Raven couldn't check its data.")).not.toBeInTheDocument();
  });

  it("a failed status check after setup shows Try again instead of a stuck screen", async () => {
    const user = userEvent.setup();
    m.vaultStatus
      .mockResolvedValueOnce({ exists: false, unlocked: false })
      .mockRejectedValueOnce(new RavenError("io", "disk"))
      .mockResolvedValue({ exists: true, unlocked: true });
    m.vaultCreate.mockResolvedValue(null);
    mount();
    await user.type(await screen.findByLabelText("Password"), "twelve chars long");
    await user.type(screen.getByLabelText("Confirm password"), "twelve chars long{Enter}");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("inside")).toBeInTheDocument();
  });

  it("setup screen leaves the busy state when onCreated fails", async () => {
    const user = userEvent.setup();
    m.vaultCreate.mockResolvedValue(null);
    render(<SetupScreen onCreated={() => Promise.reject(new Error("refresh failed"))} />);
    await user.type(screen.getByLabelText("Password"), "twelve chars long");
    await user.type(screen.getByLabelText("Confirm password"), "twelve chars long{Enter}");
    expect(await screen.findByText("refresh failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create password" })).toBeEnabled();
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

  it("shows Unlocking… while the unlock is pending", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
    let finish: (r: typeof unlockOk) => void = () => {};
    m.vaultUnlock.mockReturnValue(new Promise((r) => (finish = r)));
    mount();
    await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
    const btn = await screen.findByRole("button", { name: "Unlocking…" });
    expect(btn).toBeDisabled();
    await act(async () => finish(unlockOk));
    expect(await screen.findByTestId("inside")).toBeInTheDocument();
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

  it("retries a failed backend lock while the unlock screen shows", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.vaultLock.mockRejectedValueOnce(new RavenError("io", "x")).mockResolvedValue(null);
    mount();
    await screen.findByTestId("inside");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    await vi.waitFor(() => expect(m.vaultLock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Couldn't lock fully — Raven is retrying")).not.toBeInTheDocument();
  });

  it("keeps retrying and says so while the backend stays unlocked", async () => {
    const user = userEvent.setup();
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.vaultLock.mockRejectedValue(new RavenError("io", "x"));
    mount();
    await screen.findByTestId("inside");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(await screen.findByText("Couldn't lock fully — Raven is retrying")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    m.vaultLock.mockResolvedValue(null);
    await vi.waitFor(() => expect(screen.queryByText(/retrying/)).not.toBeInTheDocument(), { timeout: 4000 });
  });

  for (const [label, fire] of [
    ["visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
    ["window focus", () => window.dispatchEvent(new Event("focus"))],
  ] as const) {
    it(`locks on ${label} when the idle time passed while timers were paused (sleep)`, async () => {
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
      m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
      vi.useFakeTimers({ shouldAdvanceTime: false });
      mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId("inside")).toBeInTheDocument();
      // Wall clock jumps 8 hours (laptop closed overnight); no timer callbacks run.
      vi.setSystemTime(Date.now() + 8 * 60 * 60_000);
      act(fire);
      expect(m.vaultLock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("inside")).not.toBeInTheDocument();
    });
  }

  it("the first input after sleep locks instead of resetting the idle time", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    act(() => {
      document.dispatchEvent(new Event("pointermove", { bubbles: true }));
    });
    expect(m.vaultLock).toHaveBeenCalledTimes(1);
  });

  it("focus before the idle time does not lock", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    vi.setSystemTime(Date.now() + 29 * 60_000);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(m.vaultLock).not.toHaveBeenCalled();
  });

  it("a huge auto-lock value does not lock immediately", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 1_000_000, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
    vi.useFakeTimers();
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(m.vaultLock).not.toHaveBeenCalled();
    expect(screen.getByTestId("inside")).toBeInTheDocument();
  });

  it("auto-locks after the idle time and activity resets the timer", async () => {
    m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
    m.settingsGet.mockResolvedValue({ autoLockMinutes: 1, backupRetention: 14, machines: ["Kali (VM)", "Docker build", "Mac"] });
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

  describe("damaged database", () => {
    const older = { file: "raven-20261101-090000-daily.db", reason: "daily", createdAt: Date.UTC(2026, 10, 1, 9), sizeBytes: 10 };
    const newer = { file: "raven-20261103-090000-manual.db", reason: "manual", createdAt: Date.UTC(2026, 10, 3, 9), sizeBytes: 10 };

    async function openDamaged() {
      const user = userEvent.setup();
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
      m.vaultUnlock.mockRejectedValue(new RavenError("damaged", "the database file is damaged"));
      m.backupsList.mockResolvedValue([newer, older]);
      mount();
      await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
      expect(
        await screen.findByText("Raven can't read its database file. Restore a backup to continue."),
      ).toBeInTheDocument();
      return user;
    }

    it("damaged vault offers restore from backup", async () => {
      const user = await openDamaged();
      // The unlock form is replaced while the damaged panel is active.
      expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument();
      const options = await screen.findAllByRole("radio");
      expect(options).toHaveLength(2);
      // Newest first, with date and reason.
      expect(options[0]!.closest("label")).toHaveTextContent(new Date(newer.createdAt).toLocaleString());
      expect(options[0]!.closest("label")).toHaveTextContent("manual");
      expect(options[1]!.closest("label")).toHaveTextContent("daily");
      m.backupRestoreLocked.mockResolvedValue(null);
      await user.click(screen.getByRole("radio", { name: /daily/ }));
      await user.type(screen.getByLabelText("Password"), "backup password!{Enter}");
      expect(m.backupRestoreLocked).toHaveBeenCalledWith(older.file, "backup password!");
      expect(await screen.findByText("Restored. Unlock to continue.")).toBeInTheDocument();
      const pw = screen.getByLabelText("Password");
      expect(pw).toHaveValue("");
      expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
      expect(screen.queryByText(/can't read its database file/)).not.toBeInTheDocument();
    });

    it("restore while locked shows wrong password inline", async () => {
      const user = await openDamaged();
      m.backupRestoreLocked.mockRejectedValue(
        new RavenError("validation", "Wrong password for this backup", "password"),
      );
      await user.click(await screen.findByRole("radio", { name: /manual/ }));
      const pw = screen.getByLabelText("Password");
      await user.type(pw, "not it at all{Enter}");
      expect(await screen.findByText("Wrong password for this backup")).toBeInTheDocument();
      expect(pw).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Raven can't read its database file. Restore a backup to continue.")).toBeInTheDocument();
      expect(screen.queryByText("Restored. Unlock to continue.")).not.toBeInTheDocument();
    });

    it("preselects the newest backup", async () => {
      const user = await openDamaged();
      expect(await screen.findByRole("radio", { name: /manual/ })).toBeChecked();
      m.backupRestoreLocked.mockResolvedValue(null);
      await user.type(screen.getByLabelText("Password"), "backup password!{Enter}");
      expect(m.backupRestoreLocked).toHaveBeenCalledWith(newer.file, "backup password!");
    });

    it("focuses the restore password field", async () => {
      await openDamaged();
      await screen.findAllByRole("radio");
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });

    it("a failed backup list offers Try again", async () => {
      const user = userEvent.setup();
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
      m.vaultUnlock.mockRejectedValue(new RavenError("damaged", "the database file is damaged"));
      m.backupsList.mockRejectedValueOnce(new RavenError("io", "backups unreadable")).mockResolvedValue([newer]);
      mount();
      await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
      expect(await screen.findByText("backups unreadable")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("radio", { name: /manual/ })).toBeChecked();
      expect(screen.queryByText("backups unreadable")).not.toBeInTheDocument();
      expect(m.backupsList).toHaveBeenCalledTimes(2);
    });

    it("says so when there are no backups", async () => {
      const user = userEvent.setup();
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: false });
      m.vaultUnlock.mockRejectedValue(new RavenError("damaged", "the database file is damaged"));
      m.backupsList.mockResolvedValue([]);
      mount();
      await user.type(await screen.findByLabelText("Password"), "correct horse battery{Enter}");
      expect(await screen.findByText("No backups yet")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    });
  });

  describe("any locked error", () => {
    function Probe() {
      const list = useQuery({ queryKey: ["engagements"], queryFn: api.engagementsList });
      const create = useMutation({ mutationFn: () => api.engagementCreate({} as never) });
      return (
        <div data-testid="inside">
          {list.isError ? "list failed" : "ok"}
          <button onClick={() => create.mutate()}>make</button>
        </div>
      );
    }
    function mountProbe() {
      return render(
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter>
            <VaultGate>
              <Probe />
            </VaultGate>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    it("moves the UI to the unlock screen from a rejected query", async () => {
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
      m.engagementsList.mockRejectedValue(new RavenError("locked", "vault is locked"));
      mountProbe();
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
      expect(screen.queryByTestId("inside")).not.toBeInTheDocument();
    });

    it("moves the UI to the unlock screen from a rejected mutation", async () => {
      const user = userEvent.setup();
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
      m.engagementsList.mockResolvedValue([]);
      m.engagementCreate.mockRejectedValue(new RavenError("locked", "vault is locked"));
      mountProbe();
      await user.click(await screen.findByRole("button", { name: "make" }));
      expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    });

    it("ignores other errors", async () => {
      m.vaultStatus.mockResolvedValue({ exists: true, unlocked: true });
      m.engagementsList.mockRejectedValue(new RavenError("io", "disk"));
      mountProbe();
      expect(await screen.findByText("list failed")).toBeInTheDocument();
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });
  });
});
