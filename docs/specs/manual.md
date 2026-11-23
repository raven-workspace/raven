# Raven: the Manual (Field Manual reference notes)

Date: 2026-11-09. Part 2 of the owner's personal hacking knowledge base in Raven; part 1 was the Arsenal (cards). Decision mock: `docs/specs/mocks/fm-notes-home.html` (option B chosen).

## 1. Why

The owner's Field Manual vault holds more than the cards Raven imports today. The reference notes explain how things work under the hood: error-message lookups, networking basics, "is this normal?" tables, decision trees, per-tool syntax pages and report-writing guidance. Mid-engagement the owner opens the right note in Obsidian, either by name or by searching the exact phrase on screen (an error string, a flag, a privilege name). Raven should hold these notes so the lookup happens where the work happens, without leaving the app.

## 2. Owner decisions (2026-11-09)

- **Scope:** `04-Foundations/` (22 notes), `03-Tools/` (60 notes) and `05-Reporting/` (4 notes). Not `01-Playbook/` as readable pages, not `06-Templates/`.
- **Finding a note:** both by name and by searching a phrase. A search hit opens **the note at that spot**, scrolled to the match and highlighted.
- **Where it lives: its own place, "the Manual"**, not inside the Arsenal. Reasons, in the owner's words: the Arsenal opens as a half-width drawer by default, and a note selection jumping to full screen would be jarring, especially when opened by mistake; option A's risks are worse than B's; and A risks regressions in an interface that was just tuned.
- **Opening the Manual without a search** returns to the last note read, at the same scroll position.

## 3. Goals

1. **Import.** The existing Field Manual import also reads `03-Tools/`, `04-Foundations/` and `05-Reporting/`. Notes are read-only in Raven; edits stay in Obsidian. The same Settings action imports them, and the existing drift report covers them. The snapshot (`field_manual.snapshot` JSON, migration 0009) gains the notes; no schema change. An old snapshot without notes shows the Manual's empty state until the next import.
2. **The Manual page.** A full-screen page (its own route), opened by **`M`** from any unlocked screen (when no field has focus and no dialog is open, following the existing single-key rules) and by a title-bar button **between Arsenal and Payloads** ("Manual" with its `M` hint). **`Esc`** goes back to where the owner came from, as the Payloads Workbench does. Layout (from the mock):
   - left rail: three groups, Foundations, Tools and Reporting, each listing its notes by title, with a filter field (`/` focuses it);
   - centre: the note, prose at a comfortable measure (about 760px), tables, code and command blocks using the full centre width, scrolling inside its own pane;
   - right: "On this page", the note's headings and each named table (e.g. "Table 1 · SMB / NTLM status codes"), with the current section marked; selecting an entry scrolls to it.
3. **Search.** ⌘K searches the notes' full text as well as titles. Note results are labelled "Manual", show the matching line, and ↵ opens the note scrolled to that match. In the note, a match bar shows the query and "match n of N", with **⌥↓ / ⌥↑** for next and previous matches; the current match is highlighted in the accent, the others more quietly. `Esc` clears the match bar before it leaves the page.
4. **Commands in notes.** Code blocks with `{PLACEHOLDER}` tokens fill exactly like cards (current host, engagement, Settings, Toolkit) and copy the same way: ↵ copies the focused command, ⌘↵ copies and logs, through the same copy guard (unfilled tokens hold the first copy back). 59 of the 60 tool pages use placeholders.
5. **Links.** `[[wikilinks]]` (about 1,450 across these notes) resolve by the Field Manual's naming:
   - to another Manual note → open it in the Manual (a heading anchor scrolls to that heading);
   - to a card → open that card in the Arsenal drawer over the Manual, so the reading place is kept;
   - to anything unresolved → plain muted text, never a dead link.
6. **Reading place.** The Manual remembers the last note and its scroll position, and `M` returns there. A search hit always wins over the remembered place.

## 4. Non-goals and anti-goals

**Non-goals**
- Surfacing notes automatically from context (e.g. "related notes" on a host). The owner did not ask for it.
- Editing notes in Raven.
- `01-Playbook/` pages, `06-Templates/`, `00-Home/` pages as readable notes.
- Changes to the Arsenal's layout or behaviour beyond letting a card link open it and ⌘K listing Manual results.

**Anti-goals**
- Any regression in the Arsenal drawer or full-screen browse.
- A jump in layout when opening, searching or following links: the Manual opens full-screen directly and stays stable.
- Noise: no decorative chrome, one accent (Ink), amber only for warnings, no red.
- Fabricated or copied lab data: fixtures stay synthetic (RFC 5737 IPs, `*.example.test`), and the owner's vault content is never copied into the repo or tests (tests use small synthetic notes).

## 5. States and ranges

- **Content:** 86 notes; 4 to about 600 lines each; up to 13 tables per note; tables up to 5 columns with long cells; about 1,450 wikilinks; no images, callouts or diagrams in these folders today (if one appears, render it as plain text rather than failing).
- **No vault path or never imported:** an empty state that says what the Manual holds and links to Settings → Field Manual.
- **Imported before this feature:** the same empty state, telling the owner to re-import.
- **No search match:** "No match in the Manual" in ⌘K; in the note, the match bar says "No match in this note".
- **Remembered note gone after a re-import:** open the first Foundations note instead, without an error.
- **Narrow windows (900–1024px):** the outline column may collapse first; the note keeps at least a readable width; nothing scrolls the page sideways.

## 6. Constraints

- Stack and structure as today: import plumbing in Rust (`src-tauri/src/field_manual.rs` collects files), parsing and merging in TypeScript (`src/engines/fieldManual/`), UI in a new `src/features/manual/`.
- Reuse, don't duplicate: the card fill and copy path (`fillLibraryCommand`, the copy guard, `logCommand`), the existing ⌘K palette, `HintLine`, the Ink tokens, `ChipPicker`/drawer conventions where they apply.
- CSS grid first; Ink tokens only; keyboard-first: every action has a key, focus is always visible, and the hint line lists the page's keys.
- Data safety: no schema change is expected (the snapshot is JSON); if one becomes necessary, an appended migration with backup first.
- Offline: no network calls.
- Tests: import (synthetic vault fixtures), wikilink resolution, search-to-spot, fill and copy, reading-place memory, keyboard flows; the visual audit gains the Manual at 900, 1024, 1280 and 1440, including a long note and a wide table.

## 7. My calls (the owner can overrule)

- **Card links open the Arsenal drawer over the Manual** rather than navigating away, so the reading place is kept.
- **The reading place survives app restarts** (stored locally as the note id and scroll offset: no engagement data).
- **The title-bar order** is Arsenal, Manual, Payloads, Search, Lock.
- **`/` filters the rail** by title; full-text search stays in ⌘K.
- **The outline column collapses first** at narrow widths.
- **Following a link inside the Manual** opens the linked note in place; **⌘[** returns to the previous note at its spot (a short in-Manual history). `Esc` always leaves the Manual to where the owner came from; it never steps back through notes.
- **⌘K ranking:** Manual hits come after commands and cards for the same query, title matches before body matches; a body hit shows its matching line.
- **Wikilink resolution reuses** the existing `splitWikilinks` / `cardForLink` logic (`src/engines/library/wikilinks.ts`), extended to resolve Manual notes.

## 8. Left to the builder

- The Markdown renderer (a small, safe Markdown-to-React path that handles headings, tables, code blocks with titles, bold/italic, lists and wikilinks; no raw HTML).
- How notes are indexed for ⌘K full-text search (size is small: about 14,000 lines).
- How the match highlight and match bar are implemented.
- Exact rail grouping order within each group (alphabetical by title unless the notes' frontmatter offers an order).
