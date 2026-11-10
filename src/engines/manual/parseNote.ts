import { splitFrontmatter } from "../fieldManual/frontmatter";
import type { ManualFolder, ManualNote, OutlineEntry } from "./types";

const FOLDERS: Record<string, ManualFolder> = {
  "03-Tools": "tools",
  "04-Foundations": "foundations",
  "05-Reporting": "reporting",
};

/** The shared anchor slugger: lower-case, runs of non-alphanumerics become one hyphen. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const TABLE = /^\*\*Table\s+(\d+)\s*[—–-]\s*(.+?)\s*\*\*\s*$/;

function outlineOf(body: string): { outline: OutlineEntry[]; h1?: string } {
  const outline: OutlineEntry[] = [];
  const seen = new Map<string, number>();
  const unique = (base: string): string => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  let h1: string | undefined;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^(#{1,3})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = h[2];
      if (h[1] === "#") h1 ??= text;
      else outline.push({ id: unique(slug(text)), text, kind: h[1] === "##" ? "h2" : "h3" });
      continue;
    }
    const t = TABLE.exec(line.trim());
    if (t) outline.push({ id: unique(`table-${t[1]}`), text: `Table ${t[1]} · ${t[2]}`, kind: "table" });
  }
  return { outline, h1 };
}

/** Parses a Tools, Foundations or Reporting note. Null when the path is outside those folders. */
export function parseNote(relPath: string, text: string): ManualNote | null {
  const parts = relPath.split("/");
  const folder = FOLDERS[parts[0]];
  if (!folder || parts.length < 2) return null;
  const { fm, body } = splitFrontmatter(text);
  const { outline, h1 } = outlineOf(body);
  const stem = parts[parts.length - 1].replace(/\.md$/i, "");
  return { id: fm.id || slug(stem), file: relPath, folder, title: fm.title || h1 || stem, body, outline };
}
