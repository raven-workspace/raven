import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { api } from "../lib/api";
import { RavenError } from "../types/errors";

describe("api", () => {
  beforeEach(() => invoke.mockReset());

  it("maps rejection to RavenError", async () => {
    invoke.mockRejectedValueOnce({ code: "wrong_password", message: "x" });
    const err = await api.vaultUnlock("p").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RavenError);
    expect(err).toBeInstanceOf(Error);
    expect((err as RavenError).code).toBe("wrong_password");
    expect((err as RavenError).message).toBe("x");
    expect(invoke).toHaveBeenCalledWith("vault_unlock", { password: "p" });
  });

  it("keeps the field of a validation error", async () => {
    invoke.mockRejectedValueOnce({ code: "validation", message: "bad cidr", field: "scopeCidrs" });
    const err = (await api.engagementCreate({ name: "x", kind: "lab" }).catch((e: unknown) => e)) as RavenError;
    expect(err.code).toBe("validation");
    expect(err.field).toBe("scopeCidrs");
  });

  it("wraps non-AppError rejections as io errors", async () => {
    invoke.mockRejectedValueOnce("boom");
    const err = (await api.vaultStatus().catch((e: unknown) => e)) as RavenError;
    expect(err).toBeInstanceOf(RavenError);
    expect(err.code).toBe("io");
    expect(err.message).toBe("boom");
  });

  it("passes camelCase args to snake_case commands", async () => {
    invoke.mockResolvedValue(null);
    await api.engagementUpdate("e1", { name: "n", kind: "client" });
    expect(invoke).toHaveBeenCalledWith("engagement_update", { id: "e1", input: { name: "n", kind: "client" } });
    await api.engagementSetStatus("e1", "archived");
    expect(invoke).toHaveBeenCalledWith("engagement_set_status", { id: "e1", status: "archived" });
    await api.settingsUpdate({ autoLockMinutes: 10 });
    expect(invoke).toHaveBeenCalledWith("settings_update", { patch: { autoLockMinutes: 10 } });
    await api.backupRestore("f.db");
    expect(invoke).toHaveBeenCalledWith("backup_restore", { file: "f.db" });
  });
});
