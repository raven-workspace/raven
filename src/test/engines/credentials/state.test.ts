import { describe, it, expect } from "vitest";
import { accessFlags, newCredSince, playbookTriggers } from "../../../engines/credentials/state";
import type { Hop } from "../../../types/network";
import { att, byHost, cred, host, hostWith } from "./fixtures";

const dc = hostWith("dc", "10.0.0.1", [53, 88, 135, 389, 445]);
const ms02 = hostWith("ms02", "10.0.0.6", [445, 5985]);
const web = hostWith("web", "10.0.0.50", [80]);
const eng = { id: "eng1" };

const A = (over: Partial<Parameters<typeof att>[0]> = {}) => att({ id: "a1", hostId: "ms02", result: "valid", at: 3000, ...over });
const C = (over: Partial<Parameters<typeof cred>[0]> = {}) => cred({ id: "c1", username: "svc_sql", secret: "Pw1", createdAt: 2000, ...over });
const hop = (toHostId: string): Hop => ({
  id: "hop1", engagementId: "eng1", fromHostId: null, toHostId, via: "psexec", logEntryId: null, at: 1, updatedAt: 1,
});

const trig = (
  hs: { host: ReturnType<typeof host>; services: ReturnType<typeof hostWith>["services"] }[],
  credentials = [] as ReturnType<typeof cred>[],
  attempts = [] as ReturnType<typeof att>[],
  hops: Hop[] = [],
) => playbookTriggers({
  engagement: eng, hosts: hs.map((h) => h.host), servicesByHost: byHost(...hs), credentials, attempts, hops,
});

describe("playbookTriggers lateral", () => {
  it("opens for a dual-homed host", () => {
    const d = { ...web, host: { ...web.host, dualHomed: true } };
    expect(trig([d]).lateral).toBe(true);
    expect(trig([web]).lateral).toBe(false);
  });
  it("opens while a credential lacks an attempt on a host with a sprayable service, and closes once tried everywhere", () => {
    expect(trig([ms02, web], [C()]).lateral).toBe(true);
    expect(trig([ms02, web], [C()], [A()]).lateral).toBe(false);
    expect(trig([ms02, web], [C()], [A({ hostId: "other" })]).lateral).toBe(true);
  });
});

describe("playbookTriggers", () => {
  it("nocreds opens with an AD host and no working domain cred", () => {
    expect(trig([dc, ms02])).toEqual({ lateral: false, nocreds: true, user: false, da: false });
    expect(trig([ms02, web]).nocreds).toBe(false);
    expect(trig([dc, ms02], [C()], [A({ result: "failed" })]).nocreds).toBe(true);
    expect(trig([dc, ms02], [C({ scope: "local", localHostId: "ms02" })], [A()])).toEqual({ lateral: true, nocreds: true, user: false, da: false });
  });

  it("user opens on first valid domain cred and nocreds stays open until then", () => {
    expect(trig([dc, ms02], [C()], [A({ result: "errored" })]).user).toBe(false);
    const t = trig([dc, ms02], [C()], [A()]);
    expect(t.user).toBe(true);
    expect(t.nocreds).toBe(false);
  });

  it("da opens on admin on the DC, or a hop into the DC", () => {
    expect(trig([dc, ms02], [C()], [A({ result: "admin" })]).da).toBe(false);
    expect(trig([dc, ms02], [C()], [A({ hostId: "dc", result: "admin" })]).da).toBe(true);
    expect(trig([dc, ms02], [], [], [hop("dc")]).da).toBe(true);
    expect(trig([dc, ms02], [], [], [hop("ms02")]).da).toBe(false);
  });

  it("da needs a single DC: two AD hosts mean no DC is known", () => {
    const dc2 = hostWith("dc2", "10.0.0.2", [88, 389]);
    expect(trig([dc, dc2], [], [], [hop("dc")]).da).toBe(false);
  });
});

describe("credential scoping and auth mode", () => {
  it("a domain cred that only worked with local auth keeps no-creds open", () => {
    const t = trig([dc, ms02], [C()], [A({ authMode: "local" })]);
    expect(t.nocreds).toBe(true);
    expect(t.user).toBe(false);
  });

  it("another engagement's records never count", () => {
    const foreign = C({ engagementId: "eng2" });
    expect(trig([dc, ms02], [foreign], [A({ engagementId: "eng2" })]).user).toBe(false);
    expect(trig([dc, ms02], [C()], [A({ engagementId: "eng2" })]).user).toBe(false);
    expect(accessFlags({ hosts: [ms02.host], attempts: [A()], credentials: [foreign] })).toEqual([]);
    expect(trig([dc, ms02], [C()], [A()]).user).toBe(true);
  });
});

describe("newCredSince", () => {
  it("lists domain creds newer than completedAt", () => {
    const creds = [C({ id: "old", createdAt: 1000 }), C({ id: "new" }), C({ id: "loc", scope: "local", localHostId: "ms02" })];
    expect(newCredSince(1500, creds).map((c) => c.id)).toEqual(["new"]);
    expect(newCredSince(undefined, creds)).toEqual([]);
  });
});

describe("accessFlags", () => {
  it("ignores attempts older than accessReviewedAt", () => {
    const reviewed = { ...ms02.host, accessReviewedAt: 4000 };
    expect(accessFlags({ hosts: [reviewed], attempts: [A()], credentials: [C()] })).toEqual([]);
    const fresh = accessFlags({
      hosts: [reviewed], attempts: [A({ at: 5000, result: "admin", service: "winrm" })], credentials: [C()],
    });
    expect(fresh).toEqual([{ hostId: "ms02", credId: "c1", service: "winrm", result: "admin", at: 5000 }]);
    expect(accessFlags({ hosts: [ms02.host], attempts: [A({ result: "failed" })], credentials: [C()] })).toEqual([]);
  });

  it("marks password reuse, so it is never read as a result on its stand-in service", () => {
    const reuse = accessFlags({ hosts: [ms02.host], attempts: [A({ service: "other", authMode: "local", detail: "password reuse" })], credentials: [C()] });
    expect(reuse.map((f) => [f.service, f.reuse])).toEqual([["other", true]]);
    const other = accessFlags({ hosts: [ms02.host], attempts: [A({ service: "other" })], credentials: [C()] });
    expect(other.map((f) => [f.service, f.reuse])).toEqual([["other", undefined]]);
  });

  it("keeps the strongest result per host, subject and service, sorted by time", () => {
    const flags = accessFlags({
      hosts: [ms02.host],
      attempts: [A({ id: "a1", at: 3000 }), A({ id: "a2", at: 4000, result: "admin" }), A({ id: "a3", at: 5000 }), A({ id: "a4", at: 2500, service: "winrm" })],
      credentials: [C()],
    });
    expect(flags.map((f) => [f.service, f.result, f.at])).toEqual([["winrm", "valid", 2500], ["smb", "admin", 4000]]);
  });
});
