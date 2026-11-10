# The Manual, reading round — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Manual's commands usable where they are written (inline, in table rows), surface lookup-table answers in the Manual (answer card) and in ⌘K (Lookup group), and close the remaining critique findings.

**Architecture:** One engine module (`src/engines/manual/lookup.ts`) decides what an inline command and a lookup row are; the Manual (inline commands, answer card, lit row) and ⌘K (Lookup group) both read it. Copy, fill, guard and exam behaviour stay in one hook extracted from `ManualCommand`, so code blocks, inline commands and card rows behave identically. One status slot in the Manual's host row carries every Manual copy's feedback.

**Tech Stack:** React 19, TypeScript, Tailwind 4, zustand, react-router, vitest + Testing Library, Playwright audit (`npm run audit:visual`).

**Spec:** `docs/superpowers/specs/2026-11-09-raven-manual-reading-round-design.md`

## Global Constraints

- Work on branch `manual-reading`; one commit per task; commit messages carry **no** `Co-Authored-By` or other attribution trailer (a hook blocks them).
- No new dependencies (owner rule: rebuild behaviour rather than add a UI library).
- CSS grid with explicit tracks by default; flexbox only for single-line runs (DESIGN.md, Layouts).
- Spacing steps only 0, 1, 2, 3, 4, 6, 8 (4px base); type roles only `text-title|heading|body|code|meta|label`, plus `text-read`/`text-read-title` inside a note. `src/test/conventions.test.ts` enforces these.
- One accent (`--accent`) for meaning; `--warn` (amber) for unfilled placeholders, guard hints, exam locks. No red.
- Keyboard-first: every new control is reachable and operable by key; focus always visible.
- Never put real engagement data or vault text in the repo; fixtures are invented (`src/audit/fixtures.ts`, "Zz" names, `example.test` hosts, RFC 5737 addresses).
- Subagents run on Sonnet or better, never Haiku.
- Run `npx vitest run` (whole suite) and `npx tsc --noEmit -p .` before each commit; `npm run audit:visual` in the last task.

## Review Focus

1. **A command-like inline token with a secret** (`-p '{PASS}'`) must show masked and copy in clear, exactly like a block: covered in Task 2 (test `inline command masks PASS and copies it clear`).
2. **Exam sim + banned technique inline** (an inline `msfconsole …` or poisoning tool in a lookup row) must be held back with the exam line, not silently copied: Task 2 (test `inline command obeys exam rules`).
3. **The same key text in two tables** (e.g. `STATUS_ACCESS_DENIED` in Table 1 and a quoted mention elsewhere) — the card must come from the row the current match is in, not the first row with that key: Task 4 (test `card follows the row the current match is in`).
4. **A lookup row whose action cell has no commands** must show a card without command rows in the Manual and must not appear in ⌘K's Lookup group: Tasks 4 and 5 (tests `card without commands`, `lookup row without commands is not a Lookup hit`).
5. **Typing in the palette after landing on a lookup command** — the Lookup group re-filters and the selection stays on a valid row; → on a lookup command must navigate, never open an empty Arsenal drawer: Task 5 (test `→ on a lookup command opens the note at its row`).

---

### Task 1: Lookup and inline-command engine

**Files:**
- Create: `src/engines/manual/lookup.ts`
- Modify: `src/engines/manual/index.ts` (export), `src/features/manual/NoteTable.tsx` (import `isKeyCell` from the engine instead of its local copy), `src/features/manual/ManualRail.tsx` (use `shortTitle`)
- Test: `src/test/engines/manual/lookup.test.ts`

**Interfaces:**
- Produces:
  - `isInlineCommand(code: string): boolean` — true when `code` has `{PLACEHOLDER}` (`/\{[A-Za-z][A-Za-z0-9_]*\}/`) or contains whitespace.
  - `isKeyCell(parts: Inline[]): boolean` — moved verbatim from `NoteTable.tsx` (with its `KEY_MAX`).
  - `shortTitle(title: string): string` — strips a trailing ` — Reference` / ` – Reference` / ` - Reference` (moved from `ManualRail.tsx`'s `railTitle`).
  - `lookupColumns(head: Inline[][], rows: Inline[][][]): LookupColumns | null` with `interface LookupColumns { key: 0; action: number; means?: number; cause?: number; card?: number }`. Null unless every non-empty first cell passes `isKeyCell` and a header matches `/^(do( this)?|what to try next|fix)$/i`. Means: `/^(means( for an attacker)?|what it means)$/i`; cause: `/^(usually caused by|usual cause)$/i`; card: `/^card$/i`.
  - `interface LookupRow { noteId: string; anchor: string; tableName: string; row: number; key: string; means: Inline[]; cause: Inline[]; action: Inline[]; commands: string[]; card?: { target: string; heading?: string; label: string } }`
  - `lookupRows(note: ManualNote): LookupRow[]` — every row of every lookup table in note order; `anchor` is the table's `table-N` id from the caption before it (`parseMarkdown` gives captions as paragraphs with `anchor`); `tableName` is the outline text for that anchor (`note.outline`); `key` is the key cell as plain text; `commands` are the action cell's code parts passing `isInlineCommand`, in order. Cached per note in a `WeakMap`.

- [ ] **Step 1: Write the failing tests** in `src/test/engines/manual/lookup.test.ts`, on an inline note body built in the test (invented content):
  - `isInlineCommand`: `"nxc smb {DC_IP} --pass-pol"` → true; `"ip -br addr"` → true; `"--local-auth"` → false; `"STATUS_LOGON_FAILURE"` → false.
  - `lookupColumns` on head `["Error","Means","Usually caused by","Do this","Card"]` with key-cell rows → `{ key: 0, means: 1, cause: 2, action: 3, card: 4 }`; on head `["Probe result","nmap state","Meaning"]` → null; on a table whose first column holds prose ("Nothing back, or ICMP unreachable") → null.
  - `lookupRows` for a note with caption `**Table 3 — Kerberos errors**` and one row `| \`KRB_AP_ERR_SKEW\` | Clock off. | VM tools. | \`sudo ntpdate {DC_IP}\`; or \`faketime\`. | [[Zz-Clock]] |` → one row with `anchor: "table-3"`, `tableName: "Kerberos errors"`, `key: "KRB_AP_ERR_SKEW"`, `commands: ["sudo ntpdate {DC_IP}"]`, `card.target: "Zz-Clock"`.
  - `shortTitle("Networking Basics — Reference")` → `"Networking Basics"`; `shortTitle("Zz Scanner")` unchanged.
- [ ] **Step 2: Run** `npx vitest run src/test/engines/manual/lookup.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/engines/manual/lookup.ts` per the Interfaces; move `isKeyCell` and `railTitle` (renamed `shortTitle`) here and import them back in `NoteTable.tsx` and `ManualRail.tsx`.
- [ ] **Step 4: Run** `npx vitest run src/test/engines/manual src/test/features/manual` — expect PASS.
- [ ] **Step 5: Commit** `feat(manual): lookup rows and inline-command rule in the engine`.

---

### Task 2: Inline commands, one copy hook, one status slot

**Files:**
- Create: `src/features/manual/useNoteCommand.ts`, `src/features/manual/InlineCommand.tsx`, `src/features/manual/useManualStatus.ts`
- Modify: `src/features/manual/ManualCommand.tsx` (use the hook; its status row moves to the slot), `src/features/manual/NoteView.tsx` (`Ctx` gains `base` and `section`; `InlinePart` renders `InlineCommand` for code passing `isInlineCommand`; log titles), `src/features/manual/ManualPage.tsx` (render the slot in the host row; clear it on note change)
- Modify: `src/audit/fixtures.ts` (add note `04-Foundations/Zz-Error-Lookup.md`: caption `**Table 1 — Zz login errors**`, head `Error | Means | Usually caused by | Do this | Card`, 6 rows; at least 3 action cells with placeholder commands incl. one with `-p '{PASS}'`, one row with no command; export its id in `AUDIT_NOTE_IDS.lookup`)
- Test: `src/test/features/manual/inlineCommand.test.tsx`

**Interfaces:**
- Consumes: `isInlineCommand`, `shortTitle` (Task 1).
- Produces:
  - `useNoteCommand(command: LibraryCommand, opts: { fill: boolean; output: boolean; base: FillBase }): { cmd: FilledCommand; copy(): Promise<"copied" | "guarded">; copyAndLog(): Promise<void>; banned: boolean; msf: { text: string; breach: boolean } | null; known: boolean }` — the body of today's `ManualCommand` copy/guard/exam/log logic, unchanged in behaviour, plus it writes its outcome to the status store.
  - `useManualStatus` (zustand): `{ text: string | null; tone: "ok" | "warn"; set(text: string, tone: "ok" | "warn"): void; clear(): void }`. Texts: `"Copied for {host}"`, `"Copied"` (no host), `"Copied and logged to {host}"`, the guard hint (tone warn), `"No previous note"` (Task 7).
  - `InlineCommand({ command, base }: { command: LibraryCommand; base: FillBase })` — a `<button type="button">` styled as inline code (`font-mono text-code text-fg`, dotted `--line-strong` underline, focus ring), showing the filled text with unresolved tokens `text-warn`, masked secrets masked. Click/↵ = `copy()`, ⌘↵ = `copyAndLog()`. `aria-label`: `"Copy command: {filled text}"`.
  - Log titles (the `title` on the `LibraryCommand` built for logging): block → `` `${shortTitle(note.title)}: ${block.title ?? section}` ``; inline in a table row of a lookup table → `` `${tableName}: ${key}` ``; inline elsewhere → `` `${shortTitle(note.title)}: ${section}` ``.

- [ ] **Step 1: Write failing tests** in `inlineCommand.test.tsx` (render `NoteView` the way `noteView.test.tsx` does, with a host whose IP is `192.0.2.10` and a credential `zzuser` / `Zz-Secret1`):
  - `inline placeholder command is filled and copyable`: a prose line with `` `nxc smb {TARGET_IP} --shares` `` renders a button named `Copy command: nxc smb 192.0.2.10 --shares`; clicking it puts that text on the clipboard mock; the status slot reads `Copied for <host short name>`.
  - `inline command masks PASS and copies it clear`: `` `nxc smb {TARGET_IP} -u '{USER}' -p '{PASS}'` `` shows `••••` (whatever the block uses) on screen and copies `Zz-Secret1`.
  - `single tokens stay plain code`: `` `--local-auth` `` renders a `code` element and no button.
  - `inline command obeys exam rules`: with an exam-sim engagement, an inline banned command (use one `classifyExam` marks banned in existing tests) is held back and the slot shows the banned line in warn.
  - `⌘↵ logs with the table title`: in a lookup table row, ⌘↵ on the inline command calls `logCommand` with title `Zz login errors: STATUS_ZZ_DENIED` and the status reads `Copied and logged to <host>`.
  - Update `noteView.test.tsx` expectations that read the old caption-row status to read the slot.
- [ ] **Step 2: Run** `npx vitest run src/test/features/manual` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** the hook (extract, do not rewrite), the store, `InlineCommand`, the `Ctx`/`InlinePart` wiring, the slot in `ManualPage`'s host row (`role="status"`, `text-meta`, right-aligned track; `text-accent` for ok, `text-warn` for warn; cleared when the note id changes), and the fixture note.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit -p .` — expect PASS.
- [ ] **Step 5: Commit** `feat(manual): inline commands fill and copy; one status slot`.

---

### Task 3: Lit row for table matches

**Files:**
- Modify: `src/features/manual/NoteTable.tsx` (each `tr` gets `data-row={i}`; the table root gets `data-table={anchor}` from a new optional `anchor` prop), `src/features/manual/NoteView.tsx` (pass the preceding caption's anchor to `NoteTable`), `src/features/manual/ManualPage.tsx` (after `markCurrent`, set `data-current-row` on `el.closest("tr")` and clear it elsewhere)
- Test: `src/test/features/manual/searchToSpot.test.tsx`

**Interfaces:**
- Produces: DOM contract used by Task 4 — `tr[data-row]` inside `[data-table="table-N"]`; the current match's row carries `data-current-row`.
- Style: `data-current-row` → `td` background `--surface-hi`, first cell `shadow-[inset_2px_0_0_var(--accent)]`; stacked rows: the same on the `tr` block.

- [ ] **Step 1: Write failing test** `match in a table lights its row`: open the long fixture note with `?q=access denied#table-1`; the `tr` containing `mark[data-current]` has `data-current-row`; after ⌥↓ to a match outside that row, the attribute moves.
- [ ] **Step 2: Run** `npx vitest run src/test/features/manual/searchToSpot.test.tsx` — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npx vitest run src/test/features/manual` — PASS.
- [ ] **Step 5: Commit** `feat(manual): the current match lights its table row`.

---

### Task 4: Answer card (A)

**Files:**
- Create: `src/features/manual/AnswerCard.tsx`
- Modify: `src/features/manual/ManualPage.tsx` (state `cardRow: LookupRow | null` from the current match's `[data-table]`/`tr[data-row]` looked up in `lookupRows(note)`; render the card between the match bar and the scroll pane; Esc order)
- Test: `src/test/features/manual/answerCard.test.tsx`

**Interfaces:**
- Consumes: `lookupRows`, `LookupRow` (Task 1); `useNoteCommand`, `InlineCommand` rendering conventions, `useManualStatus` (Task 2); `data-table`/`data-row`/`data-current-row` (Task 3).
- Produces: `AnswerCard({ row, base, onClose }: { row: LookupRow; base: FillBase; onClose(): void })`.
  - Layout (grid): line 1 `text-label` "Answer" + `text-meta text-muted` "{tableName}" ; line 2 key `font-mono` 16px (`text-heading` size with `font-mono`) `--fg`; line 3 means `text-body text-fg`; line 4 cause `text-meta text-muted` prefixed "Usually: "; then command rows (`CommandBlock` via `useNoteCommand`, `fill: true`), max 3 then a "+ n more" button; then, only when the action cell has words beyond its commands and punctuation (e.g. "or `faketime`", "disable … AND …"), the whole action cell as one `text-meta text-muted-2` line rendered with `InlineView` (its commands stay copyable there); then the card link ("Card: {title} ↗ Arsenal", opens the drawer, closes on first Esc per Task 7) when present. Surface: `bg-surface`, `border border-line`, `rounded-sm`, padding 3/4. No accent fill.
  - Keys inside the card: ↓/↑ move focus between command rows (and onto "+ n more"); ↵ copy; ⌘↵ copy and log (title `"{tableName}: {key}"`).
  - Esc while a card shows: closes the card only (the match bar stays); next Esc clears the search; next leaves (existing behaviour).

- [ ] **Step 1: Write failing tests** (fixture lookup note from Task 2, landing via `?q=` on a row key):
  - `card shows for a lookup row hit`: key, means, "Usually: …", and one button per command with filled text.
  - `card follows the row the current match is in`: a query matching two rows; ⌥↓ moves the card to the second row's key.
  - `card without commands`: landing on the fixture row with no command shows key/means/cause and no command rows.
  - `no card for prose or non-lookup tables`: landing on a match in prose → no element with name "Answer".
  - `Esc closes the card first`: first Esc removes the card and keeps the match bar; second Esc removes the bar.
  - `more than three commands collapse`: a row with 4 commands shows 3 and "+ 1 more"; activating it shows the 4th.
- [ ] **Step 2: Run** `npx vitest run src/test/features/manual/answerCard.test.tsx` — FAIL.
- [ ] **Step 3: Implement** `AnswerCard` and the `ManualPage` wiring.
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(manual): answer card for lookup-row hits`.

---

### Task 5: ⌘K Lookup group (B)

**Files:**
- Modify: `src/engines/manual/search.ts` (add `searchLookups`), `src/features/palette/search.ts` (`PaletteResult` command variant gains optional `lookup`; `searchPalette` returns `lookups`), `src/features/palette/Palette.tsx` (group first; → navigates for lookup commands; log title), `src/features/arsenal/ResultList.tsx` (optional group `lead`)
- Test: `src/test/engines/manual/search.test.ts`, `src/test/palette.test.tsx`

**Interfaces:**
- Consumes: `lookupRows`, `LookupRow` (Task 1); `manualSearchPath` (existing).
- Produces:
  - `searchLookups(query: string, notes: ManualNote[], max = 2): LookupRow[]` — rows with ≥1 command whose `key` or plain `means` matches `matchRegex(query)`; key matches before means matches; note order within each.
  - `ResultGroup.lead?: { code: string; text: string }` — rendered above the group's rows: `code` in `font-mono text-body text-fg`, `text` in `text-meta text-muted-2`; not an option, not focusable.
  - Lookup command result: `{ type: "command"; id: \`lookup:${noteId}:${anchor}:${row}:${i}\`; title: <command template>; command: LibraryCommand (title "{tableName}: {key}", template = the command, runFrom "attacker", os "any", source "field-manual"); msfMarker: false; lookup: { noteId: string; anchor: string } }`.
  - Group key `lookup-${noteId}-${anchor}-${row}`, no label, `lead: { code: key, text: plain(means) }`; all Lookup groups placed before the Arsenal groups.
  - → (ArrowRight at the end of the query) on a result with `lookup`: `navigate(manualSearchPath(lookup.noteId, query, lookup.anchor))`, `onClose({ handOff: true })`; hint shows "→ open in Manual" instead of "→ in card" for these rows.

- [ ] **Step 1: Write failing tests:**
  - `search.test.ts`: `searchLookups("skew", [note])` returns the row with `key "KRB_AP_ERR_SKEW"`; `lookup row without commands is not a Lookup hit`; max 2.
  - `palette.test.tsx`: typing the fixture key shows a group whose lead shows the key and means, then one option per command; ↵ on the first copies the filled command (host IP filled); ⌘↵ logs title `Zz login errors: <key>`; `→ on a lookup command opens the note at its row` (location becomes `/manual/<id>?q=…#table-1`, no Arsenal drawer opened).
- [ ] **Step 2: Run** `npx vitest run src/test/engines/manual/search.test.ts src/test/palette.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(palette): lookup rows as ⌘K results`.

---

### Task 6: Table column policy

**Files:**
- Modify: `src/features/manual/NoteTable.tsx`
- Test: `src/test/features/manual/noteView.test.tsx` (structure), audit screen `manual-long` (layout, Task 9)

**Interfaces:**
- Consumes: `lookupColumns` (Task 1) — reuse its header regexes for the action and cause columns on **any** table (not only lookups).
- Behaviour: action column `th`/`td` get `min-w-[32ch]`; the cause column gets `data-col="low"` and is hidden (`display:none` on th and td) when the table's container is narrower than 860px (`@container` on the table wrapper; the stacking measurement runs after the hide, so a table that fits without its cause column does not stack). Stacked rows: the key cell (column 0 when `isKeyCell`) renders as the row's heading line (`text-body font-semibold text-fg`, spanning both tracks, no column-name label).

- [ ] **Step 1: Write failing tests:** the action column header has class `min-w-[32ch]`; the cause column cells carry `data-col="low"`; in stacked mode (force `data-stacked` as existing tests do) the key cell has no visible column label and spans both tracks.
- [ ] **Step 2: Run** `npx vitest run src/test/features/manual/noteView.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `fix(manual): note tables keep the action column, drop the cause column first`.

---

### Task 7: Focus, keys and hints

**Files:**
- Modify: `src/features/manual/ManualPage.tsx`, `src/features/manual/ManualRail.tsx`, `src/features/manual/ManualCommand.tsx`, `src/ui/CommandBlock.tsx` (optional `copyTabIndex?: number`), `src/features/arsenal/useArsenalStore.ts` (`openCard(cardId, blockId, opts?: { from?: "manual" })`; when `from === "manual"` the drawer's first Esc closes it), the Manual's `?` shortcut list (wherever `ManualPage` defines it)
- Test: `src/test/features/manual/manualPage.test.tsx`

**Interfaces:**
- Consumes: `useManualStatus` (Task 2).
- Behaviour (each a test):
  - `filter Enter focuses the note`: type in the rail filter, ↵ → `document.activeElement` is the note pane.
  - `pane focus cue is the host-row hairline`: the pane has no `focus-visible:shadow-[inset_0_0_0_2px…]`; the host row's bottom border uses `--accent` while the pane has focus (`group-focus-within` or a `data-pane-focused` attribute).
  - `card link drawer closes on first Esc`: activate a card link in a note, Esc → drawer closed, still on the note.
  - `command block is one Tab stop`: Tab from the block goes past its Copy button (button has `tabIndex=-1`); ↵ on the block still copies.
  - `⌘[ with no history says so`: status slot reads "No previous note".
  - `hints`: at 1280 the hint line includes `[ ]` and ⌥H (raise their priority); "copy command" and "⌘↵" hints are absent on a note with no commands (block or inline).
  - `? list`: contains "M" (focus the note) and "⌥↓ ⌥↑"; the "/" key cap is not wider than other single-character caps (no `w-full`/stretch class).
- [ ] **Step 1: Write failing tests** as listed.
- [ ] **Step 2: Run** `npx vitest run src/test/features/manual/manualPage.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `fix(manual): focus follows intent; one Tab stop per command; hints`.

---

### Task 8: Clarify and minor fixes

**Files:**
- Modify: `src/features/manual/NoteView.tsx` (link labels), `src/features/arsenal/HostChip.tsx` (empty state, accessible name, list min-width), `src/engines/manual/search.ts` (`readable` cell separator), `src/features/manual/ManualPage.tsx` (loading line, rail track), `src/features/manual/ManualOutline.tsx` (h3s under the current h2 only)
- Test: `src/test/features/manual/noteView.test.tsx`, `src/test/hostChip.test.tsx`, `src/test/engines/manual/search.test.ts`, `src/test/features/manual/manualPage.test.tsx`

**Interfaces / behaviour (each a test):**
- `link shows the target's title`: `[[Zz-Scanner]]` resolving to note "Zz Scanner" renders "Zz Scanner"; a card link renders the card's title; an aliased link keeps its alias; an unresolved `[[Shell-Stabilization]]` renders "Shell Stabilization" (muted).
- `host chip with no host reads "No host"` with no "Host" prefix; with a host its accessible name **starts with** its visible text (assert `getByRole("button", { name: /^Host web-portal/ })` style per existing chip tests); the listbox `min-width` equals the trigger's width (style or class).
- `Manual line has no middle dots`: `searchManual` on a table-row match returns a `line` without `" · "`; cells are joined with `"  "` (two spaces) and the palette's stacked tag keeps them (`whitespace-pre-wrap` on that tag).
- `loading line after 300ms`: with notes pending, "Opening the Manual…" appears after 300ms (fake timers) and not before.
- `outline shows h3s of the current section only`.
- Rail track: `grid-cols-[clamp(200px,20vw,260px)_…]` (assert class).
- [ ] **Step 1: Write failing tests** as listed.
- [ ] **Step 2: Run** the four test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `fix(manual): link titles, host chip wording and name, loading line, outline`.

---

### Task 9: Audit screens and finish

**Files:**
- Modify: `audit/screens.ts` (add `manual-lookup-card`: `/manual/${AUDIT_NOTE_IDS.lookup}?q=<fixture key>#table-1`, ready `[aria-label='Answer']`; add `palette-lookup`: open ⌘K on a host, type the fixture key, ready the Lookup group's first option)
- Modify: `docs/superpowers/followups/` (new `2026-11-09-raven-manual-reading.md` for anything deferred)

- [ ] **Step 1: Run** `npm run audit:visual`. Expected: 0 failing checks on all `manual-*` and `palette-*` screens at 900/1024/1280/1440. Fix any failure in the owning component (not with an opt-out unless the README's rule allows it, with a reason).
- [ ] **Step 2: Run** `".claude/skills/impeccable/scripts/impeccable" detect --json src/features/manual src/features/palette src/ui/CommandBlock.tsx` — expect `[]` or each finding explained in the followups file.
- [ ] **Step 3: Run** `npx vitest run`, `npx tsc --noEmit -p .`, `npx eslint src` — all clean.
- [ ] **Step 4: Commit** `test(audit): Manual answer card and ⌘K lookup screens`.
