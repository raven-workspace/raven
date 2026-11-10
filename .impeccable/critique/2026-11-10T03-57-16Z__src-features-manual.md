---
target: the manual
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:src/features/manual"
timestamp: 2026-11-10T03-57-16Z
slug: src-features-manual
---
# Manual critique — 28/40 (Good)

Method: dual-agent (A: design review · B: detector + browser evidence), audit build at 900/1024/1280/1440.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | ⌘↵ feedback identical to ↵; stale Copied statuses |
| 2 | Match real world | 2 | Slug link text; ⌘↵ logs as "Usage"; "Host No host" |
| 3 | User control | 3 | Card drawer needs two Esc; filter Esc keeps filter |
| 4 | Consistency | 3 | Auto table layout (NoteTable.tsx:75); " · " join (search.ts:42); blank loading |
| 5 | Error prevention | 3 | Note vs card links identical |
| 6 | Recognition | 2 | [ ] and ⌥H hidden ≤1280; M-focuses-note undocumented |
| 7 | Flexibility | 3 | Two Tab stops per command; filter ↵ strands focus |
| 8 | Minimalist | 3 | Lime pane frame; up to four limes at once |
| 9 | Error recovery | 3 | Retry/Details; amber no-match |
| 10 | Help | 3 | ? list omits M and ⌥↓/⌥↑ |

Specificity: behaviours authored (host fill, search-to-spot, stacked rows); skeleton is a stock docs-site rail/note/outline.
Detector: CLI 0 findings (manual + Palette). Browser: line-length 91ch at 900, 7 stragglers, axe label-content-name-mismatch on HostChip.tsx:34-38. False positives: rail roving tabindex "unreachable", logo ratio, detector's own label.

## Priority issues
1. [P1] Inline code with {PLACEHOLDER} not filled/copyable (NoteView.tsx:40-44); real Error-Message-Lookup has 37 such cells; fixtures have none. → harden
2. [P1] Note tables lack column policy: action column squeezed at 1440, 5-col stack ≈2.2 screens at ≤1280, key not emphasised. → layout
3. [P2] Search match lights token, not row. → polish
4. [P2] Focus/keys: filter ↵ leaves focus in filter; full lime pane frame (ManualPage.tsx:340); card drawer Esc goes to Arsenal home. → polish
5. [P2] ⌘↵ logs silently titled "Usage" (NoteView.tsx:93). → clarify

## Persona red flags
- Alex: 2 Tab stops/command, no next-command key, 5 keys rail→read, silent ⌘[ no-op.
- Sam: command labels read raw "Usage:" template; title-only truncation; links differ only by tooltip; HostChip name mismatch.
- Owner mid-exam: row unmarked, fix command unfilled raw text, 260px rail at 900, outline gone <1100.

## Minor
Empty caption row on untitled blocks (ManualCommand.tsx:104); copy hints on command-less notes; 28-entry outline from Case h3s; narrow host picker; blank loading vs DESIGN 300ms rule; stretched "/" cap.

## Questions
Pinned answer card on lookup hit? Rail on demand at 900? Error rows as direct ⌘K copy results?
