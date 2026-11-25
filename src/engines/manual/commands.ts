import { hasPlaceholders } from "../checklist/template";
import { classifyExam } from "../fieldManual/classifyExam";
import type { LibraryCommand } from "../library/types";
import { lookupRows, shortTitle, type LookupRow } from "./lookup";
import { parseMarkdown, type Block } from "./markdown";
import type { ManualNote } from "./types";

/** Fence languages that hold output to read, not a command to run: Copy only (no fill, no log, no exam rule). */
export const OUTPUT_LANGS: ReadonlySet<string> = new Set(["text", "txt", "output", "console", "plaintext", "plain"]);

type CodeBlock = Extract<Block, { kind: "code" }>;

/** Whether a code block holds output to read rather than a command. */
export const isOutputBlock = (block: CodeBlock): boolean => OUTPUT_LANGS.has(block.lang.toLowerCase());

/** Whether a code block fills its `{PLACEHOLDERS}` for the host in view: a command (not output) with a placeholder. */
export const fillsBlock = (block: CodeBlock): boolean => !isOutputBlock(block) && hasPlaceholders(block.text);

/** A note's commands that fill for a host, in note order: its code blocks that fill, then its lookup-table commands. */
export function noteCommands(note: ManualNote): string[] {
  const blocks = parseMarkdown(note.body).flatMap((b) => (b.kind === "code" && fillsBlock(b) ? [b.text] : []));
  return [...blocks, ...lookupRows(note).flatMap((r) => r.commands)];
}

type NoteRef = Pick<ManualNote, "id" | "title">;

/**
 * Where a piece of Manual code sits: a fenced code block (the `n`th of its note), an inline code span (in a section, or
 * in a table row titled "Table name: key"), or the `i`th command of a lookup row's action cell.
 */
export type ManualCode =
  | { kind: "block"; note: NoteRef; block: CodeBlock; n: number; section: string }
  | { kind: "inline"; note: NoteRef; code: string; section: string; rowTitle?: string }
  | { kind: "lookup"; row: LookupRow; i: number };

const WINDOWS_LANGS = new Set(["cmd", "bat", "batch", "powershell", "ps1", "ps", "pwsh"]);
const LINUX_LANGS = new Set(["bash", "sh", "zsh", "shell"]);

/** The log title of code in a note's section: "Note: Section", or the note alone before the first heading. */
const sectionTitle = (note: NoteRef, section: string) => (section ? `${shortTitle(note.title)}: ${section}` : shortTitle(note.title));

/** Each note's inline commands, by log title and code. */
const inlineCache = new WeakMap<NoteRef, Map<string, LibraryCommand>>();
/** Each lookup row's commands, by place in its action cell (rows are cached per note by `lookupRows`). */
const lookupCache = new WeakMap<LookupRow, Map<number, LibraryCommand>>();

function build(
  id: string, title: string, template: string, where: Pick<LibraryCommand, "os" | "runFrom">, classify: boolean,
): LibraryCommand {
  const command: LibraryCommand = {
    id, title, tool: template.trim().split(/\s+/)[0] ?? "", template, ...where, goals: [], source: "field-manual",
  };
  const exam = classify ? classifyExam(template) : undefined;
  if (exam) command.exam = exam;
  return command;
}

const KALI = { os: "any", runFrom: "attacker" } as const;

/**
 * Manual code as a library command, classified by the exam rules here (`classifyExam`; an output block never is). The
 * one id scheme is `manual:<note id>:<place>`: `<n>` for a code block, `inline:<code>` for an inline span, and
 * `lookup:<table anchor>:<row>:<i>` for a lookup row's command, so the answer card and ⌘K give the same row command
 * the same id. Ids are React keys and the copy guard's arm.
 *
 * A code block's fence title is where it runs, as on a card (`parseCard`): `Kali…` is the attacker, any other title
 * (`Target — PowerShell`, `Pivot — bash`) the target. An untitled block runs from Kali, unless its language is a Windows
 * shell (Kali has none): then it runs on the target. The fence language gives the OS (Windows shells, Unix shells off
 * Kali). Inline and lookup commands run from Kali. A code block and an inline span log as their section, a span in a
 * table row and a lookup command as their row ("Table name: key"). Inline and lookup commands are memoized: the same
 * code in the same place is the same object, so a fill keyed on it is kept across renders.
 */
export function manualCommand(code: ManualCode): LibraryCommand {
  switch (code.kind) {
    case "block": {
      const { note, block, n, section } = code;
      const lang = block.lang.toLowerCase();
      const kali = block.title ? /^kali\b/i.test(block.title) : !WINDOWS_LANGS.has(lang);
      const os = WINDOWS_LANGS.has(lang) ? "windows" : LINUX_LANGS.has(lang) && !kali ? "linux" : "any";
      return build(`manual:${note.id}:${n}`, sectionTitle(note, section), block.text, { os, runFrom: kali ? "attacker" : "target" }, !isOutputBlock(block));
    }
    case "inline": {
      const { note, section, rowTitle } = code;
      const title = rowTitle ?? sectionTitle(note, section);
      let byNote = inlineCache.get(note);
      if (!byNote) inlineCache.set(note, (byNote = new Map()));
      const key = `${title}\u0000${code.code}`;
      let command = byNote.get(key);
      if (!command) byNote.set(key, (command = build(`manual:${note.id}:inline:${code.code}`, title, code.code, KALI, true)));
      return command;
    }
    case "lookup": {
      const { row, i } = code;
      let byRow = lookupCache.get(row);
      if (!byRow) lookupCache.set(row, (byRow = new Map()));
      let command = byRow.get(i);
      if (!command) {
        const id = `manual:${row.noteId}:lookup:${row.anchor}:${row.row}:${i}`;
        byRow.set(i, (command = build(id, `${row.tableName}: ${row.key}`, row.commands[i] ?? "", KALI, true)));
      }
      return command;
    }
  }
}

/** A lookup row's commands as library commands, in the order of its action cell. */
export const lookupCommands = (row: LookupRow): LibraryCommand[] => row.commands.map((_, i) => manualCommand({ kind: "lookup", row, i }));
