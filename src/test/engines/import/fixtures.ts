// Synthetic old-Raven backup builders. No real data: every value here is made up.
import type { OldMachine } from "../../../engines/import/types";

const OLD = "2024-01-01T00:00:00.000Z";

/** Canonical JSON: keys sorted recursively, no whitespace (mirrors old utils/backupChecksum.ts). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = Object.create(null);
      for (const k of Object.keys(v).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value)) ?? "null";
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generic old machine row (a custom, standalone box by default). */
export const machine = (over: Partial<OldMachine> = {}): OldMachine =>
  ({
    id: "custom-box-1",
    name: "Box One",
    ip: "10.10.10.5",
    os: "Linux",
    platform: "Custom",
    difficulty: "Easy",
    status: "recon",
    tags: [],
    certifications: [],
    timeSpentSeconds: 0,
    isCustom: true,
    createdAt: OLD,
    updatedAt: OLD,
    ...over,
  }) as OldMachine;

/** A lab container: custom + 'pro-lab' tag. */
export const lab = (over: Partial<OldMachine> = {}): OldMachine =>
  machine({ id: "custom-lab-1", name: "Lab One", ip: "", tags: ["pro-lab"], ...over });

/** A box inside a lab (labId points at the lab). */
export const labBox = (over: Partial<OldMachine> = {}): OldMachine =>
  machine({ id: "custom-lab-1-box-1", name: "Lab Box", labId: "custom-lab-1", ...over });

/** A standalone box: custom, no labId. */
export const standalone = (over: Partial<OldMachine> = {}): OldMachine => machine(over);

/** A catalog (HTB/THM) machine: never importable. */
export const catalog = (over: Partial<OldMachine> = {}): OldMachine =>
  machine({ id: "htb-42", name: "Catalog Box", platform: "HTB", isCustom: false, ...over });

export const logEntry = (at: number, over: Record<string, unknown> = {}) => ({
  id: `log-${at}`,
  title: "scan",
  tool: "nmap",
  at,
  updatedAt: at,
  hostIds: [],
  credIds: [],
  blocks: [{ command: "nmap -sV 10.10.10.5", output: "22/tcp open ssh" }],
  ...over,
});

/** A 3.0.0 backup with a correct checksum. Override any top-level key; pass `checksum` to force a value. */
export async function backupV3(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const core: Record<string, unknown> = {
    version: "3.0.0",
    exportedAt: OLD,
    isRedacted: false,
    machines: [lab(), labBox(), standalone({ id: "custom-solo-1", name: "Solo" }), catalog()],
    credentials: [],
    credAttempts: [],
    usernames: [],
    lootItems: [],
    ...over,
  };
  if (!("checksum" in over)) core.checksum = await sha256Hex(canonicalJson({ ...core, checksum: undefined }));
  return core;
}

/** A legacy 2.0.0 workspace export (no loot, no checksum). */
export const workspaceV2 = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: "2.0.0",
  exportedAt: OLD,
  appBrand: "raven",
  machines: [standalone()],
  ...over,
});

/** An encrypted envelope (structure only; the ciphertext is junk). */
export const encryptedEnvelope = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: "raven-backup-encrypted",
  v: 1,
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: "c2FsdHNhbHQ=" },
  cipher: { name: "AES-GCM", iv: "aXZpdml2aXZpdml2" },
  ciphertext: "AAAA",
  ...over,
});

export const toText = (v: unknown): string => JSON.stringify(v, null, 2);

/** A 1x1 PNG, base64 (synthetic). */
export const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const image = (id: string, over: Record<string, unknown> = {}) => ({ id, mime: "image/png", data: PNG_B64, ...over });

export const screenshot = (id: string, imageId: string, over: Record<string, unknown> = {}) => ({
  id,
  imageId,
  title: `Shot ${id}`,
  notes: `notes for ${id}`,
  createdAt: 1700000000000,
  ...over,
});

/** A legacy per-machine command output (folded into the log by old migrateLegacyLogs). */
export const commandOutput = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `output ${id}`,
  tool: "manual",
  content: `content of ${id}`,
  createdAt: 1600000000000,
  ...over,
});
