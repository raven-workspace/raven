import { describe, expect, it } from "vitest";
import { failedPayloadIds, staleBaked } from "../../../engines/payloads/memory";
import type { LogEntry } from "../../../types/log";

const entry = (over: Partial<LogEntry> & { output?: string } = {}): LogEntry => {
  const { output = "", ...rest } = over;
  return {
    id: "l1", engagementId: "e1", kind: "command", title: "t", titleEdited: false, ranOn: null,
    hostIds: ["h1"], observations: null, returnedNothing: false, private: false, at: 1000,
    createdAt: 1000, updatedAt: 1000, payloadId: "nc-exe",
    content: { kind: "command", blocks: [{ command: "x", output }] }, ...rest,
  };
};

describe("failedPayloadIds", () => {
  it("returnedNothing marks failed", () => {
    expect(failedPayloadIds([entry({ returnedNothing: true })], "h1")).toEqual(["nc-exe"]);
  });
  it("nc -e invalid option output marks failed", () => {
    const e = entry({ payloadId: "nc-e-linux", output: "nc: invalid option -- 'e'" });
    expect(failedPayloadIds([e], "h1")).toEqual(["nc-e-linux"]);
  });
  it("ignores other hosts, entries without a payload, and clean output", () => {
    const es = [
      entry({ id: "a", hostIds: ["h2"], returnedNothing: true }),
      entry({ id: "b", payloadId: null, returnedNothing: true }),
      entry({ id: "c", output: "connection received" }),
    ];
    expect(failedPayloadIds(es, "h1")).toEqual([]);
  });
  it("lists each payload once", () => {
    const es = [entry({ id: "a", returnedNothing: true }), entry({ id: "b", output: "Access is denied." })];
    expect(failedPayloadIds(es, "h1")).toEqual(["nc-exe"]);
  });
});

describe("staleBaked", () => {
  const cur = { LHOST: "192.0.2.10", LPORT: "443" };
  const baked = (over: Partial<LogEntry> = {}) =>
    entry({ payloadId: "nishang-cradle", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" }, ...over });
  it("changed LPORT lists the rev.ps1 entry as stale", () => {
    const r = staleBaked([baked({ at: 5000 })], { ...cur, LPORT: "4444" });
    expect(r).toEqual([{ payloadId: "nishang-cradle", at: 5000, was: "192.0.2.10:443" }]);
  });
  it("same values, unbaked payloads and entries without values are not stale", () => {
    const es = [
      baked(), entry({ payloadId: "nc-exe", payloadValues: { LHOST: "192.0.2.99", LPORT: "1" } }),
      baked({ id: "z", payloadValues: null }),
    ];
    expect(staleBaked(es, cur)).toEqual([]);
  });
  it("returns only the newest entry per payload", () => {
    const es = [
      baked({ id: "old", at: 1, payloadValues: { LHOST: "192.0.2.77", LPORT: "80" } }),
      baked({ id: "new", at: 9, payloadValues: { LHOST: "192.0.2.88", LPORT: "80" } }),
    ];
    expect(staleBaked(es, cur)).toEqual([{ payloadId: "nishang-cradle", at: 9, was: "192.0.2.88:80" }]);
  });
  it("a newer entry that matches clears an older stale one", () => {
    const es = [baked({ at: 1, payloadValues: { LHOST: "192.0.2.77", LPORT: "80" } }), baked({ at: 9 })];
    expect(staleBaked(es, cur)).toEqual([]);
  });
});
