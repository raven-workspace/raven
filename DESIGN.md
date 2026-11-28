---
name: Raven
description: Ink: a keyboard-first, true-black work surface for penetration testing, with one accent used only for meaning.
colors:
  bg: "#000000"
  fg: "#ffffff"
  fg-2: "#e8e8e8"
  muted: "#a8a8a8"
  muted-2: "#c4c4c4"
  faint: "#8a8a8a"
  line: "#1f1f1f"
  line-2: "#2a2a2a"
  line-strong: "#3a3a3a"
  surface: "#0b0b0b"
  surface-hi: "#111111"
  accent: "#c6ff00"
  warn: "#e0a030"
typography:
  title:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  heading:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  code:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.08em"
  read-title:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  read:
    fontFamily: "Instrument Sans Variable, Instrument Sans Fallback, -apple-system, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "26px"
rounded:
  sm: "6px"
  md: "8px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  icon-button:
    size: "28px"
    rounded: "{rounded.sm}"
    textColor: "{colors.fg-2}"
  icon-button-hover:
    backgroundColor: "{colors.surface-hi}"
    textColor: "{colors.fg}"
  button:
    height: "32px"
    rounded: "{rounded.sm}"
    textColor: "{colors.fg-2}"
    typography: "{typography.body}"
  button-row:
    height: "28px"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
  chip:
    height: "22px"
    rounded: "{rounded.full}"
    padding: "0 8px"
    typography: "{typography.label}"
  kbd:
    height: "20px"
    rounded: "4px"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg-2}"
  input:
    height: "32px"
    rounded: "{rounded.sm}"
    backgroundColor: "{colors.bg}"
    typography: "{typography.body}"
---

# Design System: Raven

<!-- impeccable:design-map -->
Name: Raven
Colors: primary: accent #c6ff00; tertiary: warn #e0a030; neutral: bg #000000; neutral: fg #ffffff; neutral: fg-2 #e8e8e8; neutral: muted #a8a8a8; neutral: muted-2 #c4c4c4; neutral: faint #8a8a8a (+5 more in the sidecar)
Fonts: Instrument Sans Variable (title, heading, body, meta, label, read-title, read); JetBrains Mono Variable (code)
Spacing: 1 4px, 2 8px, 3 12px, 4 16px, 6 24px, 8 32px
Radius: sm 6px, md 8px, full 9999px
Don't:
- Don't lay out feature code with flex (`display: flex`, `flex-direction`, `flex-wrap`, growth, `space-between`).
- Don't set a font size that isn't a type role, or anything under 12px.
- Don't join structured values with " · ", " — " or " → ", in the UI or in titles Raven generates.
- Don't make an action a grey text link.
- Don't use amber at rest for an action, or more than one amber control at rest per screen.
- Don't put Delete in a persistent header.
- Don't put a bordered `Kbd` inside a bordered button, or an "esc" cap in a dialog corner.
- Don't put a tooltip on a control whose label is already visible. Tooltips are for icon-only controls and for naming a key.
- Don't use text glyphs (✓ ? ◐ ○ ▸ ▾ ⌄) as icons.
- Don't use a brand logo for a tool-agnostic action.
- Don't treat what already ships as approved.
Do:
- Do lay out with CSS grid and explicit tracks, with one `minmax(0,1fr)` track per row.
- Do use the six type roles (plus, in the Manual only, its two reading roles), at 13px or more for anything read.
- Do use Phosphor icon buttons for universal verbs, with a tooltip and an `aria-label`.
- Do keep row actions visible in a fixed-width action column.
- Do align side-by-side siblings on shared rows (subgrid).
- Do declare what every view does under 1000px.
- Do keep each hint's key and label together, with 24px between hints.
Map: src/test/conventions.test.ts
Map: src/ui
Map: src/ui/motion.ts
Map: src/assets
Full: .impeccable/design-full.md (read a section when you need its detail)
