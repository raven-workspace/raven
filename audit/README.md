# Visual audit

Drives the real UI against the in-memory fake backend (`npm run dev:audit`, port 5199) across 22 screens x 4 widths.

- Run: `npm run audit:visual` (selftest + visual + keyboard + ux: flows and states). Playwright starts and stops the dev server itself.
- `npm run audit:selftest` runs only the self-tests; it also boots the 5199 dev server and writes a "No screens ran" report.
- State screens: the fake backend honours `?audit=empty|loading|error`, which `ux.spec.ts` uses for the `<screen>~empty|loading|error` runs.
- Report sections say "Did not run" (or "Did not run at: <widths>") for anything without an issue file or screenshot.
- Output (gitignored): `audit-output/report.md` (summary table, then one section per screen), `report.json`,
  `shots/<screen>@<width>.png`, and raw `issues/<screen>@<width>.json`.
- Reported issues never fail the run; a screen that can't reach its ready state, a page error, or a failed self-test does.
- Add `data-audit-allow="truncate"` to an element (or ancestor) whose truncation is intentional to skip the truncation check.
- Screens live in `audit/screens.ts`; each needs a specific `ready` selector (never `body`).
