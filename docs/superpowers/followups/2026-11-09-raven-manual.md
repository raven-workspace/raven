# The Manual: follow-ups

Left open when the Manual round closed (2026-11-09). The audit gate passes on every Manual screen at 900, 1024, 1280 and
1440. The impeccable detector reports nothing over `src/features/manual`.

## Markdown edge cases (renderer)

None of these appear in the synthetic fixtures. Check each against the real vault before fixing it.

- A `|` inside inline code in a table row splits the cell. Obsidian needs `\|` there.
- A table whose rows have no leading pipe isn't read as a table.
- `***bold italic***` isn't parsed as both.
- A fence closes on any later fence of the same character, whatever its length.
- A heading "Usage 2" and a second "Usage" (deduped to `usage-2`) get the same anchor id.

## Search

- ⌘K matches placeholder text in fences (`{TARGET_IP}`) that the filled command no longer shows, so the note opens with
  "No match in this note".
- A phrase split across inline formatting (`**access** denied`) is found by ⌘K but isn't marked in the note.

## Scroll and focus

- The restored scroll, and the scroll back to the current match, are re-applied only once the exam data is ready. Other late
  layout (fonts, a stacking table) isn't waited for.
- Each command block has two tab stops: the block and its Copy button.

## States

- Loading shows a blank note area with only the hint line. The snapshot is usually preloaded at unlock, so this is rarely
  seen. DESIGN.md asks for a `LoadingState` after 150ms.

## Tables

- Stacking is decided by the widest unbreakable value. A table whose widest code is only a little too wide stacks every
  row. Dropping low-priority columns first is the DESIGN.md alternative, but notes don't declare column priorities.

## Import report

- The drift report's "Placeholders Raven can't fill" counts card commands only. A `{TOKEN}` in a Manual note's command that
  Raven can't fill isn't listed, so a typo in a note (`{TARGETIP}`) shows up only when its first copy is held back. Count note
  command tokens there too, marked as coming from a note.

## From the last review (2026-11-09)

- [ ] **Search snippets use a regex approximation of the renderer.** `readable()` in `src/engines/manual/search.ts` differs from the note on `__bold__`, `___x___`, stray `**`, `*`/`_` inside code spans and `\*` escapes. Highlights in the note are unaffected (they come from the DOM); only the ⌘K snippet text can differ. Build the line from `parseInline` instead, so search and the note share one parser.
- [ ] **Emphasis matching can be quadratic on hostile lines** (`src/engines/manual/markdown.ts`): about 3–4 s on a 200,000-character line of unmatched closers. The vault's longest line is 985 characters, so it doesn't bite today. Add CommonMark's openers_bottom bound and build a tree instead of splicing.
