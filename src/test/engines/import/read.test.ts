import { describe, expect, it } from "vitest";
import { readBackup } from "../../../engines/import/read";
import { backupV3, canonicalJson, encryptedEnvelope, machine, sha256Hex, toText, workspaceV2 } from "./fixtures";

const ENC = "This backup is encrypted. Export an unencrypted backup from old Raven and import that.";

describe("readBackup", () => {
  it("encrypted backup is rejected with the export-unencrypted message", async () => {
    const r = await readBackup(toText(encryptedEnvelope()));
    expect(r).toEqual({ ok: false, error: ENC });
    // BOM-tolerant
    expect(await readBackup("﻿" + JSON.stringify(encryptedEnvelope()))).toEqual({ ok: false, error: ENC });
  });

  it("2.0.0 and 3.0.0 and a wrapped payload are read", async () => {
    const v3 = await readBackup("﻿" + toText(await backupV3()));
    expect(v3.ok && v3.version).toBe("3.0.0");
    const v2 = await readBackup(toText(workspaceV2()));
    expect(v2.ok && v2.version).toBe("2.0.0");
    const noVersion = await readBackup(toText({ machines: [machine()] }));
    expect(noVersion.ok && noVersion.version).toBe("2.0.0");
    const wrapped = await readBackup(toText({ data: workspaceV2() }));
    expect(wrapped.ok && wrapped.backup.machines).toHaveLength(1);
    const bare = await readBackup(toText([machine(), machine({ id: "custom-2" })]));
    expect(bare.ok && bare.backup.machines).toHaveLength(2);
    expect(await readBackup("nope")).toEqual({ ok: false, error: "Not an old-Raven backup." });
    expect(await readBackup(toText({ foo: 1 }))).toEqual({ ok: false, error: "Not an old-Raven backup." });
    expect(await readBackup(toText({ version: "9.9.9", machines: [] }))).toEqual({ ok: false, error: "Not an old-Raven backup." });
  });

  it("a 3.0.0 checksum mismatch is rejected; a correct one passes", async () => {
    const good = await backupV3();
    expect(typeof good.checksum).toBe("string");
    expect((await readBackup(toText(good))).ok).toBe(true);
    // key order and whitespace do not matter
    expect((await readBackup(JSON.stringify(Object.fromEntries(Object.entries(good).reverse())))).ok).toBe(true);
    const tampered = { ...good, exportedAt: "2025-01-01T00:00:00.000Z" };
    expect(await readBackup(toText(tampered))).toEqual({ ok: false, error: "This backup is damaged (checksum mismatch)." });
    expect(await readBackup(toText({ ...good, checksum: "xyz" }))).toEqual({ ok: false, error: "This backup is damaged (checksum mismatch)." });
    // a 3.0.0 without a checksum is accepted
    expect((await readBackup(toText(await backupV3({ checksum: undefined })))).ok).toBe(true);
    expect(canonicalJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}');
  });

  it("prototype keys are stripped", async () => {
    const text =
      '{"version":"2.0.0","machines":[{"id":"custom-1","name":"x","tags":[],"__proto__":{"polluted":true},"constructor":{"a":1},"nested":{"prototype":1,"ok":2}}]}';
    const r = await readBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.backup.machines[0] as unknown as Record<string, unknown>;
    expect(Object.keys(m)).not.toContain("__proto__");
    expect(Object.keys(m)).not.toContain("constructor");
    expect(m.nested).toEqual({ ok: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("deep nesting and non-string versions never throw", async () => {
    const deep = '{"version":"2.0.0","machines":[],"x":' + "[".repeat(10000) + "]".repeat(10000) + "}";
    expect(await readBackup(deep)).toEqual({ ok: false, error: "Not an old-Raven backup." });
    const r = await readBackup(toText({ version: 3, machines: [machine()] }));
    expect(r.ok && r.version).toBe("2.0.0");
  });

  it("read.ts verifies a signed payload with nesting and a literal __proto__ key", async () => {
    const payload = JSON.parse(
      '{"version":"3.0.0","machines":[{"id":"custom-1","name":"n","tags":["a"],"__proto__":{"k":[1,{"z":1,"a":2}]},"deep":{"b":[[1],{"y":null}]}}],"credentials":[]}',
    );
    payload.checksum = await sha256Hex(canonicalJson(payload));
    const text = JSON.stringify(payload);
    expect(text).toContain('"__proto__"');
    expect((await readBackup(text)).ok).toBe(true);
    const bad = text.replace('"y":null', '"y":0');
    expect(await readBackup(bad)).toEqual({ ok: false, error: "This backup is damaged (checksum mismatch)." });
  });
});
