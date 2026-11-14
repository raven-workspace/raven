/** A figure's width as a positive whole number of px, or null (full width) for anything else. */
export function figureWidth(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
