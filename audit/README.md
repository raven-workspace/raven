# Visual audit

Drives the real UI against the in-memory fake backend (`npm run dev:audit`, port 5199) across 22 screens x 4 widths.

- Run: `npm run audit:visual` (selftest + visual + keyboard + ux: flows and states). Playwright starts and stops the dev server itself.
- `npm run audit:selftest` runs only the self-tests; it also boots the 5199 dev server and writes a "No screens ran" report.
- State screens: the fake backend honours `?audit=empty|loading|error`, which `ux.spec.ts` uses for the `<screen>~empty|loading|error` runs.
- Report sections say "Did not run" (or "Did not run at: <widths>") for anything without an issue file or screenshot.
- Output (gitignored): `audit-output/report.md` (summary table, then one section per screen), `report.json`,
  `shots/<screen>@<width>.png`, and raw `issues/<screen>@<width>.json`.
- **The gate.** These checks fail the run, on every screen and width and on the `~empty|loading|error` state runs (spec §2.5):
  `tiny-text` (under 12px; under 13px for anything that is not a label or chip, `.text-label`, or a key cap, `kbd`),
  `small-target` (under 24px; a checkbox or radio inside its `<label>` is measured by the label), `overlap`,
  `page-overflow`, `overflow`, `clipped` and `mid-token-wrap`. The list lives in `FAILING_CHECKS` (`audit/types.ts`).
  `offscreen`, `squeezed`, `narrow-wrap`, `truncated`, `long-lines`, `off-scale-spacing` and the rest are reported only.
  A screen that can't reach its ready state, a page error, or a failed self-test also fails the run.
- How the failing checks judge what shows: 1px screen-reader-only boxes are not seen; `overlap` clips each control by its
  scrolling ancestors and hit-tests the middle of the overlap, so a control under an opaque layer that is not the other
  control (a drawer, the stuck panel, a popup list) is covered, not overlapping; `overflow` ignores an absolutely placed
  popup reaching past its anchor; `clipped` leaves line clamps to `truncated`.
- **Opt-out.** One element (and its subtree) opts out of a check with `data-audit-allow="<check>"` (a check id from
  `audit/types.ts`; several ids separated by spaces) plus a `data-audit-reason="<why there is no fix>"`. An opt-out without a
  reason is itself a failing issue (`opt-out-unreasoned`). `report.md` lists every opt-out, with its reason and screens, under
  "Opt-outs". Opt out only when the component genuinely can't be fixed.
- Screens live in `audit/screens.ts`; each needs a specific `ready` selector (never `body`).
