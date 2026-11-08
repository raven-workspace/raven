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
- **The overlap check's blind spot.** It treats any opaque layer between two controls as covering. A control whose own opaque
  wrapper collides with another control would be missed. No case found; worth a self-test if one turns up.
