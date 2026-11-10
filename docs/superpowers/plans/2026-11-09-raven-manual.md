# The Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the owner's Field Manual reference notes (03-Tools, 04-Foundations, 05-Reporting) and show them in "the Manual", a full-screen reader opened with `M`, with ⌘K full-text search that lands on the matching spot, filled and copyable commands, resolved wikilinks and a remembered reading place.

**Architecture:** The existing import (`field_manual.rs` scan → `runImport` in `src/features/fieldManual/queries.ts`) also collects the three folders; a new pure engine `src/engines/manual/` parses notes (frontmatter, outline, blocks) and searches them; notes ride in the existing JSON snapshot (`FieldManualSnapshot.notes`, no schema change). UI lives in a new `src/features/manual/` (route `/manual`), reusing the card command fill/copy path, the copy guard, the ⌘K palette and the Arsenal drawer for card links. The Arsenal itself is not changed.

**Tech Stack:** React 19 + TypeScript + zustand + TanStack Query + react-router, Tauri 2 + Rust, vitest + Testing Library, Playwright visual audit.

**Spec:** `docs/superpowers/specs/2026-11-09-raven-manual-design.md`. Decision mock: `.impeccable/mocks/decision/fm-notes-home.html` (option B).

## Global Constraints

- Scope folders exactly: `03-Tools/`, `04-Foundations/`, `05-Reporting/` (recursive). Not `01-Playbook` pages, `06-Templates`, `00-Home` pages.
- Notes are read-only in Raven. No schema change (snapshot is JSON); an old snapshot without `notes` shows the Manual empty state.
- **No Arsenal regressions:** don't change the Arsenal drawer or browse behaviour or layout. The only Arsenal touch points: `useArsenalStore.openCard` is called (unchanged API) and ⌘K results gain a Manual group.
- Tests never copy the owner's vault content: synthetic notes only (RFC 5737 IPs, `*.example.test`).
- Markdown rendering is a safe parse-to-React path: no `dangerouslySetInnerHTML`, no raw HTML pass-through.
- CSS grid first, Ink tokens only (`--accent` for the current match and selection, `--warn` for warnings), no red; Instrument Sans for UI and prose, JetBrains Mono for code.
- Keyboard-first: every action has a key; focus always visible; single-letter keys follow `isFreeKey` and yield to open drawers (as the host page's J/H/F now do); ⌥ chords by `e.code`.
- Stage only your own files; no AI attribution trailers.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `cd src-tauri && cargo test`, `npm run audit:visual` (never with vitest running at the same time).

## Plan calls (owner can overrule)

- **Exam sims:** a command block in a note that `classifyExam` marks `banned` shows an amber "Not allowed in the exam" line and its copy goes through the copy guard's warn step (first press explains, second copies); `metasploit` blocks use the existing Meterpreter lock wording only when the template uses Meterpreter. The note text itself is never hidden.
- **Note id** = frontmatter `id`, else the file stem. **Folder group** from the path.
- **Anchors:** `##`/`###` headings get slug ids; a `**Table N — Name**` caption line gets `table-N` and appears in "On this page" as "Table N · Name".
- **Match:** the query is matched as a case-insensitive substring after trimming; `_` and spaces are equivalent (so `access denied` finds `ACCESS_DENIED`).
- **Reading place** persists across restarts in `localStorage` under `raven.manual.place` (`{ noteId, scrollTop }` only).

## Review Focus

1. **A very long note and a wide 5-column table at 900px.** Expect the note pane to scroll alone, the table to fit (wrapping cells, no page-level sideways scroll), the outline collapsed. (Task 3 audit + Task 6.)
2. **A search hit inside a table cell or a code block.** Expect the scroll to land on that row/block and the highlight to show there, not just on the nearest heading. (Task 4.)
3. **A wikilink to a heading of another note (`[[Note#Heading]]`) and an alias (`[[Note|label]]`).** Expect it to open the note scrolled to that heading and show the alias text. (Task 2.)
4. **Re-import while the Manual is open on a note that disappears.** Expect the first Foundations note to open with no error. (Task 3.)
5. **`M` or ⌘[ pressed while typing in the rail filter, or with the Arsenal drawer open over the Manual.** Expect typing to type and the drawer to keep its keys. (Task 3.)

---

### Task 1: Import and parse the notes

**Files:**
- Modify: `src-tauri/src/field_manual.rs` (`files()` collects `03-Tools`, `04-Foundations`, `05-Reporting` recursively), its tests
- Create: `src/engines/manual/types.ts`, `src/engines/manual/parseNote.ts`, `src/engines/manual/index.ts`
- Modify: `src/engines/fieldManual/merge.ts` (`FieldManualSnapshot.notes?: ManualNote[]`), `src/features/fieldManual/queries.ts` (`runImport` parses notes into the snapshot), `src/audit/fixtures.ts` + `src/audit/fakeApi.ts` (synthetic notes in the fake snapshot)
- Test: `src/test/engines/manual/parseNote.test.ts`, `src/test/engines/fieldManual/*` as needed, Rust test in `field_manual.rs`

**Interfaces:**
- Produces:
  ```ts
  export type ManualFolder = "foundations" | "tools" | "reporting";
  export interface OutlineEntry { id: string; text: string; kind: "h2" | "h3" | "table" }
  export interface ManualNote { id: string; file: string; folder: ManualFolder; title: string; body: string; outline: OutlineEntry[] }
  export function parseNote(relPath: string, text: string): ManualNote | null; // null when not in a Manual folder
  export function slug(text: string): string; // shared anchor slugger
  ```
  `body` is the Markdown after frontmatter (frontmatter parsed with the existing `src/engines/fieldManual/frontmatter.ts`). Title = frontmatter `title`, else the first `# ` heading, else the file stem.

- [ ] **Step 1: Failing tests.** `parseNote`: id/title/folder from a synthetic `04-Foundations/Zz-Errors.md` (frontmatter id `fnd-zz-errors`); title fallback to `# ` heading then stem; outline lists `##`, `###` and `**Table 2 — Kerberos**` as `{ id: "table-2", text: "Table 2 · Kerberos", kind: "table" }` in document order; duplicate heading texts get unique ids (`-2` suffix); a `02-Cards/…` path returns null. Rust: `scan` returns files under the three folders (nested too) and still the old ones. `runImport` (with a mocked `api.fieldManualScan`): snapshot has `notes` with the three folders' notes, cards unchanged.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx vitest run src/test/engines/manual src/test/engines/fieldManual` and `cd src-tauri && cargo test field_manual` → PASS; then `npm test`, typecheck, lint, `cargo test`.
- [ ] **Step 5:** commit `feat(manual): import Tools, Foundations and Reporting notes`.

### Task 2: Markdown blocks, links and the note renderer

**Files:**
- Create: `src/engines/manual/markdown.ts` (parse `body` into blocks), `src/engines/manual/links.ts`
- Create: `src/features/manual/NoteView.tsx` (renders blocks), `src/features/manual/ManualCommand.tsx` (a code block as a filled, copyable command)
- Modify: `src/engines/library/wikilinks.ts` only to expose the `#heading` part (add a `heading?: string` to the link piece; existing callers unchanged)
- Test: `src/test/engines/manual/markdown.test.ts`, `src/test/engines/manual/links.test.ts`, `src/test/features/manual/noteView.test.tsx`

**Interfaces:**
- Consumes: Task 1 `ManualNote`, `slug`.
- Produces:
  ```ts
  export type Inline = { text: string } | { code: string } | { strong: Inline[] } | { em: Inline[] } | { link: { target: string; heading?: string; label: string } };
  export type Block =
    | { kind: "heading"; level: 1 | 2 | 3 | 4; id: string; inline: Inline[] }
    | { kind: "paragraph"; inline: Inline[]; anchor?: string } // anchor: "table-N" on a table caption line
    | { kind: "list"; ordered: boolean; items: Inline[][] }
    | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
    | { kind: "code"; lang: string; title?: string; text: string };
  export function parseMarkdown(body: string): Block[];
  export type LinkTarget = { kind: "note"; noteId: string; heading?: string } | { kind: "card"; cardId: string } | { kind: "none" };
  export function resolveLink(target: string, notes: ManualNote[], cards: CardMeta[]): LinkTarget; // note first, then cardForLink
  ```
  Heading ids from `slug` (same ids as the outline). Code fence info like ```` ```bash title:"Kali" ```` → `lang: "bash"`, `title: "Kali"`.
- `NoteView` props: `{ note: ManualNote; notes: ManualNote[]; cards: CardMeta[]; hostId: string | null; engagementId: string; query?: string }`. Links: note → `navigate("/manual/<noteId>#<heading>")`; card → `useArsenalStore.getState().openCard(cardId)`; none → muted text. Code blocks with `{PLACEHOLDER}` render through `ManualCommand`, which builds a `LibraryCommand` `{ id: "manual:<noteId>:<n>", title: title ?? note.title, tool: first word, template: text, os: "any", runFrom: "kali", goals: [], source: "field-manual", exam: classifyExam(text) }` and renders with the same component and fill path the Arsenal card view uses for a command (`fillLibraryCommand` + `CommandBlock`), copy through the copy guard, ⌘↵ copy-and-log via `logCommand`. Plain code blocks without placeholders render as `CommandBlock` with a Copy button and no fill. Exam rule per the plan call.

- [ ] **Step 1: Failing tests.** `parseMarkdown`: each block kind from a synthetic note, including a pipe table with inline code and `**bold**` in cells, `\|` escaped pipes, a fenced block with `title:"Kali"`, nested emphasis, a list. `resolveLink`: `[[Zz-Errors]]` → note; `[[Zz-Errors#Core Concept]]` → note + heading `core-concept`; `[[Some-Card]]` → card; `[[Missing]]` → none; alias label preserved. `NoteView`: a note link navigates with the heading hash; a card link calls `openCard`; an unresolved link renders muted text, not a link; a placeholder command fills from a fixture host (`198.51.100.20`) and ↵ on it copies; a banned command in exam-sim shows the amber line and the first copy is held. No `dangerouslySetInnerHTML` (grep test on the new files).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** focused tests → PASS; `npm test`, typecheck, lint.
- [ ] **Step 5:** commit `feat(manual): render notes with filled commands and resolved links`.

### Task 3: The Manual page, `M`, reading place and history

**Files:**
- Create: `src/features/manual/ManualPage.tsx`, `ManualRail.tsx`, `ManualOutline.tsx`, `useManualStore.ts`, `useManualNotes.ts`
- Modify: `src/App.tsx` (route `manual` and `manual/:noteId`), `src/features/vault/VaultGate.tsx` (title-bar button "Manual" with `M` hint, between Arsenal and Payloads; global `M` key), `PRODUCT.md` (Keyboard table + Arsenal-and-search section: one line each for the Manual)
- Test: `src/test/features/manual/manualPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `useManualStore` (zustand, `persist` to localStorage key `raven.manual.place`): `{ place: { noteId: string; scrollTop: number } | null; history: { noteId: string; scrollTop: number }[]; setPlace(p); push(p); back(): { noteId; scrollTop } | null }` — only `place` persists; `history` is session-only.
- `useManualNotes()` → `{ notes: ManualNote[]; status: "ready" | "empty" | "never-imported" }` from `useFieldManual()`.
- Layout per the mock: rail (groups Foundations, Tools, Reporting; alphabetical; filter field, `/` focuses it; ↑↓ moves, ↵ opens), centre note (scrolls alone; prose max about 760px, tables and code full width), right outline (current section marked from scroll position; ↵/click scrolls). Grid: `rail 260px | note minmax(0,1fr) | outline 220px`; below 1100px the outline collapses (hidden, reachable via a "On this page" disclosure at the top of the note).
- Keys on the page: `M` from elsewhere opens `/manual` at `place` (or the first Foundations note); `Esc` leaves to where the owner came from (same pattern as the Payloads Workbench, `location.key === "default"` → `/`); `⌘[` goes back one note in `history` and restores its scroll; `[` / `]` previous / next section in the outline. `M`, `[`, `]` and ⌘[ never fire while typing or with the Arsenal/Payloads/Notes drawer open. Hint line lists the page's keys.
- States: never imported / no notes → empty state ("The Manual holds your Field Manual's Tools, Foundations and Reporting notes.") with a link to Settings → Field Manual; remembered note missing → first Foundations note, no error.

- [ ] **Step 1: Failing tests.** `M` on the dashboard opens `/manual` on the remembered note at its scrollTop; first visit opens the first Foundations note; rail filter narrows by title and `/` focuses it; ↵ on a rail item opens the note and pushes history; ⌘[ returns to the previous note and scroll; `Esc` returns to the previous route; `M` while typing in a field types; `M` with the Arsenal drawer open does nothing; remembered note missing after a snapshot change → first Foundations note; no notes → empty state with the Settings link; the title bar shows Manual between Arsenal and Payloads.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run src/test/features/manual` → PASS; `npm test`, typecheck, lint.
- [ ] **Step 5:** commit `feat(manual): the Manual page, M, reading place and history`.

### Task 4: Search lands on the spot

**Files:**
- Create: `src/engines/manual/search.ts`
- Modify: `src/features/palette/search.ts` (`PaletteContext.notes?: ManualNote[]`; results gain `{ type: "manual"; id; title; noteId; anchor?: string; line: string }`), `src/features/palette/Palette.tsx` (Manual group after commands/cards; ↵ navigates to `/manual/<noteId>?q=<query>`), `src/features/manual/NoteView.tsx` + `ManualPage.tsx` (match bar and highlight)
- Test: `src/test/engines/manual/search.test.ts`, `src/test/features/manual/searchToSpot.test.tsx`, palette tests

**Interfaces:**
- Produces: `searchManual(query: string, notes: ManualNote[], max = 8): { noteId: string; title: string; anchor?: string; line: string; inTitle: boolean }[]` — title matches first, then body matches in note order; one hit per note (its first match), `anchor` = the nearest preceding outline id; `line` = the matching source line trimmed to ~120 chars, Markdown markers stripped. Matching per the plan call.
- In the note: with `?q=`, every match in rendered text (paragraphs, table cells, code) is wrapped in `<mark>`; the first match after `anchor` (or the first) is current, scrolled into view and styled with the accent; others quieter. Match bar above the note: query, "match n of N", ⌥↓ / ⌥↑ (by `e.code`) move the current match; `Esc` first clears the match bar (removes `q`), then leaves. "No match in this note" when N = 0.

- [ ] **Step 1: Failing tests.** `searchManual`: title hit ranks before body hit; `access denied` finds `STATUS_ACCESS_DENIED` in a table row and reports `anchor: "table-1"`; a code-block line matches; no match → []. Palette: Manual results appear after command/card results under a "Manual" label; ↵ navigates with `?q=`. Note: the match inside a table cell is the current `<mark>` and is scrolled into view (assert `scrollIntoView` called on it); ⌥↓ moves to the next match and updates "match 2 of N"; `Esc` clears the bar first, a second `Esc` leaves.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** focused tests → PASS; `npm test`, typecheck, lint.
- [ ] **Step 5:** commit `feat(manual): ⌘K finds note text and opens it at the match`.

### Task 5: Visual audit and docs

**Files:**
- Modify: `audit/screens.ts`, `audit/regressions.spec.ts` (and fixtures in `src/audit/fixtures.ts`: a long synthetic note with a 5-column wide table and 3+ tables, a tool page with placeholder commands, a note with all link kinds)
- Modify: `docs/superpowers/followups/` (new `2026-11-09-raven-manual.md` for anything deferred)
- Create: `.impeccable/surfaces/src-features-manual.md` (surface brief: Mode Read; the chosen mock; the reading view's rules) — no direction contract in source.

- [ ] **Step 1:** Add audit screens at 900, 1024, 1280, 1440: Manual on a long note; Manual opened from search with the match bar; Manual empty state; Manual with the Arsenal drawer open over it (card link). Keyboard audit: `M` opens it, `/` focuses the filter, ⌘[ back, `Esc` leaves.
- [ ] **Step 2:** `npm run audit:visual` → read the report and Read the new screenshots at 900 and 1440; fix any gate failure in the Manual components (never in the Arsenal); add a regression per fix; re-run until 0 gate failures.
- [ ] **Step 3:** run the impeccable detector over `src/features/manual` (`impeccable detect --json src/features/manual`), fix real findings.
- [ ] **Step 4:** `npm test`, typecheck, lint, `cargo test` → all pass. Commit `chore(manual): audit coverage and surface brief`.
