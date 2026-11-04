/** Open threads: lines of field notes that start (after indentation) with `? `. Lines are 0-based. */
export interface Thread {
  line: number;
  text: string;
}

const PREFIX = "? ";
const FENCE = /^\s*(```|~~~)/;

/** Indices of lines inside fenced code blocks (fence lines included). */
function fencedLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const m = FENCE.exec(l);
    if (fence) {
      out.add(i);
      if (m && m[1] === fence) fence = null;
    } else if (m) {
      fence = m[1]!;
      out.add(i);
    }
  });
  return out;
}

export function openThreads(body: string): Thread[] {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  const out: Thread[] = [];
  lines.forEach((l, line) => {
    if (fenced.has(line)) return;
    const t = l.trimStart();
    if (t.startsWith(PREFIX)) out.push({ line, text: t.slice(PREFIX.length).replace(/\r$/, "").trim() });
  });
  return out;
}

function mapLine(body: string, line: number, f: (indent: string, rest: string) => string): string {
  const lines = body.split("\n");
  const l = lines[line];
  if (l === undefined) return body;
  const rest = l.trimStart();
  lines[line] = f(l.slice(0, l.length - rest.length), rest);
  return lines.join("\n");
}

/** Adds `? ` to the line, or removes it when already there. */
export function toggleThreadPrefix(body: string, line: number): string {
  return mapLine(body, line, (indent, rest) => (rest.startsWith(PREFIX) ? indent + rest.slice(PREFIX.length) : indent + PREFIX + rest));
}

/** Marks an open thread `✓` (panned out) or `✗` (dead end). Other lines are untouched. */
export function closeThread(body: string, line: number, outcome: "panned" | "dead"): string {
  return mapLine(body, line, (indent, rest) =>
    rest.startsWith(PREFIX) ? `${indent}${outcome === "panned" ? "✓" : "✗"} ${rest.slice(PREFIX.length)}` : indent + rest,
  );
}
