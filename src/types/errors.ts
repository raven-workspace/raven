/** Every Rust `AppError` code; `ErrorCode` is derived from it, so the two cannot drift. */
const CODES = [
  "locked",
  "wrong_password",
  "vault_exists",
  "no_vault",
  "not_found",
  "damaged",
  "validation",
  "io",
  "db",
  "no_key",
  "offline",
  "key_rejected",
  "nvd_busy",
  "conflict",
] as const;

export type ErrorCode = (typeof CODES)[number];

/** The JSON shape of a rejected Tauri command (Rust `AppError`). */
export interface AppError {
  code: ErrorCode;
  message: string;
  field?: string;
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    (CODES as readonly string[]).includes(v.code) &&
    typeof v.message === "string"
  );
}

export class RavenError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = "RavenError";
    this.code = code;
    if (field !== undefined) this.field = field;
  }

  /** Builds a RavenError from whatever a Tauri `invoke` rejected with. */
  static from(raw: unknown): RavenError {
    if (raw instanceof RavenError) return raw;
    if (isAppError(raw)) return new RavenError(raw.code, raw.message, raw.field ?? undefined);
    if (raw instanceof Error) return new RavenError("io", raw.message);
    return new RavenError("io", typeof raw === "string" ? raw : String(raw));
  }
}
