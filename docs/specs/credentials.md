# Raven: Credentials page, matrix with a credential dock

> **Frozen record, shipped** (written 2026-11-08, last revised 2026-11-09). This spec records the decisions and reasoning at the time. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

Date: 2026-11-08. Branch: `credentials-dock` (from `main` after PR #12). Binding conventions: **`DESIGN.md`**. This round changes presentation only. No data, engine or migration changes.

## 1. Why

The Credentials page has every function the owner needs, but it is about 4000px tall and says most things twice:
- every credential is a row in the Credentials table **and** a row in the Test matrix;
- every hash has a Crack button in the table **and** another in the Hashes section, which also repeats the secret and the type;
- the Credential routine (eight steps of nxc commands for one picked credential) is the longest block on the page, and it sits between the matrix and the lists;
- you can't see at a glance what we hold: passwords, hashes, tickets, usernames.

The owner called the test matrix the page's best part, and asked for tabs, a layout built around the matrix, no duplicate information, and an at-a-glance view of what we hold.

## 2. What the owner decided

- **Jobs.** All four matter about equally: see what works where; grab a secret; test a new credential; crack hashes.
- **A separate inventory.** The matrix does not become the only list. There's a separate Inventory tab.
- **Grouped by kind.** The inventory is grouped by kind (passwords, hashes, tickets and so on), so the group headers carry the counts.
- **Layout: "Matrix with a credential dock"**, locked on the impeccable decision page. The sketch is [cred-matrix-dock.html](https://github.com/raven-workspace/raven/blob/b78787e7b42921c700972ef82817a3474aab4a9f/docs/specs/mocks/cred-matrix-dock.html), and the build matches its arrangement.
  - Two tabs: **Matrix** and **Inventory**.
  - Selecting a credential opens a **dock** below the list, with everything about that one credential.

## 3. Goals

1. One place per fact. Each credential's secret, source, scope, state and actions show only in the dock. The matrix shows results; the inventory shows what we hold.
2. Crack lives in exactly one place: the dock of a hash.
3. The routine's commands are the selected credential's commands. There's no separate credential picker any more.
4. The page meets DESIGN.md's page-length rule. The matrix and the dock fit one viewport at 900×800: each scrolls inside itself, and the page doesn't scroll.
5. You can read what we hold at a glance: the Inventory groups' headers, plus the count on the Inventory tab.

## 4. Non-goals

- No change to engines, queries, types, the database or the command builders.
- No change to the host page's Host Credentials group, which also renders the test grid. It keeps its current behaviour: no selection, and no dock.
- No right-click menu (deferred app-wide).
- No new credential kinds or functions.

## 5. Anti-goals (a failure even if it works)

- The same value or action shown in two places on screen at once. The secret in the dock and a masked secret in an inventory row count as a duplicate. Inventory rows don't show the secret (see 6.3).
- The page scrolling as a whole to reach the dock.
- The dock jumping or resizing when you change selection. Its height is stable.
- Selection that follows the mouse (DESIGN.md Focus).

## 6. The design

### 6.1 Page frame

- **Section header row.** The tab list (Matrix, Inventory with its total) sits on the left. **Add credential** (primary) sits on the right, on the same line. It replaces the old "CREDENTIALS 12" heading.
- **Height.** Below the tab row, the section fills the remaining height of the main pane. It's split vertically into the list (the active tab) and the dock, with shadcn's **Resizable** (react-resizable-panels):
  - the owner can drag the divider, or focus it and use the arrow keys;
  - the split is saved per engagement;
  - each panel scrolls inside itself.
- **The dock is shared by both tabs.** It shows the selected credential, whichever tab you picked it in, and switching tabs keeps the selection.

### 6.2 Matrix tab

- **What stays:**
  - the legend, then the test grid as it is today: host column groups, service sub-columns, cell glyphs, the tried rows, and the cell popover on a cell click;
  - the sticky first column;
  - a sticky header row, so it stays visible as the grid scrolls.
- **Row headers become the selector.** A credential's row header (name, then type and scope) is a button.
  - Clicking it, or pressing Enter or Space on it, selects that credential.
  - The selected row gets DESIGN.md's selection treatment: `--surface-hi` across the row and the 2px accent bar on the row header only.
  - ↑ and ↓ move focus between row headers. Selection changes only on Enter, Space or a click.
- **Tried rows** (failed sprays that aren't credentials) stay muted and can't be selected.
- **Hidden credentials.** Credentials that can't be sprayed, such as krbtgt, machine accounts, uncrackable hashes and ownerless placeholders, aren't matrix rows, the same as today. A one-line note under the grid says "4 more credentials can't be sprayed: see Inventory". The count is every listed credential that isn't sprayable (`shown.creds` minus `isSprayable`); usernames don't count. It shows only when the count is above 0, and "Inventory" is a Button that switches tabs.
- **Empty states.** Keep today's texts ("No sprayable credentials yet…", "No host has scanned services yet…").

### 6.3 Inventory tab

One list, grouped by kind. Each group has a section-label header with its count. Empty groups collapse to nothing (DESIGN.md States: no empty headings). The groups, in this order:

1. **Passwords:** type `password`.
2. **Hashes:** type `hash`, not machine accounts. The list is built from `foldCrackedHashes(dedupeHashCaptures(...))` as today, so a hash with a linked plaintext folds into its password. A hash marked cracked with no linked plaintext stays. Hash rows have an extra **Crack** column with the crack status chip (uncracked, cracked or uncrackable). This is a different fact from State: an NTLM hash can be "valid" for pass-the-hash and still be uncracked.
3. **Tickets, keys and tokens:** types `ticket`, `key`, `token` and `other`.
4. **Machine accounts:** any type, as today (`isMachineAccount`). These never get a Crack tab: the passwords are machine-generated.
5. **Usernames:** today's UsernamesList, moved here as-is. It keeps the add input, Copy all, the access-grant tags, Add access and Delete. Usernames aren't selectable, because they have no secret and no dock content.

**Credential rows** (groups 1 to 4) are selectable rows, with the same selection behaviour as the matrix row headers. Their columns:
- **Credential.** The name, truncated with a `title`. An ownerless row shows the "owner unknown" chip and its matched users, as today.
- **Scope.** The scope, with its host underneath when it's local.
- **Source.** Free text, two lines at most.
- **State.** Today's StateChip: admin, valid, untested, dead or not sprayable.

The secret, the Crack, Convert, Copy and Edit buttons, and the Delete icon are **not** in the row. They live in the dock. Column drops by pane width follow today's policy: Source drops under 900px of pane, and Scope under 700px.

### 6.4 The dock

The dock is a bordered panel (`--surface`, 8px radius) below the list, as in the sketch.

**Header row** (`grid-cols-[minmax(0,1fr)_auto]`):
- On the left:
  - the credential name in `text-code` at heading size;
  - the type and scope as separate meta cells, never a "·" string;
  - the state chip. When it's valid or admin, the chip names where, e.g. "valid on sql01 MSSQL"; if there's more than one, it gives the first plus "+2".
- On the right:
  - the masked secret with Reveal and Copy icon buttons, in the order the Secret column policy sets;
  - Edit and Delete icon buttons (Delete neutral until hovered);
  - a fold `IconButton` that collapses the dock to its header row.
  - A placeholder secret shows "no secret" and no Reveal or Copy.

**Body:** two columns. Under 700px of pane, they stack.
- **Facts column** (fixed width, about 260px):
  - Source;
  - Scope, with its host when it's local;
  - Works on: the hosts and services where it's valid or admin, from the attempts, or "nothing yet";
  - for an ownerless credential, Matched users;
  - for a placeholder secret, the **Convert to access-only** button. This is the only place it appears.
- **Work column:** tabs inside the dock, shown by what applies to the credential.
  - **Crack.** Hashes that aren't machine accounts only. A sprayable hash (NTLM, pass-the-hash) gets both Crack and the test tabs; Crack comes first while the hash is uncracked, and after the test tabs once it's marked uncrackable. It holds:
    - the hashcat and john CommandBlocks (masked display, real copy, as today);
    - **Record plaintext** (primary), which opens today's CrackDialog;
    - **Mark uncrackable**, or **Reset** when the hash is marked uncrackable.
  - **Test.** Sprayable credentials only. It holds the routine's per-service steps: SMB, WinRM, RDP, MSSQL and SSH.
    - Each step is a row: the title, its **Done** toggle (the engagement checklist item, as today), then its commands.
    - Steps that don't apply show "Doesn't apply" muted and no commands, as today.
  - **Shares.** The `shares` step.
  - **Spray at usernames.** The `spray-users` step, including "Copy users.txt".
  - **Roast.** The `roast` step. The tab shows only when the step applies.
  - A credential with no applicable work tab (for example a ticket) shows only the facts column, spanning the width.

**When nothing is selected:**
- On first load, the newest sprayable credential with any test commands is selected. This is the routine's current fallback, kept, filtered explicitly to sprayable credentials. With no sprayable credentials, the newest credential of any kind is selected.
- With no credentials at all, the dock doesn't render, and the Matrix tab shows its empty state.
- **The selection disappears** when the selected credential is deleted, or folds away. A credential folds away when a hash is cracked into a password or deduped. Then the selection moves to the default, and the URL is rewritten with `replace`.
- **After Record plaintext**, the selection moves to the new password, the credential the hash folded into. The owner's next step is to test it.
- **Fold** collapses the dock to its header row, and the list takes the height. The dock is a collapsible Resizable panel: the Fold button calls its collapse and expand, and dragging it to its minimum collapses it too. The split and fold state are stored per engagement in localStorage.
- **Esc** while focus is inside the dock folds it. Esc closes overlays first, as everywhere.

**Deep link.** The selection and the tab live in the URL as search params on the section route: `?cred=<id>`, and `&tab=inventory` when Inventory is open (Matrix is the default). Changes use `replace`, not `push`, so Back leaves the section rather than stepping through selections. Leaving the section drops them. An unknown id falls back to the default.

### 6.5 Narrow windows (declared)

- **Under 1000px window:** the layout stays the same. The tab row keeps Add credential, which collapses to a `Plus` icon button with a tooltip only if the tab row would otherwise wrap.
- **Under 700px of pane:**
  - the dock's two columns stack, facts first;
  - the dock's work tabs scroll horizontally rather than wrap.
- **Height split.** By default the dock takes about 45% of the section's height. When open it's at least its header plus about 160px, and at most 70%. The list keeps at least 30%. On a short window (800px), both scroll inside themselves.

### 6.6 States

- **Loading and error:** today's `queryState` for the whole section.
- **Errors from mutations** (crack status, checklist Done, delete) show as `text-meta` warn lines inside the dock, where the action was. The same pattern as today.

## 7. Constraints

- DESIGN.md is binding:
  - grid over flex;
  - the six type roles;
  - Phosphor icon buttons with Raven `Tooltip`s;
  - no " · " joins in the UI. The sketch's "password · domain" is a sketch shortcut; the build uses separate cells.
- The visual audit and the conventions test must pass. Add audit screens for:
  - the Matrix tab with a password selected;
  - the Matrix tab with a hash selected (Crack tab);
  - the Inventory tab;
  - the dock folded.
- Keep the existing behaviour tests' intent. Tests that find Crack, Convert, Reveal and Copy in table rows move to the dock.
- `TestGrid` keeps working unchanged for `HostCredentialsFacts`. Selection is opt-in props: `selectedId?` and `onSelect?`.

## 7a. shadcn first (owner, 2026-11-09)

The owner asked to lean on shadcn wherever it saves reinventing a pattern or brings a good convention. This round uses:
- **Resizable:** the list and dock split, the fold (a collapsible panel), and the saved sizes.
- **Tabs:** the page tabs and the dock's work tabs. Already installed and used by the host page.
- **Table:**
  - the Inventory's rows, using shadcn's selected-row convention (`data-state="selected"` on the row);
  - the matrix's selected row uses the same attribute.
- **ScrollArea:** the Inventory pane and the dock's work column.
- **Separator:** the dock's hairlines.

DESIGN.md wins on conflict:
- shadcn's styling rules are overridden by Raven's grid rule, type tokens and Ink colours;
- pieces Raven already wraps (Button, IconButton, Input, Tooltip, Toggle, Dialog, EmptyState, Chip) stay the Raven versions, and lint enforces it.

The matrix keeps its native scroller, because it scrolls on both axes with a sticky header, a sticky first column and a measured fade.

## 8. Left to the builder

- Splitting files, e.g. `CredentialDock.tsx` and `InventoryList.tsx`, and retiring `HashesList.tsx` and `RoutineSection.tsx` into the dock.
- Exact dock heights within 6.5's bounds.
- The exact Resizable size units (percent or pixels) within 6.5's bounds.

## 9. My calls (the owner can overrule)

- Auto-select the newest sprayable credential on first load, rather than opening with no dock.
- The selection lives in the URL (`?cred=`).
- Arrow keys move focus, not selection; Enter or Space selects.
- Inventory rows hide the secret. Copy and Reveal are one click away in the dock, which keeps every value in one place.
- Usernames aren't selectable.
- Roast is a tab only when it applies, rather than a disabled tab.
- A sprayable hash gets both Crack and the test tabs, with Crack first until it's marked uncrackable.
- After cracking, the selection follows the hash to its new password.
- The tab lives in the URL next to the selection, and changes use `replace`.
- Inventory hash rows show State and Crack status as two columns, because they're two different facts.
