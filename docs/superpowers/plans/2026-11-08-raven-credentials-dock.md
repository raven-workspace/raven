# Credentials Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Credentials section as two tabs (Matrix, Inventory) over a shared dock that holds everything about the one selected credential, with each fact and action shown once.

**Architecture:** Presentation only. shadcn first where it saves reinventing (spec 7a): Resizable for the list/dock split and fold, Tabs, Table for the inventory rows, ScrollArea, Separator. `TestGrid` gains opt-in selection. A new pure module picks the default and fallback selection, and a hook keeps the selection, tab and fold state in the URL and localStorage. A new `InventoryList` groups credentials by kind. A new `CredentialDock` absorbs today's `HashesList` row actions and `RoutineSection` steps. `CredentialsSection` is rewritten to compose them in a full-height two-row grid. No engine, query, type or database changes.

**Tech Stack:** React 19, TypeScript, Tailwind 4, react-router, TanStack Query, Vitest + Testing Library, Playwright visual audit.

**Spec:** `docs/superpowers/specs/2026-11-08-raven-credentials-dock-design.md`. Read it in full. The chosen sketch is `.impeccable/mocks/decision/cred-matrix-dock.html`, and the direction contract is `.impeccable/surfaces/src-features-credentials.md`.

## Global Constraints

- **DESIGN.md is binding:**
  - CSS grid with explicit tracks. No `flex-col`, `flex-1`, `flex-wrap`, `justify-between` or `grow` in `src/features/**`.
  - Use only the six type tokens. Nothing is under 12px. No `text-xs` and no `text-[Npx]`.
  - Spacing steps are 4, 8, 12, 16, 24 and 32 only.
  - Icon buttons are `IconButton` with an `aria-label` and a Raven `Tooltip`. Never a native `title` as the only statement of an action.
  - No " · ", " — " or " → " joins in UI text.
  - Delete is a neutral `Trash` until hovered. Selection is `--surface-hi` plus a 2px accent left bar, and it never follows the mouse.
- **Display never contains a raw secret.** Commands display from `MASK`, and copy carries the real value (as today).
- **`TestGrid` without `onSelect` renders exactly as today.** `HostCredentialsFacts` uses it.
- **URL params:** `cred=<id>`, plus `tab=inventory` when Inventory is open. Matrix is the default and is omitted. Write them with `setSearchParams(..., { replace: true })`.
- **Split and fold storage:** the Resizable layout is saved under the id `raven.credDock.<engagementId>`. The fold is the dock panel's collapsed state in that saved layout, so nothing else stores it.
- **shadcn usage (spec 7a):**
  - Resizable, Tabs, Table, ScrollArea and Separator come from `src/ui/shadcn/*`.
  - Wrapped pieces stay Raven's (`Button`, `IconButton`, `Input`, `Tooltip`, `Toggle`, `Dialog`, `EmptyState`, `Chip`), and lint enforces it.
  - Where shadcn's default classes clash with DESIGN.md (flex stacks in feature code, non-Ink colours, type sizes), override at the call site or in the `src/ui/shadcn` file. Never in a way that breaks the conventions test.
- **Checks before every commit:**
  - `npx tsc --noEmit -p .`
  - `npm run lint`
  - `npx vitest run`
  - and from Task 5 on, `npm run audit:visual`.
  - The conventions test (`src/test/conventions.test.ts`) must pass.
- **jsdom:** react-resizable-panels needs `ResizeObserver`, and Radix ScrollArea may too. If `src/test/setup` doesn't stub them, add a minimal stub there in the first task that needs it.
- **No commit trailers** (no Co-Authored-By). Commit messages are conventional (`feat(credentials): …`).

## Review Focus

1. **The selected credential disappears:** it's deleted, its hash is cracked and folds, or the deep link is stale. The dock moves to the default and never renders an empty or crashed dock. Covered in Task 2 (`resolveSelection`) and Task 5 (an integration test).
2. **The engagement has only non-sprayable credentials,** such as a krbtgt hash and a ticket. The newest credential is selected, the dock shows facts only, and the matrix shows its empty text plus the "can't be sprayed" note. Task 2 and Task 5.
3. **A long credential name** (60+ characters) in the matrix row header, inventory row and dock header. All three truncate with a full-name `title`, and the dock's icon actions stay visible. Task 3 and Task 4.
4. **A sprayable NTLM hash that's also uncracked:** it shows both Crack and the test tabs, Crack first. Once marked uncrackable, Crack comes after the test tabs. Task 4.
5. **Keyboard only:** Tab reaches a row header, ↑ and ↓ move focus, Enter selects, focus moves into the dock, and Esc folds the dock. Esc inside an open dialog closes the dialog first. Task 1 and Task 5.

---

### Task 0: Add the shadcn pieces

**Files:**
- Create (by CLI): `src/ui/shadcn/resizable.tsx`, `src/ui/shadcn/scroll-area.tsx`, `src/ui/shadcn/table.tsx`
- Modify: `package.json` and `package-lock.json` (adds `react-resizable-panels`)

- [ ] **Step 1: Add the components.** Run `npx shadcn@latest add resizable scroll-area table` from the repo root. Expected: the three files are created, and `react-resizable-panels` is added.
- [ ] **Step 2: Review the added files** (shadcn skill, workflow step 7):
  - imports use the project's aliases (`@/lib/utils` for `cn`);
  - no lucide icons;
  - colours use the tokens `src/styles/global.css` maps onto Ink. Check that `bg-border`, `bg-muted` and `ring-ring` resolve to Ink values there, and map any missing token in `global.css`.
- [ ] **Step 3: Restyle the resize handle to Ink.** At rest, the handle is a 1px `--line` hairline with a hit area of at least 8px. On hover and focus-visible it's `--line-strong` with the 2px accent focus ring (DESIGN.md Focus). No grip dots.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npm run lint && npx vitest run src/test/conventions.test.ts`. Expected: pass.
- [ ] **Step 5: Commit** `build(ui): add shadcn resizable, scroll-area and table`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/features/credentials/selection.ts` | create | Pure: `defaultCredentialId`, `resolveSelection`, `dockTabs` |
| `src/features/credentials/useCredentialSelection.ts` | create | Hook: URL `cred`/`tab`, fold flag in localStorage |
| `src/features/credentials/TestGrid.tsx` | modify | Opt-in selection, row header as button, ↑/↓, sticky header |
| `src/features/credentials/InventoryList.tsx` | create | Kind groups, selectable credential rows, usernames group |
| `src/features/credentials/CredentialDock.tsx` | create | Dock header, facts column, work tabs |
| `src/features/credentials/DockWork.tsx` | create | Crack tab and routine step tabs (from `HashesList` and `RoutineSection`) |
| `src/features/credentials/HashesList.tsx` | delete | Logic moves to `DockWork` (`CrackDialog` moves too; export it from `DockWork.tsx`) |
| `src/features/credentials/RoutineSection.tsx` | delete | Logic moves to `DockWork` |
| `src/features/credentials/CredentialsSection.tsx` | rewrite | Tabs row, two-row grid, wiring, `ConvertDialog` moves to `CredentialDock.tsx` |
| `src/test/credentialSelection.test.ts` | create | Unit tests for `selection.ts` |
| `src/test/credentials.test.tsx`, `src/test/credentialMatrix.test.tsx`, `src/test/features/credentials/testGridTried.test.tsx` | modify | Retarget to the dock and inventory |
| `audit/screens.ts`, `src/audit/fixtures.ts` | modify | New audit screens |

---

### Task 1: TestGrid opt-in selection and sticky header

**Files:**
- Modify: `src/features/credentials/TestGrid.tsx`
- Test: `src/test/features/credentials/testGridSelect.test.tsx` (create; mount `TestGrid` directly, the way `testGridTried.test.tsx` does)

**Interfaces:**
- Produces: `TestGrid` props gain `selectedId?: string` and `onSelect?: (credId: string) => void`. With `onSelect`:
  - each credential row header's content is a `button` (`aria-pressed`, `aria-label` = `` `Select ${credLabel(cred)}` ``);
  - the selected `tr` carries `data-state="selected"` (shadcn's Table selection convention) and `aria-selected="true"`.
  - Tried rows are never buttons.

- [ ] **Step 1: Write the failing tests**
  - `it("without onSelect, row headers are plain text")`: render with two credentials; `queryAllByRole("button", { name: /^Select / })` has length 0.
  - `it("clicking a row header selects it")`: `onSelect` mock. Click the "Select ACME\svc_sql" button; expect it to have been called with that credential's id.
  - `it("the selected row is marked and its header has the accent bar")`: `selectedId="c2"`. The row `[data-cred-id="c2"]` has `aria-selected="true"`, and its `th` has class `shadow-[inset_2px_0_var(--color-accent)]`. Use the token class the codebase already uses for the selection bar; grep `inset_2px` in `src/features` and reuse it exactly.
  - `it("arrow keys move focus between row headers without selecting")`: focus the first header button and press ↓. The second button has focus, and `onSelect` wasn't called. Enter calls `onSelect` with the second id.
  - `it("tried rows are not selectable")`: with `tried` pairs, there's no `Select drew` button.
- [ ] **Step 2: Run** `npx vitest run src/test/features/credentials/testGridSelect.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The row header `th` keeps its sticky classes. When `onSelect` is set, wrap its two lines in a full-width `button` (`grid`, `text-left`, `cursor-default`, `min-h-9`).
  - `onKeyDown`: ArrowDown and ArrowUp focus the next or previous `button[data-row-select]` in the same table, and call `preventDefault`.
  - Selected row: every `th` and `td` in it gets `bg-surface-hi`, and the `th` also gets the accent bar.
  - Sticky header: the two `thead` rows get `sticky top-0 z-30 bg-bg` (the second at `top-[<first row height>]`), or put a single `sticky top-0` on `thead` if the table allows it. The scroller `div` becomes the vertical scroller too (`overflow-auto`, with `max-h` supplied by the caller through a new `className?: string` prop on the outer bordered `div`).
- [ ] **Step 4: Run** the new test file plus `src/test/hostFacts.test.tsx` and `src/test/features/credentials/testGridTried.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): test grid rows can be selected`.

### Task 2: Selection rules (pure) and the selection hook

**Files:**
- Create: `src/features/credentials/selection.ts`, `src/features/credentials/useCredentialSelection.ts`
- Test: `src/test/credentialSelection.test.ts`

**Interfaces:**
- Produces:
  - `defaultCredentialId(creds: Credential[], ctx: { hosts: Host[]; servicesByHost: Map<string, Service[]>; attempts: CredAttempt[] }): string | undefined`. The newest `isSprayable` credential for which `buildTestCommands({ cred, hosts, servicesByHost, attempts }).commands.length > 0`; else the newest sprayable one; else the newest of any kind; else `undefined`. "Newest" means the highest `createdAt`.
  - `resolveSelection(requested: string | null, creds: Credential[], ctx): string | undefined`. `requested` if it's in `creds`, else `defaultCredentialId`.
  - `type DockTab = "crack" | "test" | "shares" | "spray" | "roast"`.
  - `dockTabs(cred: Credential, ctx: { hosts; servicesByHost; usernames: Username[] }): DockTab[]`. The order:
    1. `"crack"` first, if `cred.type === "hash"`, `!isMachineAccount(cred)` and `cred.crackStatus !== "uncrackable"`;
    2. then, if `isSprayable(cred)`: `"test"`, `"shares"`, then `"spray"` if `routineStepApplies("spray-users", …)`, then `"roast"` if `routineStepApplies("roast", …)`;
    3. then `"crack"` last, if it's a non-machine hash with `crackStatus === "uncrackable"`.
  - `useCredentialSelection(eid: string, creds: Credential[], ctx): { selectedId?: string; select(id: string): void; tab: "matrix" | "inventory"; setTab(t): void }`.
    - Built on `useSearchParams` (react-router). Write with `replace: true`.
    - When `resolveSelection` differs from the URL's `cred`, it rewrites the URL in an effect.
    - The fold isn't part of this hook. The Resizable panel owns it (Task 5).
- [ ] **Step 1: Write the failing unit tests** for the three pure functions:
  - `"defaultCredentialId prefers the newest sprayable with commands"`
  - `"falls back to newest sprayable, then newest of any kind, then undefined"`
  - `"resolveSelection keeps a known id and replaces an unknown or deleted one"`
  - `"an uncracked NTLM hash gets crack first, then test tabs"` (expect `["crack","test","shares", …]`)
  - `"an uncrackable hash puts crack last"`
  - `"a machine-account hash gets no crack"`
  - `"a ticket gets no tabs"` (expect `[]`)
  - `"roast only when it applies"`

  Build fixtures the way `src/test/engines/credentials/matrix.test.ts` does.
- [ ] **Step 2: Run** `npx vitest run src/test/credentialSelection.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `selection.ts`, then the hook. The hook has no own test; Task 5's integration tests cover it.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): selection rules for the credential dock`.

### Task 3: InventoryList

**Files:**
- Create: `src/features/credentials/InventoryList.tsx`
- Test: `src/test/credentialInventory.test.tsx` (mount inside `QueryClientProvider` + `MemoryRouter`, mocking `api` the way `credentials.test.tsx` does)

**Interfaces:**
- Consumes: `UsernamesList` (unchanged, rendered as the last group), `StateChip` (move it out of `CredentialsSection.tsx` into `InventoryList.tsx` and export it), `overallState`, `isMachineAccount`, `isOwnerless`, `usernameLabel`, `credName`.
- Produces: `InventoryList({ eid, creds, all, hosts, servicesByHost, attempts, usernames, grants, selectedId, onSelect }): JSX.Element`.
  - `creds` is the folded, shown list.
  - `all` is the raw list, for matched users.

- [ ] **Step 1: Write the failing tests:**
  - `it("groups by kind with counts, in order")`: given 2 passwords, 3 hashes (1 machine), 1 ticket and 2 usernames, the section labels read in order "Passwords 2", "Hashes 2", "Tickets, keys and tokens 1", "Machine accounts 1", "Usernames 2".
  - `it("an empty group renders no heading")`: with no tickets, there's no "Tickets, keys and tokens" text.
  - `it("hash rows show state and crack status as separate columns")`: an NTLM hash with a valid attempt shows a "valid" chip and an "uncracked" chip in the same row.
  - `it("rows show no secret and no row actions")`: within the Passwords group, nothing has `aria-label` matching `/^(Reveal|Copy|Edit|Delete|Crack)/`.
  - `it("clicking a row selects it; the selected row is marked")`: `onSelect` is called with the id, and with `selectedId` set the row has `aria-selected="true"`.
  - `it("a 60-character name truncates with a title")`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Structure:** build each group with shadcn `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead` and `TableCell` from `src/ui/shadcn/table`. Keep DESIGN.md's grid column policy: `Table` gets the grid template that today's `CredentialsSection` `TABLE` uses, minus the Secret and actions tracks, and rows are subgrids. The Hashes group gets a Crack-status track (`max-content`). The whole list sits in a `ScrollArea`.
  - **Rows:** each row is a selectable `TableRow`: `tabIndex={0}`, `aria-selected`, and `data-state="selected"` when selected, so shadcn's selected style applies, mapped to `--surface-hi`, plus the accent bar on the first cell. It also has a click handler, Enter and Space to select, and ↑ and ↓ to move focus. Hover gives the light hover only.
  - **Columns:** keep the container-query drops (`@[700px]` Scope, `@[900px]` Source).
  - **Labels:** "Passwords", "Hashes", "Tickets, keys and tokens", "Machine accounts", plus `UsernamesList`'s own "Usernames" header.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): inventory grouped by kind`.

### Task 4: CredentialDock and its work tabs

**Files:**
- Create: `src/features/credentials/CredentialDock.tsx`, `src/features/credentials/DockWork.tsx`
- Delete: `src/features/credentials/HashesList.tsx`, `src/features/credentials/RoutineSection.tsx`. Move `CrackDialog` into `DockWork.tsx` and re-point its importers. Move `ConvertDialog` from `CredentialsSection.tsx` into `CredentialDock.tsx`.
- Test: `src/test/credentialDock.test.tsx`

**Interfaces:**
- Consumes: `dockTabs`, `DockTab` (Task 2); `MaskedSecret`, `CopySecretButton`, `MASK` (`MaskedSecret.tsx`); `TestCommands`; `Tabs`, `TabsList`, `TabsTrigger` and `TabsContent` from `src/ui/shadcn/tabs` (as `HostView` uses them); `useChecklist` and `useChecklistMutations`; `useCredentialMutations`.
- Produces:
  - `CredentialDock({ eid, cred, all, hosts, servicesByHost, attempts, usernames, folded, onFold, onEdit, onDelete, onCracked }): JSX.Element`.
    - `onFold(folded: boolean)`.
    - `onCracked(password: Credential)` is called with the `Credential` returned by `api.credentialCrack`.
  - `DockWork({ eid, cred, tabs, hosts, servicesByHost, attempts, usernames, creds, onCracked })`.
  - `CrackDialog` gains an optional `onCracked?: (password: Credential) => void`, called in `onSuccess` before `onClose`.

- [ ] **Step 1: Write the failing tests:**
  - `it("header shows name, type and scope as separate cells, the state chip, and icon actions")`:
    - there are separate elements with text "password" and "domain";
    - nothing contains " · ";
    - there are buttons "Reveal secret for …", "Copy secret for …", "Edit …", "Delete …" and "Fold credential".
  - `it("state chip names where it works")`: one valid attempt on sql01 MSSQL gives a chip with text "valid on sql01 MSSQL". Two gives "valid on sql01 MSSQL +1".
  - `it("facts list source, scope and works on")`: "Works on" lists the host and service. With none, it says "nothing yet".
  - `it("an uncracked NTLM hash opens on the Crack tab with masked commands; copy has the real hash")`: port the assertions of `credentials.test.tsx`'s "crack commands follow the stored hash type" and "a hash containing a quote is never in the DOM unrevealed" to the dock.
  - `it("Record plaintext opens the crack dialog and reports the new password")`: mock `credentialCrack` to resolve a password `Credential`. Type the plaintext and save; expect `onCracked` to have been called with it.
  - `it("Mark uncrackable, then Reset")`: port from `credentials.test.tsx`.
  - `it("Test tab lists the routine's service steps with Done toggles; steps that don't apply say so")`: port `credentialMatrix.test.tsx`'s "routine rows that don't apply are dimmed", "routine command copy contains the real secret, display masks it" and "ticking a routine step sets its checklist item".
  - `it("a ticket shows facts only, full width")`: no tablist.
  - `it("a placeholder secret shows 'no secret' and Convert to access-only")`: port "convert a placeholder credential to access-only".
  - `it("Fold collapses the dock to its header")`: click Fold. `onFold` is called with `true`. With `folded`, the body isn't rendered and the button reads "Open credential".
  - `it("Esc inside the dock folds it")`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Layout:** follow spec 6.4 and the sketch.
    - The panel is `rounded-lg border border-line-2 bg-surface`.
    - The header grid is `grid-cols-[minmax(0,1fr)_auto]`.
    - The body grid is `grid-cols-[minmax(0,1fr)]`, becoming `@[700px]:grid-cols-[260px_minmax(0,1fr)]` under `@container`.
    - The work column is a shadcn `ScrollArea`. Hairlines between the header and the body, and between the columns, are shadcn `Separator`s.
  - **Name:** `text-heading font-mono`, truncated with a `title`.
  - **Routine logic:** `DockWork` reuses `RoutineSection`'s `commandsFor` switch verbatim, with one difference: `cred` comes from props instead of a picker.
    - The "test" tab renders the `smb`, `winrm`, `rdp`, `mssql` and `ssh` steps.
    - The "shares", "spray" and "roast" tabs each render one step.
    - Each step row keeps its title, the Done toggle (the same `aria-label` ``Done: ${step.title}``), "Doesn't apply" and `TestCommands`.
  - **Crack logic:** reuses `HashRow`'s command building.
  - **Fold:** the Fold `IconButton` uses `CaretDown` when open and `CaretUp` when folded. Its labels are "Fold credential" and "Open credential". `onFold(folded)` is wired in Task 5 to the Resizable panel's `collapse()` and `expand()`. While `folded`, the dock renders only its header.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(credentials): the credential dock`.

### Task 5: Compose the section and migrate the tests

**Files:**
- Rewrite: `src/features/credentials/CredentialsSection.tsx`
- Modify: `src/test/credentials.test.tsx`, `src/test/credentialMatrix.test.tsx`, `src/test/features/credentials/testGridTried.test.tsx`. Drop its `HashesList` describe; Task 3's tests cover machine accounts.
- Test: `src/test/credentials.test.tsx` (new `describe("credentials dock page")`)

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.

- [ ] **Step 1: Write the failing integration tests:**
  - `it("opens on the Matrix tab with the newest testable credential selected and docked")`: the tablist has "Matrix" (selected) and "Inventory 12". The dock region (`aria-label="Credential"`) shows that credential's name.
  - `it("selecting a matrix row swaps the dock and writes ?cred=")`: assert on the `MemoryRouter` location via a tiny `LocationProbe` component that renders `useLocation().search`.
  - `it("the selection survives switching to Inventory, and ?tab=inventory is written")`.
  - `it("a stale ?cred= falls back to the default")`: start at `/e/e1/s/credentials?cred=nope`.
  - `it("deleting the selected credential moves the dock to the default")`.
  - `it("cracking the selected hash selects the new password")`.
  - `it("with only non-sprayable credentials, the newest is docked and the matrix shows the can't-be-sprayed note")`: the text reads "2 more credentials can't be sprayed", plus a button "see Inventory" that switches tabs.
  - `it("Crack appears once on the page")`: with a hash selected, `getAllByRole("button", { name: /^Crack|Record plaintext/ })` has length 1.
  - `it("the fold persists per engagement")`: fold, unmount, remount. The dock is folded (the button reads "Open credential"). Assert through the UI, not through the library's storage format.
- [ ] **Step 2: Retarget the existing tests.**
  - Tests that clicked Reveal, Copy, Edit, Delete, Crack, Convert or Mark uncrackable in a table row now select the credential first (click its "Select …" row header, or its inventory row), then act in the dock.
  - Delete the tests made obsolete by design, and note each deletion in the commit body:
    - "row actions are icon buttons Copy, Edit, Delete" is replaced by Task 4's header test;
    - "scope renders value and host on two lines" moves to the inventory.
  - Keep every other assertion's intent.
- [ ] **Step 3: Run** `npx vitest run src/test/credentials.test.tsx src/test/credentialMatrix.test.tsx`. Expected: FAIL (new tests).
- [ ] **Step 4: Implement the section.**
  - **Frame:** `<section aria-label="Credentials" className="@container grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">`.
  - **Row 1:** `Tabs` (Matrix; Inventory with the count `shown.creds.length + usernames.length`) on the left, and `Add credential` (primary) on the right, in a `grid-cols-[minmax(0,1fr)_auto]` row.
  - **Row 2:** a vertical `ResizablePanelGroup`. Save its layout per engagement under the id `raven.credDock.<eid>`, using the persistence API of the installed `react-resizable-panels` version; check the shadcn resizable docs. It holds:
    - **the list panel** (`minSize` 30%), with the active tab's pane;
    - a `ResizableHandle`;
    - **the dock panel**: `collapsible`, with `collapsedSize` equal to the dock header's height, `minSize` equal to the header plus 160px, `maxSize` 70% and `defaultSize` 45%. Use pixel or percentage units as the installed version supports.
    - Track `folded` from the panel's collapse and expand callbacks, and pass it to `CredentialDock`. `onFold` calls the panel ref's `collapse()` or `expand()`.
    - With no selected credential, render the list panel alone.

    The list panel's content:
    - Matrix: `Legend`, `TestGrid` with `selectedId` and `onSelect`, then the note when the non-sprayable count is above 0.
    - Inventory: `InventoryList`.
  - (The dock bounds come from the panel props above. There's no hand-rolled height CSS.)
  - **Crack follows:** `onCracked`, then `select(password.id)`.
  - **Narrow:** under `@[560px]` of the section, `Add credential` renders as a `Plus` `IconButton` labelled "Add credential" (spec 6.5).
  - **Height:** the shell's `<main>` is `overflow-auto px-6 py-6`. Give the section `h-full` so the page itself doesn't scroll at 900×800. Check in Task 6's screenshots.
- [ ] **Step 5: Run** the full suite, `npx vitest run`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(credentials): matrix and inventory tabs over the credential dock`.

### Task 6: Audit screens, visual review and finish

**Files:**
- Modify: `audit/screens.ts`, and `src/audit/fixtures.ts` only if a fixture is missing (an NTLM hash, a ticket and a placeholder already exist; check first).
- Modify: `DESIGN.md`. Add one bullet under Components › Tables and lists: "**Master–detail dock** (Credentials): selecting a row docks its detail below the list; the dock's height is stable across selections, it folds to its header, and the selected item's secret and actions appear only there."

- [ ] **Step 1: Add audit screens.** Use the existing `credentials` entry's shape, with setups that click a row header or tab:
  - `credentials` (the default: a password docked);
  - `credentials-hash` (select `ACME\Administrator`; the Crack tab is visible);
  - `credentials-inventory` (`?tab=inventory`);
  - `credentials-folded` (click Fold).
  - Add `credentials-inventory` to `NEEDS_DATA` in `audit/ux.spec.ts` only if its empty setup acts on fixture rows.
- [ ] **Step 2: Run** `npm run audit:visual`. Expected: 0 failed.
- [ ] **Step 3: Review the screenshots yourself.** Check each new screen at 900 and 1280 against the sketch and spec 6.5:
  - no page scroll;
  - the dock's height doesn't change between the password and hash selections;
  - nothing is cut off;
  - no " · ".

  Fix what you see, and rerun once.
- [ ] **Step 4: Run** the impeccable detector: `.claude/skills/impeccable/scripts/impeccable detect --json src/features/credentials`. Fix real findings.
- [ ] **Step 5: Commit** `test(audit): credentials dock screens` and `docs(design): master–detail dock`.
