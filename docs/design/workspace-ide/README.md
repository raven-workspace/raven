# Raven Workspace: IDE layout design hand-off

> **This is the plan, not the app as it is.** These files show the IDE layout as designed. The app may not have caught up yet, or may have moved on. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code. The impeccable detector ignores this folder (`.impeccable/config.json`), so nothing here is checked as current UI.

The design files for Raven Workspace's IDE-style layout, exported as-is from the design canvas "Raven Workspace IDE layout" (version `1795743078-4374`, 2026-11-27). The mockups mount Raven's real `src/ui` components, compiled from `raven-workspace/raven` at `develop@c1e8d09`.

## What's here

| File | What it is | Read it for |
|---|---|---|
| `Spec-1-Layout.dc.html` | Spec 1: window, chrome bar, rail, Explorer, status bar | How to build the frame around the editor |
| `Spec-2-Terminal.dc.html` | Spec 2: editor tabs, host page, terminal, capture tab | How to build the editor, terminal and capture |
| `Spec-3-Keys.dc.html` | Spec 3: keys, focus, motion, lifecycle, open questions | Key bindings, focus rules and every settled question |
| `First-version.dc.html` | Mockup: the Host View (titled "Working Copy" on the canvas) | The structure of the workspace with a host open |
| `Capture-tab.dc.html` | Mockup: the Log entry tab (titled "Capture tab" on the canvas) | The structure of capture as an editor tab |
| `rendered/` | Both mockups rendered in Chrome, script-free | The visual check: open in a browser and screenshot |
| `raven-tokens.css` | Raven's colour, type and spacing tokens as CSS, as the mockups use them | Comparing against `src/styles/tokens.css` |

The canvas export also held `ds/`, a compiled copy of `src/ui` at `develop@c1e8d09`, and `canvas.json`, the canvas index. Neither is kept here: the repo's own `src/ui` replaces the first, and the second only matters for rebuilding the canvas.

## Which source wins

The [owner overrides](#owner-overrides) win over all of these.

1. **The specs say how to build it.** Grid tracks, sizes, tokens, keys and behaviour are written out in Specs 1–3. Read them first. When a spec and a mockup disagree, the spec wins.
2. **The `.dc.html` mockups give the structure.** Every component is named outright, and the layout is the real grid markup.
3. **`rendered/` shows what it looks like.** Use it for the visual check: colour, type, spacing and copy.
4. **The repo's `DESIGN.md` and `src/ui` still govern anything these files don't cover.**

## Owner overrides

The owner has changed these after the hand-off. **They win over the specs and the mockups**: build to them, and don't put the spec's old values back.

| Where | The spec or mockup says | Build this instead | Issue |
|---|---|---|---|
| §2.2 Host page, Facts | Groups 12px apart; the only lines are the Privesc vectors list's (a hairline on top, one under each row) | A hairline (`--line`) between every fact group and the next, whatever the group holds, empty ones included. The Privesc vectors list keeps its own lines. | RAV-101 |
| §2.2 Host page, Header | The details run's gap is 8 | 16 (`--space-lg`) between the details. The OS icon and its label keep their 4. | RAV-101 |
| §2.2 Host page, Facts | Nothing; the app gave each fact group's toggle a "Fold / Open {title}" tooltip (RAV-22) | No tooltip on the toggles, in either shell: the label is on screen. Services' `S` is listed in the Shortcuts popover instead. See `DESIGN.md`: no tooltip on a control whose label is already visible. | RAV-101 |

## How to use it for UI work

1. Read the spec section the issue cites (see the section map below).
2. Read the matching `.dc.html` mockup for structure: which components, in which grid.
3. Build with the repo's own `src/ui` components and tokens. Never copy the mockup's markup or inline styles into the app.
4. For the PR's Evidence, open the `rendered/` file in a browser at 1440px wide, screenshot the area, and put it beside the `audit:visual` shot of the same area at 1440px.

**Compare screenshots at 1440px only.** At 1100px the rendered mockups only squeeze: the status bar cuts off the timebox and the privesc chips clip, instead of dropping cells as Spec 1 "At 1100px, the minimum" says. Take 1100px behaviour from the spec text, not from `rendered/`.

## Design spec sections

Issues, specs and code comments cite the design spec by section ("design spec §1.2"). Each § is one heading in a spec file:

| § | Spec | Heading |
|---|---|---|
| §1.1 | Spec 1 (`Spec-1-Layout.dc.html`) | Window grid at 1440 × 900 |
| §1.2 | Spec 1 | Rail |
| §1.3 | Spec 1 | Chrome bar (38px) |
| §1.4 | Spec 1 | Explorer (264px) |
| §1.5 | Spec 1 | Status bar (36px) |
| §1.6 | Spec 1 | Timebox states |
| §1.7 | Spec 1 | At 1100px, the minimum |
| §2.1 | Spec 2 (`Spec-2-Terminal.dc.html`) | Editor tabs (40px) |
| §2.2 | Spec 2 | Host page |
| §2.3 | Spec 2 | Terminal panel |
| §2.4 | Spec 2 | Terminal engine (not drawn, needed to build) |
| §2.5 | Spec 2 | Capture tab (New log entry) |
| §3.1 | Spec 3 (`Spec-3-Keys.dc.html`) | Keys on the artboard |
| §3.2 | Spec 3 | When the terminal has focus |
| §3.3 | Spec 3 | Motion |
| §3.4 | Spec 3 | Lifecycle |
| §3.5 | Spec 3 | Open questions |

A bare §1, §2 or §3 means the whole of Spec 1, 2 or 3.

## Reading the `.dc.html` files

They're design-canvas pages, so they only render inside the canvas, and here they don't render at all: they load `./support.js` and `ds/`, which aren't kept. Read them as code, which is straightforward:

- `<x-import component-from-global-scope="Raven.Button" variant="primary">Save</x-import>` mounts Raven's `Button` with those props. The part after `Raven.` is the `src/ui` export; attributes are props written in kebab-case (`on-change` is `onChange`). The props are in `src/ui` itself.
- `{{yes}}`, `{{noop}}` and similar are values filled in by the small script at the bottom of each file (`renderVals()`).
- Everything else is plain HTML with inline styles: the layout itself, drawn as grid.

To see them, open the files in `rendered/`. They're the same mockups with the components already drawn and the scripts removed. They're self-contained (fonts embedded, no network requests, no scripts) and open in plain Playwright.

## Naming

Some tickets use other names for the two mockups:

- **Host View** = `First-version.dc.html` and `rendered/First-version.html`
- **Log entry tab** = `Capture-tab.dc.html` and `rendered/Capture-tab.html`
