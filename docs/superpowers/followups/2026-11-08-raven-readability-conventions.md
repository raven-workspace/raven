# Readability conventions round: follow-ups

Left open when the round closed (2026-11-08). The conventions test (`src/test/conventions.test.ts`) and the audit gate
(`audit/README.md`) both pass with nothing pending and no opt-outs.

## Off-scale spacing in files no task touched

The off-scale-spacing rule only covers `src/features` and `src/ui`, and every file there is on the scale. The only off-scale
spacing left is in the dev-only component gallery, `src/dev/UiGallery.tsx`, which no task touched:

- `py-5`, `py-[5px]`, `py-3.5`, `py-[3px]`;
- `px-[18px]`;
- `gap-2.5`, `gap-1.5`, `gap-[18px]`;
- `mb-2.5`, `mb-1.5`, `mt-[3px]`.

The gallery isn't in release builds. Either bring it onto the scale and add `src/dev` to the rule, or leave it out on purpose.
The runtime `off-scale-spacing` audit check reports nothing on any screen.

## Split the Credentials page

Credentials is about 4000px tall, which breaks the page-length rule. Splitting it (tabs or sub-pages for the matrix, the
routine and the hashes) changes the information architecture, so it's a round of its own. The spec's non-goals defer it.

## Right-click menu

The owner deferred a right-click context menu (spec non-goals). Row actions stay as icon buttons for now.

## Smaller items found while turning the gate on

- **Silent errors on Arsenal browse.** Under `?audit=error` the browse page shows "No host" and "No credential" in its
  pickers and says nothing about the failed loads. `payloads-workbench~error` and `transfer-generator~error` are the same.
  These are reported (`silent-error`), not gated.
- **Credentials `Hashes` section** has no empty-state text when there is no data (`missing-empty-state`, reported).
- **Scrollbar gutter on the engagement pane.** Not added. Raven runs in WKWebView with macOS overlay scrollbars, so content
  never shifts. With classic, always-shown scrollbars, `scrollbar-gutter: stable` on `<main>` would turn an occasional 15px
  shift on long pages into a permanent 15px misalignment with the title bar and header on every page. The host page's own
  panes already reserve the gutter (`SCROLL_PANE`). Revisit if the owner turns on always-shown scrollbars.
- **The audit gate's blind spots** (also in `audit/README.md`):
  - `overlap` treats a control as covered when it is aria-hidden or inert, or when an overlay layer it isn't inside (a
    fixed or sticky layer, dialog, menu, listbox, tooltip) is painted over it. Collisions inside one such layer are still
    caught. A page control buried under a separate drawer or sticky header isn't reported. Control-on-text overlaps are
    never checked.
  - `overflow` lets an unclipped popup reach past its anchor; a popup running off the window is left to `offscreen`
    (reported) and `page-overflow`.
  - `clipped` leaves line clamps to `truncated`, which is reported only.
  - `small-target` measures a checkbox in a label by the label; `tiny-text` allows 12px anywhere inside `.text-label` or `kbd`.
  - sr-only is recognised by the Tailwind pattern (`clip-path: inset(50%)` or a zero `clip`); other hiding techniques are
    judged as visible.
  - `clipped` reads only an element's own text: a collapsed box whose text sits in a child span is missed, and a box
    collapsed to 0px height is skipped as invisible.
- **The save summary under the capture sheet at 900px.** The 400px toast runs under the 580px sheet, so its Undo and close
  button are hidden while the sheet is open (the sheet is a modal; the toast waits). The sheet's Discard and Save stay clear.

## From the final review (left for later)

- **Merge-aware class joining.** `src/lib/cx.ts` only concatenates, so a className override that conflicts with a component's own class can silently lose (the shrunken Settings gear was this). Point `cx` at the configured `cn` in `src/lib/utils.ts` (it knows the six type roles), remove the workarounds that exist because of it (Select's width check, the explicit-width "+ Host" trigger, Input's `width` prop), add a unit test for key merges (`text-body` + `text-code`, `w-full` + `w-20`, `text-meta` + `text-muted`), and re-run the full audit and screenshot review. Do this before new screen work.
- **Native `title` is still the only label on some controls**, against DESIGN's tooltip rule (it doesn't show on keyboard focus): PayloadsDrawer ⌥N tabs, FactGroup and ServicesFacts fold buttons, LogEntryRow's pick row ("Add as a step"), ArsenalBrowse, WikiText, RefSuggestions, SplitLeftPane and TestGrid. Move them to the Raven `Tooltip`.
- **Stuck view credential subjects** show the username only, so the same name can appear twice with different counts. Show the domain too.
- **Unreachable controls** (29 reported by the audit): Arsenal browse Copy buttons, the `?` "All shortcuts" button, "Open in Obsidian". Decide whether ↵ on the selected block is enough or they need Tab stops.
- **Conventions gaps** (none violated today): the engine joined-strings check misses `a + " — " + b` and `.join(" · ")`; `plan.ts` and `loot.ts` are exempt as whole files (a per-line marker would be tighter); the lint rule doesn't block `@radix-ui/react-tooltip` directly in features or `.tsx`-suffixed shadcn paths.
- **The `shadcn` CLI devDependency** brings in about 215 lockfile packages for ~250 lines of CSS. Consider inlining the CSS Raven uses and running `npx shadcn@4` only when adding components.
- **Owner questions:** the no-host ⌘↵ hint reads "log (no host)"; imported flag titles keep their old "file · host" form; with every value filled, Tab from ⌘K search now goes to the host picker.
