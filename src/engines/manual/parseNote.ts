import { splitFrontmatter } from "../fieldManual/frontmatter";
import { anchorIds, FENCE, OUTLINE_HEADING, slug, tableCaption } from "./anchors";
import type { ManualFolder, ManualNote, OutlineEntry } from "./types";

export { slug };

const FOLDERS: Record<string, ManualFolder> = {
  "03-Tools": "tools",
  "04-Foundations": "foundations",
  "05-Reporting": "reporting",
};

/**
 * A note body's outline (`##`, `###` and table captions, fenced code skipped) and its first `#` heading. Notes re-derive
 * their outline from the body when they load, so a fix here reaches notes imported before it.
 */
export function outlineOf(body: string): { outline: OutlineEntry[]; h1?: string } {
  const outline: OutlineEntry[] = [];
  const ids = anchorIds();
  let h1: string | undefined;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = OUTLINE_HEADING.exec(line);
    if (h) {
      const text = h[2];
      if (h[1] === "#") h1 ??= text;
      else outline.push({ id: ids.heading(text), text, kind: h[1] === "##" ? "h2" : "h3" });
      continue;
    }
    const t = tableCaption(line);
    if (t) outline.push({ id: ids.table(t.number), text: t.name, kind: "table", number: t.number });
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
