---
target: the arsenal
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:src/features/arsenal"
timestamp: 2026-11-07T05-33-14Z
slug: src-features-arsenal
---
# Arsenal critique — 23/40 (Acceptable)

Method: dual-agent (A: design review · B: detector + browser evidence), audit-mode synthetic data.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 2 | Selected row invisible in ⌘K/drawer; auto-filled credential never named |
| 2 | Match real world | 3 | Raw folder slugs in browse |
| 3 | User control | 2 | Hidden host select in Tab order; typing switches host silently |
| 4 | Consistency | 2 | Enter copies in ⌘K, opens card in drawer; PASS editable only in ⌘K |
| 5 | Error prevention | 1 | Literal {PASS} copies with no warning; silent host switch |
| 6 | Recognition | 3 | Full-screen browse has no search |
| 7 | Flexibility | 2 | Browse not keyboard-drivable |
| 8 | Minimalist | 3 | Repeated "card"/"DC (by name)" chips, 11 transfer pills |
| 9 | Error recovery | 2 | "No cards match" with no reason or next step |
| 10 | Help | 3 | ⌥H/⇥ hints go to an invisible control |

Specificity: content specific (filled commands, why-lines), structure generic (docs-site rail, flat lists, no host-aware selection).
Detector: CLI 0 findings; browser: 10.5px labels (house style), one low-contrast placeholder. axe: listbox contains h3 (drawer+palette), unfocusable scrolling pre, label-in-name on header buttons.

## Priority issues
- [P0] Secrets never fill (CardView.tsx:18 drops PASS/HASH/CRED; ⌘K needs hand typing); half-filled commands copy. Fix: credential chip per pane filling USER/DOMAIN/PASS|HASH; block or redirect Copy while tokens unresolved.
- [P0] Hidden host <select> (HostPicker.tsx:24, opacity-0) is tabbable and takes typeahead → silent wrong-IP. Fields reorder after edit (Palette.tsx:143-145). Fix: tabIndex -1, flash on change, stable field order.
- [P1] Drawer Enter opens card (ArsenalDrawer.tsx:95) not command; ranking ignores host OS/services ("smb" → find on Linux host); active row invisible. Fix: Enter copies, → opens card scrolled to block, context ranking, accent bar.
- [P1] Browse is a docs-site shell: empty "Pick a card.", no search, list starts ~740px, Reporting empty, native select. Fix: search + host chip top, "For this host" default, counts / hide zero filters, compact filters.
- [P2] Cards 1.9–3 viewports (Hash Cracking 19 blocks); drawer header overlap "portfull screen". Fix: sticky block index, j/k/c, own grid track for full-screen.

## Minor
"the the" TransferGenerator.tsx:216; Windows tools folder accepts Windows path; ⌘K preview doesn't amber-mark tokens; suggestion dropdown overflows dialog; SF Pro vs PRODUCT.md JetBrains Mono; Lateral movement as Stage filter.

## Questions
1. Default view = "next 3 commands here, filled"? 2. Is a card the right unit at exam time? 3. Should a command with {…} be copyable at all?
