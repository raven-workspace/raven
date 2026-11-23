# Design specs

Each spec records what a feature round set out to build and why, in the words of the decisions made at the time. They're history: the code is the truth for current behaviour, `PRODUCT.md` describes what Raven does today, and `DESIGN.md` holds the visual rules. Read a spec when you need the reasoning behind something, or before changing a feature it covers.

Code comments cite specs by name and section, for example `(interpreters-and-payloads spec §3.2)`. Bare section numbers in `src/engines/report/` and `src/features/report/` (`§10.1`, `§5.7`) refer to `reports.md`, except mentions of the OffSec sample report's §4.1.

Later specs override earlier ones where they overlap, and a few sections say so explicitly (for example `reports.md` §10 and §11). The "Status: draft" lines at the top of some specs are from when they were written; every spec below was approved and built.

| Spec | Covers | State |
|---|---|---|
| [foundation.md](foundation.md) | The original design: engagements, hosts, capture and log, checklists, credentials, findings, cleanup, exam sims, import from old Raven, and the Ink visual direction (§8) | Shipped; §5 and §6.4 partly replaced by `pen200-stages.md` and `host-page.md` |
| [pen200-stages.md](pen200-stages.md) | Board columns and host checklist reorganised around the PEN-200 stages | Shipped |
| [arsenal-import.md](arsenal-import.md) | The Arsenal, ⌘K search, Field Manual import, the Toolkit and the "Transfer a file" generator, placeholder auto-fill | Shipped |
| [host-page.md](host-page.md) | Host page layout, facts column, in-place findings editor, CVSS builder and the NVD lookup | Shipped |
| [arsenal-reference.md](arsenal-reference.md) | The Arsenal as a command reference: categories, ranking, fill chips, copy guard, drawer and full-screen browse | Shipped |
| [interpreters-and-payloads.md](interpreters-and-payloads.md) | Output interpreters (what a pasted output proves) and the Payloads drawer and Workbench | Shipped |
| [payloads-breadth.md](payloads-breadth.md) | More paste contexts and shells, bind shells, toggles, listeners, msfvenom | Shipped |
| [credentials.md](credentials.md) | The Credentials page: test matrix with a credential dock | Shipped |
| [readability-conventions.md](readability-conventions.md) | The readability round that produced most of `DESIGN.md`'s rules and the convention tests | Shipped |
| [manual.md](manual.md) | The Manual: the Field Manual's reference notes as a full-screen reader | Shipped |
| [manual-reading.md](manual-reading.md) | The Manual's reading round: type, spacing, output blocks | Shipped |
| [prelab-batch.md](prelab-batch.md) | Fixes batched before the first lab session | Shipped |
| [network.md](network.md) | The Network section: tunnels, hops and the attack-path tree | Shipped |
| [reports.md](reports.md) | The Report: OffSec's grading rules, the smart draft, the editor, checks, and export | Shipped except PDF/.7z export (§6.7, with the carried requirements in §12) |

## Mockups

`mocks/` holds the mockups the specs cite as the chosen direction: the Ink visual directions and first layouts (`visual-directions.html`, `engagements-dashboard.html`, `engagement-view.html`, `host-view.html`) and the decision sketches for the Payloads drawer and Workbench, the credentials dock, the Manual and the Report. They fix structure and hierarchy, not exact values; the shipped UI and `DESIGN.md` win where they differ.

## Older references

Some specs link to build plans, follow-up notes and audit triage under `docs/superpowers/`. Those were removed once their work shipped and their open items moved to Linear; find them in git history (`git log --all -- docs/superpowers`).
