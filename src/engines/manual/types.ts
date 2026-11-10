export type ManualFolder = "foundations" | "tools" | "reporting";

export interface OutlineEntry {
  id: string;
  /** The heading text, or a table's name (its caption without "Table N"). */
  text: string;
  kind: "h2" | "h3" | "table";
  /** Tables only: the caption's number. The outline shows "Table N" and the name as two parts. */
  number?: string;
}

export interface ManualNote {
  id: string;
  /** Path relative to the vault, with `/` separators. */
  file: string;
  folder: ManualFolder;
  title: string;
  /** Markdown after the frontmatter. */
  body: string;
  outline: OutlineEntry[];
}
