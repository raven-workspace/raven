import type { OldBackup } from "./types";

const ENCRYPTED_MSG = "This backup is encrypted. Export an unencrypted backup from old Raven and import that.";
const NOT_BACKUP = "Not an old-Raven backup.";
const DAMAGED = "This backup is damaged (checksum mismatch).";
const noBom = (t: string) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export type ReadResult =
  | { ok: true; backup: OldBackup; version: "2.0.0" | "3.0.0" }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Old utils/backupCrypto.ts isEncryptedBackup: BOM-tolerant, never throws. */
function isEncrypted(text: string): boolean {
  const t = noBom(text).trimStart();
  if (t.charCodeAt(0) !== 0x7b || !t.includes("raven-backup-encrypted")) return false;
  try {
    const p: unknown = JSON.parse(t);
    return isObj(p) && p.format === "raven-backup-encrypted";
  } catch {
    return false;
  }
}

/** Keys sorted recursively; null-prototype objects keep a literal `__proto__` key as data. */
function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (isObj(v)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

async function checksumOf(root: Record<string, unknown>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const rest = { ...root };
  delete rest.checksum;
  const json = JSON.stringify(sortKeysDeep(rest)) ?? "null";
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Recursively drop __proto__, constructor and prototype keys. */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) if (!FORBIDDEN.has(k)) out[k] = strip(v[k]);
    return out;
  }
  return v;
}

export async function readBackup(text: string): Promise<ReadResult> {
  if (isEncrypted(text)) return { ok: false, error: ENCRYPTED_MSG };
  let raw: unknown;
  try {
    raw = JSON.parse(noBom(text));
  } catch {
    return { ok: false, error: NOT_BACKUP };
  }

  let root: Record<string, unknown>;
  if (Array.isArray(raw)) {
    root = { machines: raw };
  } else if (isObj(raw)) {
    // Wrapper `{data:{...}}` as validateWorkspacePayload accepts it.
    root = isObj(raw.data) ? raw.data : raw;
  } else {
    return { ok: false, error: NOT_BACKUP };
  }
  if (!Array.isArray(root.machines)) return { ok: false, error: NOT_BACKUP };

  const declared = typeof root.version === "string" ? root.version : "2.0.0";
  if (declared !== "2.0.0" && declared !== "3.0.0") return { ok: false, error: NOT_BACKUP };

  if (declared === "3.0.0" && root.checksum !== undefined) {
    if (typeof root.checksum !== "string" || !/^[0-9a-f]{64}$/.test(root.checksum)) return { ok: false, error: DAMAGED };
    const actual = await checksumOf(root);
    if (actual === null) return { ok: false, error: "This backup carries a checksum that cannot be verified here." };
    if (actual !== root.checksum) return { ok: false, error: DAMAGED };
  }

  const clean = strip(root) as Record<string, unknown>;
  if (!clean.machines || !(clean.machines as unknown[]).every(isObj)) return { ok: false, error: NOT_BACKUP };
  return { ok: true, backup: { ...clean, version: declared } as OldBackup, version: declared };
}
