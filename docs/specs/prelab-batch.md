# Raven pre-lab batch (2026-11-09)

> **Frozen record, shipped** (written 2026-11-09). This spec records the decisions and reasoning at the time. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

## Why

The owner wants as much done as possible before the next lab, then one batch test of how everything flows in a real engagement. This round clears what is still open from two lists:

- `docs/superpowers/followups/2026-11-07-raven-2b-payloads.md` (every unticked item);
- `docs/superpowers/audits/2026-11-06-visual-audit-triage.md` (items checked against `main` on 2026-11-09; the open and unverified ones are listed below).

## Owner decisions (2026-11-09)

- **Scope:** everything open on both lists, on one branch (`prelab-batch`), batch-tested in a lab.
- **SQL panel:** fold finished steps. A step you have copied, or whose value you filled in (column count, table name…), folds to one line showing its result. The current step stays open. Nothing you haven't done is hidden. A folded step reopens with a click or ↵ on it.

## Goals

### Payloads (follow-ups doc)
Every unticked item under "Payload content", "SQL", "Fit and memory", "Drawer and Workbench" and "Found in 2b-C", except the two already closed by the 2b-C final fix wave (listener placeholders as fields; Filter on Shell only). Unverified hints (WAR `/rev/`, `rundll32 rev.dll,<export>`, hta-psh x64) are checked against the owner's msfvenom card and Metasploit docs; anything still unverifiable gets an honest "check this" note instead of a claim.

### Audit triage (open or unverified on main)
- **8a Next step key:** a single key that focuses the first To-do or Doing step of the host's checklist (target: 1 key instead of 13 Tabs).
- **8d Capture intake:** pasting `user:pass`, `DOMAIN\user:pass`, `user:hash` (the formats `parseCredentialPaste` already reads) into capture offers the credential, through the existing credential intake, instead of saving a note.
- **Board:** a host whose access is `root` is at least in Post-exploitation, even before the proof step is ticked. Reporting still needs proof and closed late goals.
- **10 / §4 states:** the board never shows a loading or failed query as an empty board with zero counts; error states use the shared `ErrorState`/`queryState`; empty Hashes has an empty state.
- **§6 deferred items:** the Evil-WinRM prompt in log titles, the inert 3.0 vector version button, NVD state not kept in the finding draft, the collapsed rail's ThreadDot, the host-facts API cleanups (vectorUpsert/ruled_out doc, fakeApi drift, orphan-link cleanup, `hostIdentitySet` updatedAt 0), and the listed test gaps — each verified first; fixed if still real.
- **Unverified layout items** (6 board at 900/1024, 7 stats strip, 8e host-picker focus ring, 9 routine commands, §2 matrix heads and chevrons, §3 "(hash)" twice, orange Delete, Transfer selects, Log "RAN ON", caption, palette ranking, capture filename, checklist scroll position): checked in the visual audit's screenshots at 900 and 1024; real defects fixed.

## Non-goals
- Arsenal Reporting stage: Arsenal browse is now category-based, so the empty stage no longer shows. Importing `05-Reporting` reference pages changes the Field Manual import contract (`Conventions.md`): owner decision, asked at the end of the round.
- Splitting `FindingEditor` (about 450 lines): not user-facing.
- The two documented inference limits (`# whoami` inside cat output; SSH from Kali not auto-read): kept as documented.

## Constraints
Same as 2b-C: synthetic fixtures only; CSS grid first, Ink tokens, amber warnings, no red; keyboard-first; payloads work as pasted with parts for each token; any schema change is an appended migration with backup first; builders stage only their own files; no AI attribution in commits.
