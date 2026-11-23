---
version: 1
slug: "src-features-credentials"
primary_target: "src/features/credentials"
related_targets: []
---

# Credentials (engagement section)

Mode: Operate. Owner: one pen tester, keyboard-first, ADHD/autism (low noise, stable layout).
Jobs, equally weighted: see what works where; grab a secret; test a new credential; crack hashes.
Spec: docs/specs/credentials.md. Chosen sketch: docs/specs/mocks/cred-matrix-dock.html.

## Direction contract

THESIS: One credential at a time. The matrix is the page; selecting a row docks everything about that credential below it. Refuses the category default of a long stack of tables, command lists and a second hash list that repeat each credential.

OWN-WORLD: Ink, unchanged: true black, hairlines, one lime accent for held access and selection, amber only for dead or uncrackable. Instrument Sans for UI, JetBrains Mono for names, secrets and commands. The dock is the only raised surface (--surface, 8px radius).

STORY: The owner scans the matrix for V and A, picks a credential, and the dock answers what it is, where it came from, where it works, and what to run next (test, shares, spray, roast, or crack). Inventory answers what we hold, grouped by kind.

FIRST VIEWPORT: Tab row (Matrix, Inventory with count) with Add credential on the right. Legend, then the matrix filling the upper part with sticky header and first column, the selected row lit. Below, the dock: header line with name, type, scope, state chip, masked secret and icon actions; body with a facts column left and work tabs right. Nothing scrolls the page; each pane scrolls itself.

FORM: Matrix with a credential dock, dealt lead (position 4 on my ordered list). seed:fe0e1fa88704e274

Signature interaction: selecting a matrix row header (click, or Enter on a focused row) swaps the dock's content in place without changing its height.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
