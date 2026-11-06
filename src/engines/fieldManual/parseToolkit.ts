export interface ToolkitEntry {
  os: 'windows' | 'linux';
  purpose: string;
  file: string;
  /** Whatever else the "File to transfer" cell says (e.g. "(fallback for 32-bit)"). */
  note: string;
  /** The "Where to get it" cell. */
  where: string;
  /** True when the cell carries ✅ (the file is staged on Kali). */
  staged: boolean;
}

const cells = (line: string): string[] => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
};

/** Parses the two tables of `00-Home/Toolkit.md` (spec §4). Each backticked name in the file cell is one entry. */
export function parseToolkit(text: string): ToolkitEntry[] {
  const out: ToolkitEntry[] = [];
  let os: 'windows' | 'linux' | null = null;
  let purpose = '';
  let inFence = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase();
      if (name.startsWith('windows')) os = 'windows';
      else if (name.startsWith('linux')) os = 'linux';
      else os = null;
      purpose = '';
      continue;
    }
    if (!os || !line.trim().startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 2 || /^:?-{2,}:?$/.test(c[0]) || c[0].toLowerCase() === 'purpose') continue;
    const p = c[0].replace(/\*\*/g, '').trim();
    if (p) purpose = p;
    const cell = c[1];
    const files = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    if (files.length === 0) continue;
    const staged = cell.includes('✅');
    const note = cell
      .replace(/`[^`]*`/g, ' ')
      .replace(/✅/g, ' ')
      .replace(/(^|\s)[+/](?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const file of files) out.push({ os, purpose, file, note, where: c[2] ?? '', staged });
  }
  return out;
}
