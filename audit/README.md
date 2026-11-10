# Visual audit

Drives the real UI against the in-memory fake backend (`npm run dev:audit`, port 5199) across every screen in `audit/screens.ts` x 4 widths.

- Run: `npm run audit:visual` (selftest + visual + keyboard + ux: flows and states). Playwright starts and stops the dev server itself.
- `npm run audit:selftest` runs only the self-tests; it also boots the 5199 dev server and writes a "No screens ran" report.
- State screens: the fake backend honours `?audit=empty|loading|error`, which `ux.spec.ts` uses for the `<screen>~empty|loading|error` runs.
- Report sections say "Did not run" (or "Did not run at: <widths>") for anything without an issue file or screenshot.
- Output (gitignored): `audit-output/report.md` (summary table, then one section per screen), `report.json`,
  `shots/<screen>@<width>.png`, and raw `issues/<screen>@<width>.json`.
- **The gate.** These checks fail the run, on every screen and width and on the `~empty|loading|error` state runs (spec §2.5):
  `tiny-text` (under 12px; under 13px for anything that is not a label or chip, `.text-label`, or a key cap, `kbd`),
  `small-target` (under 24px; a checkbox or radio inside its `<label>` is measured by the label), `overlap`,
  `page-overflow`, `document-scroll`, `overflow`, `clipped` and `mid-token-wrap`. The list lives in `FAILING_CHECKS` (`audit/types.ts`).
  `document-scroll` is the window itself scrolling at all: the document taller or wider than the viewport, or `scrollTo(0, 5000)`
  moving it (Raven scrolls only inside its panes; an escaped absolutely placed child once made the Manual 8452px tall).
  `offscreen`, `squeezed`, `narrow-wrap`, `truncated`, `long-lines`, `off-scale-spacing` and the rest are reported only.
  A screen that can't reach its ready state, a page error, or a failed self-test also fails the run.
- How the failing checks judge what shows, and what each still can't see:
  - Screen-reader-only text is recognised by its pattern (absolutely placed with `clip-path: inset(50%)` or a zero `clip`
    rect) and skipped. A box that collapsed to 1px around its own text is still judged. Blind spots: sr-only text built
    some other way is judged as visible text; `clipped` reads only an element's own text, so a collapsed box whose text sits
    in a child span is missed, and a box collapsed to 0px height is skipped as invisible.
  - `overlap`: two controls in the same scroll container are compared by plain geometry, scrolled into view or not. In
    different containers, each is first clipped by the clipping ancestors the other is not inside. Where both are on
    screen, the middle of the overlap is hit-tested. A control counts as covered, not overlapping, only when it is
    aria-hidden or inert (an open Radix modal), or when something painted over it belongs to an overlay layer (its nearest
    fixed or sticky ancestor, or dialog, menu, listbox, tooltip or popper) that the control is not inside. Inside one
    drawer, dialog, palette, sticky header or fixed shell, controls are judged against each other as usual. A control that
    ignores the pointer is judged by geometry. Blind spots: a control on the page covered by a separate drawer or sticky
    layer is not reported, even if that layering is itself a bug; overlaps between a control and plain text are never
    checked.
  - `overflow`: an absolutely placed popup (listbox, menu, dialog, tooltip, Radix popper) may reach past an anchor that
    doesn't clip it. Anything else hanging out, or a popup cut off by a clipping box, fails. Blind spot: a popup reaching
    past an unclipped anchor and off the window is only caught by `offscreen` (reported) and `page-overflow`.
  - `clipped` leaves line clamps to `truncated` (reported), so a clamp hiding text without a `title` is a report, not a
    failure.
  - `small-target` measures a checkbox or radio by its `<label>`. Blind spot: a tiny checkbox in a label that is large
    only because of other content still passes.
  - `tiny-text` allows 12px inside any `.text-label` or `kbd`, so non-label text nested in a label passes at 12px.
- **Opt-out.** One element (and its subtree) opts out of a check with `data-audit-allow="<check>"` (a check id from
  `audit/types.ts`; several ids separated by spaces) plus a `data-audit-reason="<why there is no fix>"`. An opt-out without a
  reason is itself a failing issue (`opt-out-unreasoned`), and so is one naming an id that isn't a check (`opt-out-invalid`),
  since a typo would opt out of nothing. `report.md` lists every opt-out, with its reason and screens, under
  "Opt-outs". Opt out only when the component genuinely can't be fixed.
- Screens live in `audit/screens.ts`; each needs a specific `ready` selector (never `body`).
