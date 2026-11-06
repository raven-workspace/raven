/** Splits a note into its flat `key: value` frontmatter and the body. Values are strings; quotes are stripped. */
export function splitFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const src = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { fm: {}, body: src };
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fm, body: src.slice(m[0].length) };
}
