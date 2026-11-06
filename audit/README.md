# Visual audit

Drives the real UI against the in-memory fake backend (`npm run dev:audit`, port 5199) across 22 screens x 4 widths.

- Run: `npm run audit:visual` (selftest + visual). Playwright starts and stops the dev server itself.
- Output (gitignored): `audit-output/report.md` (summary table, then one section per screen), `report.json`,
  `shots/<screen>@<width>.png`, and raw `issues/<screen>@<width>.json`.
- Reported issues never fail the run; a screen that can't reach its ready state, a page error, or a failed self-test does.
- Add `data-audit-allow="<check>"` to an element to suppress a check on it when the behavior is intentional.
- Screens live in `audit/screens.ts`; each needs a specific `ready` selector (never `body`).
