import { describe, expect, it } from "vitest";
import { failedPayloadIds, staleBuild } from "../../../engines/payloads/memory";
import type { PayloadBuild } from "../../../types/payloadBuild";
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
  it("a later success clears an earlier failure", () => {
    const es = [entry({ id: "a", at: 1, returnedNothing: true }), entry({ id: "b", at: 2, output: "connection received" })];
    expect(failedPayloadIds(es, "h1")).toEqual([]);
  });
  it("a later failure after a success is failed", () => {
    const es = [entry({ id: "a", at: 1, output: "connection received" }), entry({ id: "b", at: 2, returnedNothing: true })];
    expect(failedPayloadIds(es, "h1")).toEqual(["nc-exe"]);
  });
  it("a later pending entry (empty output) does not clear a failure", () => {
    const es = [entry({ id: "a", at: 1, returnedNothing: true }), entry({ id: "b", at: 2, output: "" })];
    expect(failedPayloadIds(es, "h1")).toEqual(["nc-exe"]);
  });
  it("resolves by at regardless of array order, then createdAt", () => {
    const es = [entry({ id: "b", at: 2, output: "ok" }), entry({ id: "a", at: 1, returnedNothing: true })];
    expect(failedPayloadIds(es, "h1")).toEqual([]);
    const tie = [entry({ id: "b", at: 5, createdAt: 2, output: "ok" }), entry({ id: "a", at: 5, createdAt: 1, returnedNothing: true })];
    expect(failedPayloadIds(tie, "h1")).toEqual([]);
  });
});

describe("staleBuild", () => {
  const cur = { LHOST: "192.0.2.10", LPORT: "443" };
  const rec = (over: Partial<PayloadBuild> = {}): PayloadBuild => ({
    engagementId: "e1", hostId: "h1", payloadId: "nishang-cradle", lhost: "192.0.2.10", lport: "443", at: 1, ...over,
  });
  it("no host or no record is null", () => {
    expect(staleBuild([rec()], null, "nishang-cradle", { ...cur, LHOST: "192.0.2.20" })).toBeNull();
    expect(staleBuild([], "h1", "nishang-cradle", cur)).toBeNull();
  });
  it("same values is null", () => {
    expect(staleBuild([rec()], "h1", "nishang-cradle", cur)).toBeNull();
  });
  it("changed LHOST reports was and now", () => {
    expect(staleBuild([rec()], "h1", "nishang-cradle", { ...cur, LHOST: "192.0.2.20" })).toEqual({ was: "192.0.2.10:443", now: "192.0.2.20:443" });
  });
  it("a blank current or recorded value is null", () => {
    expect(staleBuild([rec()], "h1", "nishang-cradle", { ...cur, LPORT: "" })).toBeNull();
    expect(staleBuild([rec({ lhost: "" })], "h1", "nishang-cradle", { ...cur, LHOST: "192.0.2.20" })).toBeNull();
  });
  it("surrounding spaces never read as a change, on either side", () => {
    expect(staleBuild([rec()], "h1", "nishang-cradle", { LHOST: "192.0.2.10 ", LPORT: " 443" })).toBeNull();
    expect(staleBuild([rec({ lhost: " 192.0.2.10 ", lport: "443 " })], "h1", "nishang-cradle", cur)).toBeNull();
    expect(staleBuild([rec({ lhost: "192.0.2.10 " })], "h1", "nishang-cradle", { ...cur, LHOST: " 192.0.2.20" }))
      .toEqual({ was: "192.0.2.10:443", now: "192.0.2.20:443" });
  });
  it("another host's record is ignored", () => {
    expect(staleBuild([rec({ hostId: "h2" })], "h1", "nishang-cradle", { ...cur, LHOST: "192.0.2.20" })).toBeNull();
  });
});
