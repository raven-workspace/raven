---
version: 1
slug: "src-features-manual"
primary_target: "src/features/manual"
related_targets: ["src/engines/manual", "src/features/palette/Palette.tsx"]
---

# The Manual (Field Manual reading view)

Mode: Read. Owner: one pen tester, keyboard-first, ADHD/autism (low noise, stable layout), Raven beside Kali at 900px and up.
Jobs: open the right note by name or by the phrase on screen, read it at the spot, run its commands for the host in view.
Spec: docs/superpowers/specs/2026-11-09-raven-manual-design.md. Chosen mock: .impeccable/mocks/decision/fm-notes-home.html (option B, "Its own place: the Manual").

## Direction contract

THESIS: A reader, not a library. One note at a time, at full height, with the way back always one key away. Refuses the category default of a docs site (breadcrumbs, cards of articles, a search page) and of folding long notes into the Arsenal drawer.

OWN-WORLD: Ink, unchanged: true black, hairlines, one lime accent for the current note, the current section and the current match; amber only for "No match in this note", unfilled placeholders and exam locks. Instrument Sans for prose at a 760px measure, JetBrains Mono for commands, codes and paths. No raised surfaces except command blocks.

STORY: The owner reads an error on Kali, presses ⌘K, types the phrase and lands on that row of the note with the match lit and a match bar above the note. Or presses M and is back where they stopped reading. Card links open the Arsenal drawer over the note; note links open in place and ⌘[ returns.

FIRST VIEWPORT: Title bar with Manual current. Left rail (260px): filter, then Foundations, Tools and Reporting by title, the open note lit. Centre: a fixed header row with the host chip and its IP (or "No active engagement"), the match bar when searching, then the note scrolling in its own pane. Right (from 1100px): "On this page", headings and numbered tables, current section marked. Footer: the hint line.

FORM: Three columns, rail / note / outline; the outline folds into an "On this page" disclosure at the top of the note under 1100px. Prose keeps its measure; tables, code and commands take the pane's width. A table that can't fit its widest code or path stacks each row as name/value lines in two tracks instead of squeezing columns. Short code tokens (40 characters or fewer, no spaces) never break inside.

Signature interaction: a ⌘K hit opens the note at the match (current match solid accent, others quiet), ⌥↓ ⌥↑ step through matches, the first Esc clears the bar and the second leaves.

States: loading (blank pane, hint line only), never imported or imported before the Manual (empty state with Field Manual settings), imported with no notes (empty state), load failure (error state with Retry), remembered note gone (first Foundations note, no error).

Keys: M opens (and on the Manual focuses the note pane), / filters the rail, ↵ copies the focused command, ⌘↵ copies and logs, ⌘[ previous note, [ ] previous and next section, ⌥H host, ⌥↓ ⌥↑ matches, Esc back.

FINISH: audited at 900, 1024, 1280 and 1440 (long note, search landing, tool page with filled commands, card drawer over the note, empty state) with no gate failures; detector clean over src/features/manual.
