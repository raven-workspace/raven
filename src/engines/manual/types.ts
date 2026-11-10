export type ManualFolder = "foundations" | "tools" | "reporting";

export interface OutlineEntry {
  id: string;
  text: string;
  kind: "h2" | "h3" | "table";
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
