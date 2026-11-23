# The Manual, reading round — design

> **Frozen record, shipped** (written 2026-11-09). This spec records the decisions and reasoning at the time. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

Date: 2026-11-09. Branch: `manual-reading` (already holds the spacing, typography, output-block and box-drawing font commits).
Sources: the critique `.impeccable/critique/2026-11-10T03-57-16Z__src-features-manual.md` (28/40), the structure mock
[manual-structure.html](https://github.com/raven-workspace/raven/blob/b78787e7b42921c700972ef82817a3474aab4a9f/docs/specs/mocks/manual-structure.html), and the decisions appended to `.impeccable/surfaces/src-features-manual.md`.
The owner chose: inline commands first, scope "everything", answer card (A) **and** ⌘K lookup rows (B); not the rail on `/` (C).

## 1. Inline commands (critique P1)

Inline code in a note that is a command is filled for the host and copyable, like a code block.

- **Which inline code is a command:** it contains a `{PLACEHOLDER}` (`/\{[A-Za-z][A-Za-z0-9_]*\}/`) or it contains a space
  (`sudo ntpdate {DC_IP}`, `ip -br addr`). A single token (`--local-auth`, `faketime`, `STATUS_LOGON_FAILURE`) is not.
- It renders as JetBrains Mono, filled from the host in view, unfilled tokens in `--warn`, masked secrets masked (copied in
  clear), as one focusable unit. ↵ copies, ⌘↵ copies and logs. The copy guard and the exam rules (banned techniques,
  Metasploit lock) apply exactly as they do to code blocks.
- Feedback for an inline copy (and for every Manual copy) goes to **one status slot** at the right of the Manual's host
  row: "Copied for dc01", "Copied and logged to dc01", or the guard's hint in `--warn`. It never shifts the note.
- Log titles say where the command came from: a code block `"{note}: {fence title or section}"`; an inline command in a
  table row `"{table name}: {key cell}"`; inline in prose `"{note}: {section}"`. `{note}` is the title without a trailing
  " — Reference".
- The audit fixtures gain a lookup note whose "Do this" cells hold inline commands with placeholders (the audit never saw them).

## 2. Lookup rows (shared by A and B)

A **lookup table** is a note table whose first column is key cells (the existing `isKeyCell` test: a short code, flag or
path) and which has an action column whose header is `Do this`, `Do`, `What to try next` or `Fix` (case-insensitive).
Optional columns by header: means (`Means`, `Means for an attacker`, `What it means`), cause (`Usually caused by`,
`Usual cause`), card (`Card`). A lookup row carries: note id, its table's anchor (`table-N`) and name, row index, key text,
means, cause, the action cell, the commands found in the action cell (§1's rule), and the card link if any.

## 3. Answer card (A)

When a ⌘K landing or ⌥↓/⌥↑ makes the current match one inside a **lookup-table row**, that row is pinned as a card between
the match bar and the note's scroll pane. Card: the key in mono (16px), means as the lead line, cause muted, the action's
commands as filled command rows (at most 3, then "+ n more" which ↓ expands), the action's leftover prose as short
connectors, the card link marked "↗ Arsenal". ↵ copies the focused command, ⌘↵ copies and logs, ↓/↑ move between
commands. Esc order: card, then search, then leave. A match in prose, a heading, a code block or a non-lookup table shows
no card. The card's position is fixed above the note scroll; the source row stays lit in the table.

Every match inside a table row (lookup or not) lights its row: `--surface-hi` and a 2px accent bar on the row's first
cell (stacked: on the row block).

## 4. ⌘K lookup rows (B)

⌘K gets a **Lookup** group, first in the list when it has hits, at most 2 rows' worth. A hit is a lookup row whose key or
means matches the query. It shows the key in mono and the means line as a lead, then one result row per command in its
action cell. Those command rows behave as every ⌘K command: the preview below fills them, ↵ copies, ⌘↵ copies and logs
(title "{table name}: {key}"), ⇥ edits a missing value, ⌥H/⌥C pick host/credential. → on a lookup command opens the note
at that row (where the answer card shows). A lookup row with no commands is not a Lookup hit (the Manual group still finds it).

## 5. Remaining critique fixes

- **Tables (P1):** an action column never gets squeezed: it has a 32ch floor. The cause column is the first to go: hidden
  when the note pane is narrower than 860px (container query) before any stacking. Stacked rows show the key cell as the
  row's heading line (body, 600, `--fg`), not as a "Code:" name/value line.
- **Focus and keys (P2):** ↵ in the rail filter opens the note and puts focus in the note pane. The pane's focus cue is its
  host row's bottom hairline in `--accent`, not an inset frame. A card opened from a note link closes on the first Esc.
  A command block is one Tab stop (its Copy button is out of the Tab order; ↵ on the block copies). ⌘[ with no history
  says "No previous note" in the status slot. The hint line keeps `[ ]` and ⌥H at 1280; "↵ copy command" and "⌘↵" show
  only when the note has commands. The `?` list includes M (focus the note) and ⌥↓/⌥↑; its "/" cap is not stretched.
- **Clarify:** a resolved link shows the target's title (note title or card title), an unresolved one its target with
  hyphens as spaces. With no host the host chip reads "No host" alone (no "Host" prefix). The HostChip's accessible name
  starts with its visible text (WCAG 2.5.3). The ⌘K Manual line separates table cells without " · ".
- **Minor:** loading shows "Opening the Manual…" (muted) after 300ms instead of a blank pane. The outline lists h3s only
  under the current h2. The rail is `clamp(200px, 20vw, 260px)`. The host picker list is at least as wide as its trigger.

## Not in scope

The rail on `/` (C). Anything in the vault. Stored data (no migrations).
