---
name: Raven
description: Ink: a keyboard-first, true-black work surface for penetration testing, with one accent used only for meaning.
colors:
  bg: "#000000"
  fg: "#ffffff"
  fg-2: "#e8e8e8"
  muted: "#a8a8a8"
  muted-2: "#c4c4c4"
  faint: "#8a8a8a"
  line: "#1f1f1f"
  line-2: "#2a2a2a"
  line-strong: "#3a3a3a"
  surface: "#0b0b0b"
  surface-hi: "#111111"
  accent: "#c6ff00"
  warn: "#e0a030"
typography:
  title:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  heading:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.08em"
rounded:
  sm: "6px"
  md: "8px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  icon-button:
    size: "28px"
    rounded: "{rounded.sm}"
    textColor: "{colors.fg-2}"
  icon-button-hover:
    backgroundColor: "{colors.surface-hi}"
    textColor: "{colors.fg}"
  button:
    height: "32px"
    rounded: "{rounded.sm}"
    textColor: "{colors.fg-2}"
    typography: "{typography.body}"
  button-row:
    height: "28px"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
  chip:
    height: "22px"
    rounded: "{rounded.full}"
    padding: "0 8px"
    typography: "{typography.label}"
  kbd:
    height: "20px"
    rounded: "4px"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-2}"
  input:
    height: "32px"
    rounded: "{rounded.sm}"
    backgroundColor: "{colors.bg}"
    typography: "{typography.body}"
---

# Design System: Raven

## Overview

Raven is the owner's only tool open beside the attack VM, often in a window narrower than the screen, often against an exam clock. The owner has ADHD and autism. Every convention here serves one goal: **nothing needs parsing**. A glance finds the value, the action and the state.

These are rules, not suggestions. What ships today is not the reference: where the code and this document disagree, the code is wrong. New work follows this file, and `npm run audit:visual` plus `src/test/conventions.test.ts` enforce the mechanical parts.

## Colors

The Ink palette is unchanged: true black, hairlines, and one accent.

- **Accent (`#c6ff00`)** means something, every time. It marks:
  - selection and the current item;
  - held access (user, root, valid);
  - confirmed facts;
  - focus.

  It is never decoration, and never the rest colour of an action.
- **Warn (`#e0a030`)** means state that needs you: dead, locked, over time, an unfilled placeholder, a failed save. It is also the colour of a destructive action *while hovered or focused, and in its confirm step*.
- **No red, anywhere.**

### Named Rules

- **One amber at rest.** At most one amber control at rest per screen. Destructive actions are neutral until hovered (see Components › Destructive actions).
- **Accent is meaning.** If removing the accent from an element loses no information, the element shouldn't have it.

## Typography

There are six roles and nothing else. Each is a token (`text-title`, `text-heading`, `text-body`, `text-code`, `text-meta`, `text-label`), and feature code uses only these.

| Role | Size / line | Weight | Font | Use |
|---|---|---|---|---|
| title | 20 / 28 | 600 | UI | Page and entity titles (engagement, host, settings page) |
| heading | 15 / 22 | 600 | UI | Section, panel and drawer headings; a finding title in the editor |
| body | 14 / 20 | 400–500 | UI | The default: rows, buttons, inputs, menu items, table cells |
| code | 13 / 20 | 400 | Mono | Commands, IPs, hashes, identifiers, timestamps, payloads |
| meta | 13 / 18 | 400 | UI | Helper text, secondary row lines, hint labels, warnings, empty-state text, field labels |
| label | 12 / 16 | 600, uppercase, +0.08em | UI | Section labels only |

### Named Rules

- **The floor.** Nothing is below 12px. Only `text-label`, `Chip` and `Kbd` use 12px. Anything read as a sentence, a value or a warning is at least 13px.
- **No arbitrary sizes.** No `text-xs`, and no `text-[Npx]`, in `src/features/**` or `src/ui/**`.
- **Warnings are never smaller than what they warn about.** Guard and warning lines are `text-meta` in `--warn`.
- **Uppercase is for sections, not fields.** A form field's label is `text-meta` in sentence case ("Timebox start"), in `--muted-2`. Uppercase `text-label` is only for section headings, so a field label and a section heading never look alike.
- **Data is never a label.** Column values, log kinds and service names use body, code or meta, never uppercase.

## Layout

### The grid rule

1. **Every row with two or more items, where any item varies in width, is a CSS grid with explicit tracks.** The pattern is `grid-cols-[<fixed or max-content tracks>_minmax(0,1fr)_<fixed or max-content tracks>]`. Exactly one `minmax(0,1fr)` track absorbs the slack, and it is the only one that truncates or wraps.
2. **Flexbox is allowed only for a single-line run of peers that must not wrap:** icon + label inside a button, a button group, a segmented control, the key and label of one hint. It lives inside the `src/ui` primitives (`Toolbar`, `ChipSet`), not in feature code.
   - `flex-col`, `flex-1`, `flex-wrap`, `justify-between` and `grow` are not allowed in `src/features/**`.
   - Use `grid` with `gap` for stacks, `minmax(0,1fr)` for the stretchy pane, and `ChipSet` for a wrapping set of independent chips.
3. **Rows align to the start.** Rows whose cells can grow use `items-start`; `items-center` is only for rows where every cell is guaranteed to be one line. A row's control stays on its title's line when the row opens.
4. **Glyph and icon tracks are fixed width** (`grid-cols-[16px_minmax(0,1fr)_auto]`), never `auto` around an icon.
5. **Siblings that sit side by side share their rows.** Kanban lanes, parallel columns and card grids use subgrid (or one shared header row), so every header has the same height whether its title wraps or not, and every lane's first card starts on the same line.
6. **Narrow behaviour is declared, not emergent.** Every view states what happens under 1000px: what stacks, drops or collapses. Use container queries on the pane when the pane is narrower than the window (drawers, split views).

### Spacing

The spacing scale has a 4px base, with steps of 4, 8, 12, 16, 24 and 32. Nothing else: no `gap-0.5`, `gap-2.5` or `gap-5`.

| Between | Gap |
|---|---|
| Inside a control | 8 |
| Controls in a group | 8 |
| Rows in a list | 0 (hairline) or 8 |
| Groups in a panel | 16 |
| Sections | 24 |
| Page padding | 24 (16 under 1000px) |

### Sizes

| Element | Height |
|---|---|
| Inputs, selects, toolbar buttons | 32 |
| In-row buttons, icon buttons, segmented controls | 28 |
| List rows (minimum) | 36 |
| Two-line list rows (name + meta) | 44 |

Nothing interactive is under 24px. Controls that share a row share a height.

### Page length

A section view fits its primary job in one viewport at 900×800, and the whole page in two. Past that, it splits into tabs or gets an in-page index.

## Elevation & Depth

- Depth is hairlines (`--line`, `--line-2`) and the two surfaces (`--surface`, `--surface-hi`).
- The only shadow is on floating menus and popovers: `0 12px 32px rgba(0,0,0,.6)`.
- No glows, gradients or glass.

## Shapes

- Radius 6px for controls, 8px for panels, dialogs and cards, and full for chips.
- Borders are 1px.

## Components

All shared pieces live in `src/ui`. Feature code composes them and doesn't hand-roll its own version.

### Buttons and icon buttons

- **Tooltips.** One `Tooltip` (`src/ui`), on hover and on keyboard focus, under the app's single `TooltipProvider`, so moving along a toolbar opens the next tooltip at once. Feature code never imports shadcn's tooltip (lint enforces it). A native `title` doesn't show on keyboard focus, so it never carries the only statement of an action or shortcut.
- **IconButton.** A 28×28 box with a 16px Phosphor icon (regular weight). It has no border at rest, `--surface-hi` on hover, and the focus ring on focus. An `aria-label` and a tooltip are required; the tooltip names the action and its shortcut ("Copy · ⌘C").
- **Icon or text.**
  - Universal verbs are icons:
    - Copy (`Copy`), Edit (`PencilSimple`), Delete (`Trash`);
    - Reveal and Hide (`Eye`, `EyeSlash`);
    - Open (`ArrowSquareOut` or `CaretRight`), Expand (`ArrowsOut`), Close (`X`);
    - Add (`Plus`), when a heading names the noun;
    - Lock (`Lock`), Settings (`Gear`);
    - sort order: `SortAscending` for oldest first and `SortDescending` for newest first. The button shows the icon for the current order and toggles it, with the order named in its tooltip and `aria-label`.
  - Text is used for:
    - domain verbs with no universal icon (Crack, Rule out, Mark removed);
    - the one primary action of a view (Add credential, Save);
    - dialog footers.
- **Brand icons** (the logos in `src/assets`) appear only where the thing is literally that tool or OS: the Metasploit lock, the Linux and Windows OS chips and pickers, and steps that run on Kali. Tool-agnostic actions get a Phosphor icon. Cracking, for example, isn't hashcat, because john cracks too.
- **One hover state.** A control has one hover treatment and one focus ring. Never two outlines stacked.
- **Shortcut hints inside a control.** A shortcut shown inside a bordered button is plain `--muted` code text with no border of its own. The bordered `Kbd` cap is only for keys standing alone.

### Row actions

- Row actions sit in a fixed-width **ActionCell** on the right, always visible, in a fixed order: the row's domain verb (text, at most one), then Copy, then Edit, then Delete.
- The column keeps its width, so nothing shifts.
- A later round may add a right-click menu for rarer actions. The icon rules leave room for it.

### Destructive actions

- In rows, Delete is a neutral `Trash` icon in `--muted`. It turns `--warn` only on hover or focus, and in its confirm dialog.
- Entity-level Delete (engagement, host) lives in the Edit dialog, not in a persistent header. Archive can stay in the header.
- Every destructive action keeps its confirmation, plus undo where it's cheap.
- One treatment app-wide.

### Hint line

One `HintLine` component; feature code never builds hint strings.

- Each hint is a unit, `[Kbd] label`, with 6px between the key and the label, `nowrap`, and the label in `text-meta` `--muted-2`.
- Hints are separated by 24px of space: no middots, bullets or dividers.
- A single line that never wraps. Each hint has a priority. When the container is too narrow, the lowest-priority hints drop out, and a final `?` hint opens the full list.
- At most 5 hints visible. The primary action comes first and Esc/close last.
- **Kbd:** 20px tall, at least 20px wide, 12px JetBrains Mono, `--fg-2` on `--surface`, with a `--line-strong` border.
  - Modifier and arrow keys are symbols (⌘ ⌥ ⇧ ↵ ⇥ → ←).
  - Named keys are words in Title case (`Esc`, `Tab`, `Space`).
  - A range is one cap: `⌥1–6`.
- Shortcuts also live in the tooltips of the controls they trigger, so hint lines stay short.

### Dialogs and overlays

- Every dialog, drawer and overlay has a close `IconButton` with an `X` icon in its top-right corner, with "Close · Esc" in the tooltip. There is no "esc" key-cap button.
- Esc always closes the topmost overlay.
- Footer buttons are text: secondary on the left, primary on the right.

### Tables and lists

Each table declares its column policy; automatic layout never decides.

| Column | Width | Overflow |
|---|---|---|
| Identifier (credential, host, path) | `minmax(16ch, 3fr)` | One line, truncated with an ellipsis and a `title` |
| Short value (type, scope, kind, state) | `max-content` | Never wraps |
| Composite (scope + host) | n/a | Never a "·" string. Two lines in one cell (value, then meta), or two columns |
| Free text (source, notes, title) | `minmax(0, 2fr)` | The only column that may wrap, to 2 lines at most |
| Secret | `max-content` | A fixed 8-dot mask, never wraps. Reveal and Copy are icon buttons in their own tracks |
| Actions | Fixed | Never wraps; see Row actions |
| Number / time | `max-content` | `tabular-nums` |

- Header text is `text-label` and never wraps. A column is never narrower than its header.
- When its pane is narrow, a table drops its lowest-priority columns, in an order declared per table, or switches to a stacked list. It never squeezes every column. Drops use container queries on the pane, not the window, because the sidebar makes the pane narrower than the window.
- **Master–detail dock** (Credentials): selecting a row docks its detail below the list; the dock's height is stable across selections, it folds to its header, and the selected item's secret and actions appear only there.

### Chips

- One `Chip`: 22px tall, 12px text, 8px horizontal padding, full radius.
- Variants:
  - `default`;
  - `accent`: held access, confirmed, valid;
  - `warn`: dead, locked, error.
- Chips are for state. Metadata (OS, kind, sub-label) is text in the metadata line, or the OS brand icon.
- No fact appears as a chip more than once per screen.
- A chip never sits in a track that can't contain it.
- **A status chip as a toggle.** Where a compact state flips in place (a service verdict, a privesc vector's status), the chip itself is the control:
  - a bare `button` wraps the chip and is the 28px target (`min-h-7`), with an `aria-label` naming the subject and its state;
  - the action ("Mark untested", "Set the verdict (C, U or D on the row)") is in a Raven `Tooltip`, which keyboard focus opens too. Never a native `title`.
  - Anything with more than two states, or not a state, is a `Button` or a `ToggleGroup`.

### Secondary options and disclosure

- **No grey text links for actions.** Everything clickable is one of:
  - a `Button`;
  - an `IconButton`;
  - a selectable list row with a hover background;
  - a `Disclosure`.

  Underlined text is only for a link to another place, inside prose.
- **`Disclosure`:** a full-width row at least 28px tall, with a caret icon, the label in `text-body` with its count ("Don't fit here (6)"), and `aria-expanded`. Space and Enter toggle it.
- **Fact groups** (host page) keep one header open or folded: the caret on the left (it only rotates), then the title as a section label. Folded, the summary sits on the line below the title. Each summary phrase reads on its own: a count before its noun ("3 services", "0 working") or a labelled value ("entry: CouchDB on 3003"). Never a bare number or an icon standing in for a word.
- **Alternatives** (other payloads that fit, other choices) are a visible list of selectable rows. They are never a middot-joined sentence.
- **Context pickers** (host, credential, OS, paste context, port) are bordered Select triggers:
  - 28px tall;
  - a `text-meta` prefix, the value in `text-body`, and a full-opacity 12px caret;
  - in the Tab order.

  An unknown required value shows an amber "Pick one" inside the control.

### Status strip and headers

- The status strip is a grid of labelled cells (`grid-auto-flow: column`, 24px gaps). Each cell is a label and a value, `nowrap`.
- Cells come in a fixed order of importance: timebox, rooted, flags, Metasploit lock, threads, cleanup, LHOST.
- When space runs out, secondary parts drop first ("of 23h 45m", then the progress bar), then whole cells in this order: Cleanup, Threads, Metasploit lock, LHOST. LHOST is copied often during an exam, so it outlasts the cells shown before it. Nothing wraps or ellipsizes mid-value.
- The strip carries no hint line.
- **Headers** (engagement, host, drawer) use `grid-cols-[minmax(0,1fr)_auto]`. Row 1 is the title and its actions; row 2 is the metadata line. The title gets the slack track. Under 1000px, actions collapse to icon buttons before the title truncates.
- **Title bar:** every destination uses the same control style. The controls sit on the right, with their right edge on the main content column's right edge (the same x where the page header's actions end below). Order: Arsenal, Manual, Payloads, Search, Lock (with the `Lock` icon), then Settings last as a `Gear` icon button.

### Navigation

- **Collapsed rail (56px):**
  - Section icons only, each centred in a fixed box. The key number is in the icon's tooltip ("Board · 1"), not on the rail; the expanded sidebar shows the numbers.
  - Hosts stay listed: the state glyph with a short name (first 4 characters, or the last octet) under it, and name and IP in the tooltip.
  - The current host is lit with a `--surface-hi` background and the accent bar.
  - Add host is a `Plus` icon button at the end of the host list.
- **Expanded sidebar:** Add host is an icon-only `Plus` button on its own, below the host list, aligned in the glyph column.

### States

- **Loading:** nothing for 150ms, then `LoadingState`: skeleton rows shaped like the content, or "Loading credentials…" in `text-meta`. A pane is never blank for more than 300ms.
- **Error:** `ErrorState`, with:
  - a title naming what failed ("Couldn't load credentials");
  - one sentence on what to do;
  - a Retry button;
  - the raw error in a collapsed Details disclosure.
- **Empty:** `EmptyState`, with a title, one sentence, and the primary action or its shortcut. An empty sub-section collapses to one line; it doesn't render an empty heading.

### Command block

One `CommandBlock` everywhere a command appears:
- boxed `text-code` on `--surface`;
- a Copy `IconButton` in a fixed right track;
- an optional `text-meta` label above;
- unfilled placeholders in `--warn`.

### Focus

- The focus ring is 2px solid `--accent` with a 2px offset. On an element that is already accent-bordered, the ring is 2px `--fg`, so focus never looks like selection.
- Focus, selection and current each look different:
  - focus: the ring;
  - selection: `--surface-hi` plus a 2px accent left bar;
  - current navigation item: the left bar only.
- Every interactive control is reachable with Tab, or belongs to a composite widget with documented arrow keys.
- **Selection never follows the mouse.** A click or the keyboard sets the selection, and it stays put. Hover gives only a light highlight. It never changes what's selected or what the detail pane shows, so the mouse can travel over other items to reach the selected item's fields.

## Do's and Don'ts

### Do:
- **Do** lay out with CSS grid and explicit tracks, with one `minmax(0,1fr)` track per row.
- **Do** use the six type roles, at 13px or more for anything read.
- **Do** use Phosphor icon buttons for universal verbs, with a tooltip and an `aria-label`.
- **Do** keep row actions visible in a fixed-width action column.
- **Do** align side-by-side siblings on shared rows (subgrid).
- **Do** declare what every view does under 1000px.
- **Do** keep each hint's key and label together, with 24px between hints.

### Don't:
- **Don't** use `flex-col`, `flex-1`, `flex-wrap`, `justify-between` or `grow` in feature code.
- **Don't** use `text-xs` or arbitrary `text-[Npx]` sizes, or anything under 12px.
- **Don't** join structured values with " · ", " — " or " → ", in the UI or in titles Raven generates. They're for prose only.
- **Don't** make an action a grey text link.
- **Don't** use amber at rest for an action, or more than one amber control at rest per screen.
- **Don't** put Delete in a persistent header.
- **Don't** put a bordered `Kbd` inside a bordered button, or an "esc" cap in a dialog corner.
- **Don't** use text glyphs (✓ ? ◐ ○ ▸ ▾ ⌄) as icons.
- **Don't** use a brand logo for a tool-agnostic action.
- **Don't** treat what already ships as approved.
