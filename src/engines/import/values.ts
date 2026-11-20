// Readers for loosely-typed old-Raven JSON, shared by the import modules.

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Epoch-ms numbers are kept; ISO strings are parsed; anything else is `fallback`. */
export function toMs<T>(v: unknown, fallback: T): number | T {
  // Whole milliseconds that fit an i64 exactly: Rust stores these as INTEGER.
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return Math.trunc(v);
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return fallback;
}
