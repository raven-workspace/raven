import { hasPlaceholders } from "../checklist/template";
import { lookupRows } from "./lookup";
import { parseMarkdown, type Block } from "./markdown";
import type { ManualNote } from "./types";

/** Fence languages that hold output to read, not a command to run: Copy only (no fill, no log, no exam rule). */
export const OUTPUT_LANGS: ReadonlySet<string> = new Set(["text", "txt", "output", "console", "plaintext", "plain"]);

/** Whether a code block holds output to read rather than a command. */
export const isOutputBlock = (block: Extract<Block, { kind: "code" }>): boolean => OUTPUT_LANGS.has(block.lang.toLowerCase());

/** Whether a code block fills its `{PLACEHOLDERS}` for the host in view: a command (not output) with a placeholder. */
export const fillsBlock = (block: Extract<Block, { kind: "code" }>): boolean => !isOutputBlock(block) && hasPlaceholders(block.text);

/** A note's commands that fill for a host, in note order: its code blocks that fill, then its lookup-table commands. */
export function noteCommands(note: ManualNote): string[] {
  const blocks = parseMarkdown(note.body).flatMap((b) => (b.kind === "code" && fillsBlock(b) ? [b.text] : []));
  return [...blocks, ...lookupRows(note).flatMap((r) => r.commands)];
}
