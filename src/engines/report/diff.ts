export interface DiffLine {
  op: "same" | "add" | "del";
  text: string;
  /** Line number in the modified file for `same` and `add`; null for `del`. */
  n: number | null;
}

/** Line diff by Myers' O(ND) algorithm after trimming the common prefix and suffix. Line numbers are 0-based. */
export function lineDiff(original: string, modified: string): DiffLine[] {
  const a = original === "" ? [] : original.split(/\r?\n/);
  const b = modified === "" ? [] : modified.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: "same", text: a[i], n: i });
  for (const e of myers(a.slice(start, endA), b.slice(start, endB))) {
    if (e.op === "del") out.push({ op: "del", text: e.text, n: null });
    else out.push({ op: e.op, text: e.text, n: start + e.j });
  }
  for (let i = endA; i < a.length; i++) out.push({ op: "same", text: a[i], n: endB + (i - endA) });
  return out;
}

/** Past this many edits the trace memory grows quadratically; treat the region as wholly replaced. */
const MAX_D = 3000;

type Edit = { op: "same" | "add" | "del"; text: string; j: number };

function myers(a: string[], b: string[]): Edit[] {
  const N = a.length;
  const M = b.length;
  if (N === 0) return b.map((text, j) => ({ op: "add", text, j }));
  if (M === 0) return a.map((text) => ({ op: "del", text, j: -1 }));
  const max = N + M;
  // One spare slot each side: round d reads k in [-d-1, d+1] and the trace keeps that row, up to d = max.
  const offset = max + 1;
  const v = new Int32Array(2 * max + 4);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    if (d > MAX_D) return [...a.map((text): Edit => ({ op: "del", text, j: -1 })), ...b.map((text, j): Edit => ({ op: "add", text, j }))];
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
  }
  // Backtrack. trace[d] holds v before round d over k in [-d-1, d+1].
  const edits: Edit[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const at = (k: number) => prev[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ op: "same", text: a[x], j: y });
    }
    if (x === prevX) {
      y--;
      edits.push({ op: "add", text: b[y], j: y });
    } else {
      x--;
      edits.push({ op: "del", text: a[x], j: -1 });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    edits.push({ op: "same", text: a[x], j: y });
  }
  return dropsFirst(edits.reverse());
}

/** Within each run of changes, list the deleted lines before the added ones. */
function dropsFirst(edits: Edit[]): Edit[] {
  const out: Edit[] = [];
  let i = 0;
  while (i < edits.length) {
    if (edits[i].op === "same") {
      out.push(edits[i++]);
      continue;
    }
    let j = i;
    while (j < edits.length && edits[j].op !== "same") j++;
    const run = edits.slice(i, j);
    out.push(...run.filter((e) => e.op === "del"), ...run.filter((e) => e.op === "add"));
    i = j;
  }
  return out;
}
