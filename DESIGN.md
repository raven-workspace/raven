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

  It is never decoration. It is the rest colour of an action only for a primary action (a section header's main add, a dialog's Save); every other action rests neutral.
- **Warn (`#e0a030`)** means state that needs you: dead, locked, over time, an unfilled placeholder, a failed save. It is also the colour of a destructive action *while hovered or focused, and in its confirm step*.
- **No red, anywhere.**

### Named Rules

- **One amber at rest.** At most one amber control at rest per screen. Destructive actions are neutral until hovered (see Components › Destructive actions).
- **Accent is meaning.** If removing the accent from an element loses no information, the element shouldn't have it.

## Typography

There are six roles and nothing else. Each is a token (`text-title`, `text-heading`, `text-body`, `text-code`, `text-meta`, `text-label`), and feature code uses only these.

The Manual is the one reading surface, and it adds two reading roles that nothing else may use: `text-read-title` (24 / 32, 600) for a note's own title, and `text-read` (15 / 26, 400) for a note's prose and lists, held to a 56ch measure (about 70 characters). In a note, section headings are `title` under a hairline, sub-headings, table captions and bold label lines are `heading` weight, inline bold is 500, and table cells are `body` at 22px leading.

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
- **No arbitrary sizes.** In `src/features/**` and `src/ui/**` a font size comes only from a type role (`@include type(<role>)`, or `var(--text-<role>)`): no literal `font-size`, and no `font` shorthand.
- **Warnings are never smaller than what they warn about.** Guard and warning lines are `text-meta` in `--warn`.
- **Uppercase is for sections, not fields.** A form field's label is `text-meta` in sentence case ("Timebox start"), in `--muted-2`. Uppercase `text-label` is only for section headings, so a field label and a section heading never look alike.
- **Data is never a label.** Column values, log kinds and service names use body, code or meta, never uppercase.

## Layout

### The grid rule

1. **Every row with two or more items, where any item varies in width, is a CSS grid with explicit tracks.** The pattern is `grid-template-columns: <fixed or max-content tracks> minmax(0, 1fr) <fixed or max-content tracks>`, in the component's own sheet. Exactly one `minmax(0,1fr)` track absorbs the slack, and it is the only one that truncates or wraps.
2. **Flexbox is allowed only for a single-line run of peers that must not wrap:** icon + label inside a button, a button group, a segmented control, the key and label of one hint. It lives inside the `src/ui` primitives (`Toolbar`, `ChipSet`), not in feature code.
   - Feature sheets (`src/features/**/*.scss`) don't use `display: flex` or `inline-flex`, `flex-direction`, `flex-wrap`, `flex-grow` (or a growing `flex`), or `justify-content: space-between`.
   - Use `grid` with `gap` for stacks, `minmax(0,1fr)` for the stretchy pane, and `ChipSet` for a wrapping set of independent chips.
3. **Rows align to the start.** Rows whose cells can grow use `align-items: start`; `align-items: center` is only for rows where every cell is guaranteed to be one line. A row's control stays on its title's line when the row opens.
4. **Glyph and icon tracks are fixed width** (`grid-template-columns: 16px minmax(0, 1fr) auto`), never `auto` around an icon.
5. **Siblings that sit side by side share their rows.** Kanban lanes, parallel columns and card grids use subgrid (or one shared header row), so every header has the same height whether its title wraps or not, and every lane's first card starts on the same line.
6. **Narrow behaviour is declared, not emergent.** Every view states what happens under 1000px: what stacks, drops or collapses. Use container queries on the pane when the pane is narrower than the window (drawers, split views).

### Spacing

The spacing scale has a 4px base, with steps of 4, 8, 12, 16, 24 and 32: `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl` and `--space-2xl` in tokens.css. Padding, margin and gap use only these (or their negatives, `calc(var(--space-sm) * -1)`), `0`, `auto` or a 1px hairline offset. Nothing else: no 2px, 6px, 10px or 20px. The few documented exceptions (the title bar's 94px traffic-light inset, the 6px hint gap) are listed in the convention test.

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

## Motion

Motion only explains a change: what opened, which tab is now selected. It is short, and nothing loops or performs (the lock screen is the one exception). The values live in `src/ui/motion.ts`.

- **Tabs.** The selected tab's mark is drawn once per tab list by `TabMarker` and glides to the new tab in 180ms (`cubic-bezier(0.16, 1, 0.3, 1)`): the surface and underline, the Payloads ring, the Arsenal category wash. Resizes move it without a glide. The new panel fades in over 120ms, opacity only, never moving. Shared `TabsContent` does this; a hand-rolled panel uses `usePanelFade`.
- **Sidebar.** The current section or host is lit by one `TabMarker` for the whole sidebar (`--surface-hi` and the accent bar). It slides to the new item in 180ms, between sections and hosts alike, on the rail too. The links draw no active background of their own.
- **Expand and collapse.** Content under a disclosure goes in `Collapse`: height and opacity open in 200ms and close in 150ms, and the parent's gap is part of the motion, so the rows below slide instead of jumping. While closing it is inert. Padding goes on `contentClassName`, not the wrapper.
- **Carets.** One right caret that turns 90° in 150ms (`DisclosureCaret`, or `CARET_TURN` on an `IconButton`). Never two icons swapped.
- **Drawers** (Arsenal `A`, Payloads `P`, Notes `N`, the host's stuck view `H`): slide 16px in from the right edge while fading (180ms), and back out on close (120ms), inert while leaving (`useDrawerPresence`). Going full screen slides the drawer out over the page. Notes and the stuck view share the right edge, so opening one slides the other out as it comes in.
- **Dialogs, ⌘K search included:** the backdrop fades (140ms) and the panel settles from 98% scale, growing from its top edge (160ms); closing takes 100ms. CSS classes `raven-overlay` and `raven-dialog`.
- **Full pages** (Arsenal, Manual, Payloads, Settings): the content under the title bar fades in when you arrive (`raven-page`, 140ms). The title bar never moves.
- **New content in a pane that stays** (a Manual note, an Arsenal drawer card or category, a Payloads generator): a 120ms fade (`useFadeOnChange`). Never keyed to typing or arrow keys: search results and the full-screen Arsenal's arrowed reading pane change instantly.
- **Not animated:** menus and pickers (they already have their own), the sidebar, content that swaps in place (Full checklist), and anything a keystroke repeats many times a minute.
- **Reduced motion.** No glide, slide, scale or height change. Opened content, new panels, pages and dialogs still fade in (120–140ms); sections and drawers close at once.

## The lock screen

The lock screen (and the one-time setup screen, which shares it) is the one place Raven performs. It is sparse, seen once per session, and has nothing to compete with, so it is the single exception to "accent is meaning" and "no decorative motion". Nothing here sets a precedent for other views.

- **Ciphertext field.** A canvas of faint hex pairs (`--line`, `--line-2`, rarely `--line-strong`) in JetBrains Mono, with a dithered clearing round the form. It decodes outward from the form once on entry (about 1s), then holds still.
- **Wordmark.** The full-width wordmark is the screen's only wordmark (the title bar carries none here). Each letter cycles through cipher glyphs, then snaps to its shape.
- **Pulse.** Each keystroke sends an accent ring out from the focused password field's centre. A wrong password sends a `--warn` ring and a small shake; a setup validation error sends the `--warn` ring.
- **Sweep.** On unlock, and when setup creates the vault, an accent ring clears the field outward from the password field and reveals the app (about 400ms). It plays over the app and never delays it.
- **Never blocks.** The password field is focused at once and accepts typing during the intro.
- **Reduced motion.** The field is drawn settled; there are no rings and no sweep.
- **Calm on failure.** The damaged-database restore panel has no field.

## Shapes

- Radius 6px for controls, 8px for panels, dialogs and cards, and full for chips.
- Borders are 1px.

## Components

All shared pieces live in `src/ui`. Feature code composes them and doesn't hand-roll its own version.

### Buttons and icon buttons

- **Tooltips.** One `Tooltip` (`src/ui`), on hover and on keyboard focus, under the app's single `TooltipProvider`, so moving along a toolbar opens the next tooltip at once. It is the only tooltip: shadcn's was removed, and lint keeps it from being re-added. A native `title` doesn't show on keyboard focus, so it never carries the only statement of an action or shortcut.
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
  - the action ("Mark untested", "Set the verdict (C, U, E or D on the row)") is in a Raven `Tooltip`, which keyboard focus opens too. Never a native `title`.
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

  A **set** of them (the Payloads drawer's host, OS, paste context, port, then callbacks, filter and tools) isn't a table: it flows like the status strip, as runs of borderless "Label value ⌄" triggers (the background shows on hover), 24px apart, wrapping only when there's no room, never forced into columns. Where each value came from is in its tooltip, not a line of text.

### Status strip and headers

- The status strip is a grid of labelled cells (`grid-auto-flow: column`, 24px gaps). Each cell is a label and a value, `nowrap`.
- Cells come in a fixed order of importance: timebox, rooted, flags, Metasploit lock, threads, cleanup, LHOST.
- When space runs out, secondary parts drop first ("of 23h 45m", then the progress bar), then whole cells in this order: Cleanup, Threads, the engagement name (host pages), Metasploit lock, LHOST. LHOST is copied often during an exam, so it outlasts the cells shown before it. Nothing wraps or ellipsizes mid-value.
- The strip carries no hint line.
- **Headers** (engagement, host, drawer): row 1 is the title and its actions; row 2 is the metadata line. On the engagement and host headers the actions are icon buttons right after the title (Edit `PencilSimple`; Archive `Archive`), never out at the pane's far edge where they lose what they act on; the title truncates first. Drawer headers keep `grid-template-columns: minmax(0, 1fr) auto` with the close button at the end.
- **A host page has no engagement header.** The status strip leads with the engagement's name (`body` 600, `--fg-2`, a link back to the board, truncated at 28ch); its details and actions stay on the engagement's own sections. The host's name is the page's only `title`, and the host header carries no rule of its own. Its Edit host pencil sits right after the name, not at the pane's far edge. Stuck? ends the work column's tab row on every tab, after that tab's own control.
- **Title bar:** its controls are chrome, not page buttons: borderless, with the `--surface-hi` background only on hover. The control for the page on screen (Manual, Settings) or an open drawer (Arsenal, Payloads) sits on `--surface` in accent. The controls sit on the right, with their right edge on the main content column's right edge (the same x where the page header's actions end below), in three runs set apart by 16px of space, never a divider:
  - references: Arsenal, Manual, Payloads (icon, word, inline key);
  - Search (icon, word, ⌘K);
  - the app itself: Shortcuts (`Question` icon), Lock and Settings, as icon buttons with the key in the tooltip. Shortcuts lists the page's own keys first (`usePageShortcuts`), then the keys that work everywhere; the `?` key opens it unless focus is in a surface with its own list (a drawer, the Manual, the palette) or a dialog. Pages carry no hint row of their own.
- **Drawers dock under the title bar** (`BELOW_TITLE_BAR`), never over it, so its controls stay whole and the window keeps its drag region. A modal panel with an overlay (Capture) covers the whole window.

### Navigation

- **Collapsed rail (56px):**
  - Section icons only, each centred in a fixed box. The key number is in the icon's tooltip ("Board · 1"), not on the rail; the expanded sidebar shows the numbers.
  - Hosts stay listed: the state glyph with a short name (first 4 characters, or the last octet) under it, and name and IP in the tooltip.
  - The current host is lit with a `--surface-hi` background and the accent bar: the sidebar's one sliding marker (Motion).
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
- **Don't** lay out feature code with flex (`display: flex`, `flex-direction`, `flex-wrap`, growth, `space-between`).
- **Don't** set a font size that isn't a type role, or anything under 12px.
- **Don't** join structured values with " · ", " — " or " → ", in the UI or in titles Raven generates. They're for prose only.
- **Don't** make an action a grey text link.
- **Don't** use amber at rest for an action, or more than one amber control at rest per screen.
- **Don't** put Delete in a persistent header.
- **Don't** put a bordered `Kbd` inside a bordered button, or an "esc" cap in a dialog corner.
- **Don't** use text glyphs (✓ ? ◐ ○ ▸ ▾ ⌄) as icons.
- **Don't** use a brand logo for a tool-agnostic action.
- **Don't** treat what already ships as approved.
