# Raven: the Arsenal as a command reference

Date: 2026-11-07. Status: draft for the user's approval.
Branch: `arsenal-reference`. Product record: `PRODUCT.md`.

**Inputs:**
- Critique: `.impeccable/critique/2026-11-07T05-33-14Z__src-features-arsenal.md` (23/40).
- Audit triage: `docs/superpowers/audits/2026-11-06-visual-audit-triage.md` (row 8, §6).
- Mockups (brainstorm, not committed), in `.superpowers/brainstorm/81834-1794030008/content/`:
  - `drawer-ranking.html`: B was picked for its grouped look, but the host-fit grouping in it is **rejected** (see §1).
  - `browse-layout.html`: A, three panes.
  - `font-pairing-v4.html`: Instrument Sans.

## 1. Intent

**What the Arsenal is.** It is the user's **full command reference**: every command they know how to run, organised so it can be found in seconds. It sits alongside the Field Manual vault, which holds the detailed write-ups of techniques and approaches. Together they are the user's personal hacking knowledge base. In the user's words, it is "the ultimate command reference that complements the field manual content."

**What it is not.** It is not a "what to do next" engine and not an uncheckable mirror of the checklists. The checklist and the host page's Next tab already guide next steps. The Arsenal never filters, folds, hides or reorders anything because of the host.

**What the host is for.** Picking a host (and a credential) **only fills** commands: IP, domain, DC, tool paths, user, password or hash. Search order depends on the query alone.

**Why this round.** The user hasn't used the Arsenal on a real engagement yet. Before the first one, the critique found three problems:
- **It produces wrong commands.** `{PASS}` is never filled, and a hidden host picker can silently retarget a command at another IP.
- **The browse page is a generic docs shell.** It opens on an empty "Pick a card." page with no search, and the Reporting filter is empty.
- **Cards and commands are kept apart.** In lists and search they sit in separate groups.

## 2. Goals, non-goals, anti-goals

**Goals**
- **The output is correct.** What gets copied is filled for the right host with the right credential, or the user is taken to the missing field first.
- **The full-screen Arsenal works like a knowledge base.** Three panes, search first, organised by category, and every card readable and navigable from the keyboard.
- **Cards and commands are mixed.** Wherever results or lists appear, cards and commands sit together under their category. The `card` label or the tool name tells them apart.
- **Drawer and ⌘K behave the same.** Enter copies everywhere, the selected row is visible, and ranking is by relevance to the query.

**Non-goals**
- Suggesting next commands for a host, in any form.
- Editing Field Manual content from Raven. The import stays read-only.
- New generators beyond "Transfer a file".
- The Report section.

**Anti-goals (failure even if it "works")**
- **Results change because a host is picked**, in order, grouping or visibility.
- **A command is copied with a literal `{PASS}`/`{…}`** without the user having been taken to that field first.
- **The host changes without the user doing it on purpose** (typeahead, a stray Tab).
- **A list grows into an Obsidian-style tall tree.** The user picked three panes specifically to avoid this.
- **A page or pane needs more than about 2 viewports of scrolling to find something.** Long cards are fine to read, but must be navigable by their contents strip and keys.

## 3. Decided by the user

1. **Purpose.** Full reference, host is fill-only, and no "next for this host" view. This is recorded in memory as `raven-arsenal-purpose`.
2. **Search results are grouped, for scanning.** The user chose the grouped look because "technically more text but better visual hierarchy and thus easier to scan". Groups are **categories**, never host fit.
3. **Cards and commands share a category group.** "If it's Active Directory, it goes under that category heading." The existing `card` label and the tool name are enough to tell them apart.
4. **Full-screen browse is three panes: categories, list, reading.** It replaces the folding tree, because "the tree gets long" problem is one the user already has in Obsidian.
5. **Copy guard.** If a placeholder is still unfilled, Enter or Copy moves focus to the first unfilled field instead of copying. A second Enter while focus is in that field, still empty, copies anyway.
6. **Category aliases.** Search matches category aliases as if they were the name. Searching "lateral movement" must find Pivoting cards and commands. The vault folder is `02-Cards/Pivoting`, while the playbook stage is "06 - Lateral Movement".
7. **Scope is everything in the critique**, correctness and reference structure in one round.
8. **Browse list (pane 2): cards first, then built-in commands under tool headings.** Field Manual commands are reached through their card, while search still returns them one by one.
9. **Raven gets its own interface font.** It's a sans serif that complements JetBrains Mono, which stays the font for commands. It replaces SF Pro, because that's the Mac system font and Raven should have its own look and feel. The user picked **Instrument Sans** from a side-by-side with IBM Plex Sans and Geist (§4.12).

## 4. Design

### 4.1 Categories: the Arsenal's one way of organising

- **The category set is the Field Manual's `02-Cards/*` folders.** Today that is:
  - AV-Evasion, Active-Directory, Client-Side-Attacks, Enumeration, Exploitation, Password-Attacks;
  - Pivoting, Post-Exploitation, PrivEsc-Linux, PrivEsc-Windows, Shells-and-Transfers, Web.

  Categories come from the import, so a new vault folder becomes a new category.
- **Display names are words, never folder slugs.** For example: "Active Directory", "Shells & transfers", "PrivEsc Windows". Use the existing `categoryLabel` from the drawer everywhere (browse currently prints raw slugs).
- **The category set is a fixed list of the 12 names in code.** Any extra vault folder found on import is added to it. *My call:* if a later vault drops or renames a folder, the built-ins that use it keep their category, and it is shown as long as it has items.
- **Every built-in command gets a category** from that set, both `source: "raven"` (115) and `source: "oscp-notes"` (253). *My call*, because a full reference can't leave out 253 commands. *Builder's call:* how it's stored (an explicit field per entry, or a per-data-file default with overrides). A test must fail if any built-in lacks a category or names one that isn't in the code list. "Lateral movement finds Pivoting" is tested against built-ins (`pivot.ts`), so it doesn't depend on an import.
- **Field Manual commands take their card's category.**
- **Aliases.** There is a small built-in map from category to alternative search terms. Search treats an alias match exactly like a match on the category name. It starts with:
  - Pivoting: "lateral movement", "tunneling", "port forwarding"
  - PrivEsc-Linux / PrivEsc-Windows: "privilege escalation", "privesc"
  - Shells-and-Transfers: "file transfer", "reverse shell"
  - Password-Attacks: "cracking", "spraying"

  Aliases are never shown as extra categories. *Builder's call:* any extra aliases that obviously fit.
- **Stages leave the Arsenal's navigation.** There is no Stage filter in browse; stages organise the checklist, categories organise the Arsenal. This also removes the empty Reporting filter and the "Lateral movement as a stage" oddity. Stage data stays on cards and commands for the checklist's use, and stage names stay searchable.
- **An empty category is never shown.** This applies to the left pane, and to an exam engagement whose rules hide every command in a category.

### 4.2 Search and ranking (shared by drawer, ⌘K and browse)

- **One search function serves all three surfaces.** It returns cards, commands and generators, grouped by category.
- **Relevance only.** Remove the host OS and stage boosts from `searchPalette` (`src/features/palette/search.ts`, `score()`). A match's weight depends on where it hits, highest first:
  1. title;
  2. tool or tags;
  3. category name or alias;
  4. template or body text.

  Within equal weight, keep a stable order (*my call:* alphabetical by title).
  Example: today "smb" ranks "Find credential files for client tools" first. After this change, commands with SMB in the title or tool rank above it, and it stays in the list.
- **Grouping.**
  - Results are grouped by category, and groups are ordered by their best match.
  - Inside a group, cards and commands are mixed and sorted by relevance.
  - Generators sit in their category, e.g. "Transfer a file" under Shells & transfers.
- **No folding, ever.** Every match is visible, so the user scrolls if there are many.
- **Exam rules still apply.** Banned commands are hidden, the Metasploit marker stays, and the search fails closed while rules are unknown. This is unchanged.
- **⌘K only:**
  - Engagement items (log entries, notes, credential labels) keep their own group below the Arsenal groups, because they aren't part of the Arsenal.
  - **Hosts are added** to that group (triage row 8: "the palette can't find hosts"). Enter on a host goes to its page.

### 4.3 Fill context: host chip and credential chip

These rules apply wherever commands are shown filled: drawer, ⌘K, browse and checklist-linked cards.

**Host chip**
- It shows the short host name and opens a picker with ⌥H or a click.
- It is **not in the Tab order.** Today the `opacity-0` `<select>` in `HostPicker.tsx` takes Tab focus and typeahead, which silently switches the host.
- Replace the invisible native select with a visible listbox in Ink styling. The audit already noted the native select doesn't match the mockup.
- When the host changes:
  - the chip and the IP in any visible preview flash once, briefly, respecting reduced motion;
  - chip overrides are dropped, as today.
- **On cards shown inline on the host page** (checklist-linked), the host chip is read-only: it shows the route's host and can't be changed there (*my call*). The drawer and ⌘K keep a live host chip, even on a host page.

**Credential chip (new)**
- It looks like `as LUMEN\svc_report · password ⌄`. It fills USER, DOMAIN and PASS or HASH together, from the one picked credential, which is already the only source of those tokens in `src/engines/checklist/fill.ts`.
- It opens a picker with a key (*my call:* ⌥C) or a click, and is not in the Tab order. The picker lists:
  - the engagement's credentials, each labelled with its kind (password, hash) and its tested state on the picked host;
  - "No credential".
- **One pick per host, shared.** The chip reads and writes the existing per-host pick store (`useCredPickStore`, `src/features/checklist/credPick.ts`), so the drawer, ⌘K, browse and the host checklist always fill with the same credential for a host (*my call*). Two surfaces disagreeing would be the bigger surprise.
- **No host picked.** The chip still works and defaults to the engagement's domain credential (`defaultDomainCred`), so DC and AD commands fill from `/arsenal` without a host. Today `useFillBase` drops the credential when there's no host, and that changes (*my call*).
- **Default credential.** The same default applies to the checklist, because it uses the same function. *My call:* keep the current default (`defaultCredFor`: the newest credential with a valid or admin attempt on this host, else the engagement domain default), but prefer a credential that has a password over a hash-only one when both are valid on the host.

  Why: in the critique, dc01 auto-picked the Administrator hash, so 6 of 11 blocks showed `{PASS}` with nothing to fill it.
- When the picked credential has only a hash, PASS stays unfilled, and the copy guard (§4.4) handles it. The chip says "hash", so the user can see why at a glance.
- **Secrets.** The preview shows a mask, and the copy sends the real value. This is the current behaviour.
- **Remove the separate PASS, HASH and CRED fill fields.** They only exist in ⌘K today and allow typing a password by hand. The credential chip replaces them. *My call:* a credential not in Raven gets added through Credentials or capture, not typed into a fill field.

**Fill fields** (the other tokens: LHOST, PORT, a file, etc.)
- Fields keep the order in which their tokens first appear in the commands. Editing a field never moves it. Today `Palette.tsx:143-145` appends overrides at the end.
- Filled and unfilled look different:
  - an unfilled field has an amber label and an amber outline;
  - an auto-filled field shows its value as normal text, not a faint placeholder.
- "DC (by name)" provenance appears once, on the DC_IP field, not under every block.

### 4.4 Copy guard

- Applies to Enter, ⌘↵, `c` and the Copy button, on every surface.
- **When the command still contains an unresolved token,** the first such field gets focus, and the hint line says "{PASS} not filled · ↵ again to copy anyway".
  - A second Enter while focus is in that field, still empty, copies.
  - For PASS or HASH, focus goes to the credential chip itself, with the picker **not** opened (*my call*). A second Enter copies anyway; Space or ⌥C opens the picker.
- **The "Copied" confirmation** names the host, for example "Copied for fs01". If tokens remain, it says how many in amber ("Copied · 1 placeholder left").
- ⌘K's preview marks unresolved tokens in amber, as cards already do.

### 4.5 The drawer (`A`)

- Opens to the search field with focus in it. With an empty query it shows the category list (name and count).
  - Enter or → on a category lists its cards and commands.
  - Typing searches.
- **Results follow §4.2**, grouped by category, with a 2px accent bar on the selected row (the same `ON` style browse uses). Arrow keys move the selection; focus stays in the input. Wire `aria-activedescendant`.
- **Keys:**

  | Key | Action |
  |---|---|
  | Enter | On a command: copy (copy guard applies). On a card: open it. On a generator: open it. |
  | → | On a command: open its card scrolled to that command, with that block outlined. Built-in commands have no card, so → opens the single command in the reading view. → is never a silent no-op. |
  | ⌘↵ | Copy and log. |
  | Esc | Step back (card → list → closed), as today. |
  | ⌥H / ⌥C | Host / credential picker. |

- **Header.** Search, the host chip, the credential chip and the full-screen icon each sit in their own grid track, so they never overlap. Today the host chip and "full screen" overlap ("…portfull screen").
- The full-screen control is an icon button with a label.

### 4.6 Full-screen browse (`/arsenal`): three panes

- **Top bar:** search, host chip and credential chip (§4.3).
- **Pane 1: categories.** A short, fixed list with counts. It never grows into a tree.
- **Pane 2: list.** Decided by the user:
  - The selected category's **cards come first**, alphabetical.
  - Then its **built-in commands, under small tool headings** (nxc, impacket, kerbrute…), alphabetical within each.
  - **Field Manual commands live inside their cards** in this list. Search still finds every single command (§4.2), and → opens the card at that block.
  - Headings are plain labels, never folding sections. Pane 1's count is cards plus built-in commands.
  - While a query is typed, pane 2 shows the search results grouped by category (§4.2) instead.
  - Pane 1 marks which categories have hits, and their hit counts.
- **Pane 3: reading.**
  - A **card** shows:
    - its title;
    - one line of meta (category, OS);
    - a **contents strip** with one entry per command block, which jumps to it, and highlights the current one while scrolling;
    - its blocks;
    - a link to the card's note in the Field Manual (*my call:* opens Obsidian with an `obsidian://` URL);
    - "Also in Raven", **folded by default**. It includes `oscp-notes` built-ins as well as `raven` ones (*my call*).
  - A **command** shows its title, tool, why line and filled block, plus "From card X" when it belongs to a card. This is an in-app link: drop the external-link glyph.
  - A **generator** opens in pane 3.
- **Opening state:** the last item read, else the first category with its first item. Never an empty "Pick a card." page.
- **Keys:**

  | Key | Action |
  |---|---|
  | `/` | Focus search |
  | ↑ ↓ | Move within a pane |
  | ← → | Move between panes |
  | `j` / `k` | Step through command blocks in pane 3 |
  | `c` or Enter | Copy the focused block (copy guard applies) |
  | ⌥H / ⌥C | Pickers |
  | Esc | Clear the search, then leave the page as today |

- **Widths.**
  - From 900px up: three grid tracks (*builder's call* on exact widths; categories narrow, list about 220–260px, reading takes the rest).
  - Below about 1100px, pane 1 may collapse to a compact control above pane 2 (*builder's call*). No sideways scrolling at any width from 800px.

### 4.7 Cards on every surface

The same reading view is used in the drawer, browse and checklist-linked cards:
- the contents strip;
- `j`/`k`/`c`;
- "Also in Raven" folded;
- the fill rules (§4.3);
- the copy guard (§4.4).

A drawer card opened with → from a command scrolls to that block and outlines it.

### 4.8 Transfer generator

- Lives in the Shells & transfers category, and opens in pane 3 or the drawer.
- Uses the host chip and credential chip from §4.3 instead of its own host select.
- **Fix:**
  - the footnote "copies the the target half" (`TransferGenerator.tsx:216`);
  - the Kali-side folder: the Windows tools folder setting must be a **Kali** path. Settings labels it as such and rejects a Windows-style path (`C:\…`) with a plain message.
- The 11 method pills: *builder's call* to group them (e.g. by direction or protocol) so no decision point shows more than about 6 at once.

### 4.9 Capture: `user:pass` intake (carried over from triage row 8)

Pasting `user:pass`, `DOMAIN\user:pass` or `user:hash` (NTLM) into capture or credential intake creates the credential, the same as other intake. Ambiguous input (e.g. a URL with a colon) is not treated as a credential (*builder's call* on the exact rules, with tests).

### 4.10 Accessibility (from the axe results)

- **Listboxes.** The drawer and ⌘K listboxes must not contain `h3` children. Use `role="group"` with `aria-labelledby` per category, inside a listbox, or an equivalent valid structure.
- **Scrollable command blocks.** A block with horizontal overflow is focusable (`tabIndex=0`), or wraps so it never scrolls sideways.
- **Header button names include the visible key hint,** or the hint is `aria-hidden` and the name matches the visible word (WCAG 2.5.3).
- **Focus is always visible.** No focusable element has `opacity: 0`.
- **Contrast.** Text in `--faint` that carries meaning (tool names, hints) meets 4.5:1. Use `--muted` or raise `--faint`. *Builder's call*, but it must pass axe.

### 4.11 Smaller fixes

- **Suggestion dropdown in ⌘K.** It must stay inside the dialog and not cover the key hints.
- **"card" label repetition.** The drawer currently prints "card" on every card row. Keep it; it's the agreed way to tell cards apart. Make it a quiet tag, not a word competing with the title.

### 4.12 Interface font

- Replace `--font-ui` (SF Pro, `src/styles/tokens.css:63`) with a self-hosted sans that complements JetBrains Mono. It's bundled with the app, so there are no network calls. **Face: Instrument Sans** (the user's pick), self-hosted as the variable font through `@fontsource-variable/instrument-sans`, which is how JetBrains Mono is already bundled.
- Load only the weights used. Give it metric-compatible fallbacks so text never flashes invisible or reflows.
- Update PRODUCT.md's Brand Commitments: interface font Instrument Sans, commands and data in JetBrains Mono.
- This is app-wide. Re-run the visual audit on every screen, because a width change can bring back wrapping bugs.

## 5. Constraints

- **Grid by default.** Use explicit tracks, and flexbox only for single-line runs (`PRODUCT.md` principle 5).
- **Ink theme.** One accent, no red, amber for warnings and unfilled values.
- **Real data.** The library and credentials come from the encrypted vault. Any change to stored data (e.g. new fields on stored library user data) needs a migration and a backup first. *Expected:* categories for built-ins live in code, not stored data, so no migration is needed. Confirm while planning.
- **Network.** No new network calls. `obsidian://` links are local.
- **Exam rules** keep failing closed.
- **Verification.**
  - `npm run audit:visual` covers:
    - drawer, ⌘K and browse, at 900, 1024, 1280 and 1440;
    - the new states: an empty-query category list, results for "smb" and "lateral movement", a long card with the contents strip, the credential picker open, and the copy-guard hint.
  - Add hard regressions to `audit/regressions.spec.ts` for:
    - host picker not in the Tab order;
    - Enter copies in the drawer;
    - the copy guard focuses the first unfilled field;
    - "lateral movement" finds Pivoting items;
    - no "Pick a card." empty state.
  - The implementer looks at rendered screens at several widths, and drives the critique's task end to end: "Windows host, SMB, have a password: get the command filled and copied."

## 6. Left to the builder

- How built-in categories are stored (§4.1).
- Extra aliases (§4.1).
- Exact pane widths and narrow-width behaviour (§4.6).
- The copy-guard hint wording, within the meaning above.
- The `user:pass` intake parsing rules (§4.9).
- Grouping of transfer methods (§4.8).
- How `--faint` contrast is fixed (§4.10).
