/** A run of finding text: prose (read as inline Markdown) or code (printed as written, in a code block). */
export type TextRun = { kind: "prose"; text: string } | { kind: "code"; text: string };

const FENCE = /^\s*(`{3,}|~{3,})/;

/** Lines that read as pasted terminal text: diff and git output, indented code, a shell or PowerShell prompt. */
const CODE_LINE = [
  /^diff --git /,
  /^index [0-9a-f]+\.\./,
  /^(?:---|\+\+\+) /,
  /^@@ /,
  /^[+-](?:\S| {4,})/,
  /^commit [0-9a-f]{7,40}/,
  /^(?:Author|Date):/,
  /^(?: {4}|\t)/,
  /^\S*[$#>] /,
  /^PS [A-Z]:\\/,
];

const isBlank = (line: string) => line.trim() === "";
const isCodeLine = (line: string) => !isBlank(line) && CODE_LINE.some((re) => re.test(line));

/** Lines without the blank ones at either end. */
function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && isBlank(lines[a])) a++;
  while (b > a && isBlank(lines[b - 1])) b--;
  return lines.slice(a, b);
}

/**
 * Finding text split into prose and code runs, so pasted terminal text (a git diff, a commit, PHP, a shell session)
 * prints as code and never as Markdown lists or italics. A run is code when it is a fenced block (fences dropped), or a
 * run of two or more code-like lines (`CODE_LINE`), blank lines between two of them included. A single code-like line
 * inside prose stays prose.
 */
export function terminalBlocks(text: string): TextRun[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: TextRun[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    const kept = trimBlank(prose);
    if (kept.length > 0) out.push({ kind: "prose", text: kept.join("\n") });
    prose = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const ch = fence[1][0];
      const indent = /^[ \t]*/.exec(line)![0].length;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const f = FENCE.exec(lines[i]);
        if (f && f[1][0] === ch) break;
        body.push(lines[i].replace(new RegExp(`^[ \\t]{0,${indent}}`), ""));
        i++;
      }
      i++;
      flushProse();
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (isCodeLine(line)) {
      // The run: code lines, and blank lines that have a code line after them before any prose line.
      let j = i;
      let count = 0;
      let end = i;
      while (j < lines.length && !FENCE.test(lines[j])) {
        if (isCodeLine(lines[j])) {
          count++;
          end = j + 1;
        } else if (!isBlank(lines[j])) break;
        j++;
      }
      if (count >= 2) {
        flushProse();
        out.push({ kind: "code", text: lines.slice(i, end).join("\n") });
        i = end;
        continue;
      }
    }
    prose.push(line);
    i++;
  }
  flushProse();
  return out;
}
