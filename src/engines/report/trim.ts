const INLINE_MAX_LINES = 60;

/** Lines of an output as kept ranges index them: "" has none, a trailing newline ends an empty last line. */
export const lineCount = (text: string) => (text === "" ? 0 : text.split(/\r?\n/).length);
const DEFAULT_HEAD_LINES = 40;

/** The lines an output starts with on the page: all of it when short, else the first 40 for the owner to widen. */
export function defaultKeep(lineCount: number): [number, number][] | null {
  return lineCount <= INLINE_MAX_LINES ? null : [[0, DEFAULT_HEAD_LINES - 1]];
}

export type KeptItem = { kind: "line"; n: number; text: string } | { kind: "omitted"; count: number };

/** The lines of an output with only the kept ranges as lines; each gap (leading, between, trailing) is one `omitted` item. Ranges are inclusive, merged and clamped. */
export function applyKeep(output: string, keep: [number, number][] | null): KeptItem[] {
  const lines = output.split(/\r?\n/);
  if (keep === null) return lines.map((text, n) => ({ kind: "line", n, text }));
  const last = lines.length - 1;
  const ranges = keep
    .map(([a, b]) => [Math.max(0, a), Math.min(last, b)] as [number, number])
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const top = merged[merged.length - 1];
    if (top && r[0] <= top[1] + 1) top[1] = Math.max(top[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: KeptItem[] = [];
  let next = 0;
  for (const [a, b] of merged) {
    if (a > next) out.push({ kind: "omitted", count: a - next });
    for (let n = a; n <= b; n++) out.push({ kind: "line", n, text: lines[n] });
    next = b + 1;
  }
  if (next <= last) out.push({ kind: "omitted", count: last + 1 - next });
  return out;
}
