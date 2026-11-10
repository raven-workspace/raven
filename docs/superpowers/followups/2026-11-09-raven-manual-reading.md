# Manual reading round: follow-ups

- Deferred minor items: the controller adds the list.
- Audit: `document-scroll` is a failing check (the window must never scroll); screens `manual-lookup-card` and `palette-lookup` added.
- Inline command buttons are `min-h-6` (24px target); a command alone in a cell is a real target, not an inline-text exemption.
- Regression specs updated for the new policy: at 1024 and 1440 the long note's table 1 stays a table (cause column dropped), at 900 and 1280 it stacks.
- WebKit: spot-checked with Playwright webkit; `min-width: 32ch` is honoured on `th`/`td`. Re-check in the real WKWebView build.
- Impeccable detector: `[]` for src/features/manual, src/features/palette, src/ui/CommandBlock.tsx.
