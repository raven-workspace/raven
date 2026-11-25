import { describe, expect, it } from "vitest";
import { isReuseAttempt, PASSWORD_REUSE_DETAIL, PASSWORD_REUSE_SERVICE, reuseWording } from "../../../engines/credentials/reuse";
import scenario from "../../storeScenarios/password-reuse.json";

describe("password reuse", () => {
  it("is the stored marker only: service other with the detail 'password reuse'", () => {
    expect(isReuseAttempt({ service: "other", detail: "password reuse" })).toBe(true);
    // A real result on another service, with or without a detail, reads as before; so does the detail on a named service.
    expect(isReuseAttempt({ service: "other", detail: null })).toBe(false);
    expect(isReuseAttempt({ service: "other", detail: "STATUS_ACCOUNT_DISABLED" })).toBe(false);
    expect(isReuseAttempt({ service: "smb", detail: "password reuse" })).toBe(false);
  });

  it("is the marker the password-reuse store scenario expects from both the Rust filing and the fake", () => {
    // That scenario runs on the real store (store_scenarios.rs) and on the fake, so all three agree on one marker.
    const steps = scenario.steps as { expect?: unknown }[];
    const attempts = steps.flatMap((s) => (Array.isArray(s.expect) ? s.expect : [])) as { service?: string; detail?: string }[];
    const filed = attempts.filter((a) => a.detail !== undefined);
    expect(filed).toEqual([expect.objectContaining({ service: PASSWORD_REUSE_SERVICE, detail: PASSWORD_REUSE_DETAIL })]);
    expect(isReuseAttempt({ service: filed[0]!.service as "other", detail: filed[0]!.detail! })).toBe(true);
  });

  it("is worded with the host it was reused on and, when known, the host it is stored for", () => {
    expect(reuseWording("SQL01", "WEB01")).toBe("reused on SQL01 (same password as WEB01)");
    expect(reuseWording("SQL01", null)).toBe("reused on SQL01");
  });
});
