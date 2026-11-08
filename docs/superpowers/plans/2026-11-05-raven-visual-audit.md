# Raven Visual Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run audit:visual` drives Raven's web UI headless against synthetic stress data, runs automated layout, accessibility, keyboard and UX checks, and writes screenshots plus a report that Claude reviews by eye before each merge.

**Architecture:** A Vite `audit` mode swaps `src/lib/api.ts` for an in-memory fake backend (`src/audit/fakeApi.ts`), so the vault is skipped and the real DB is never touched. Playwright (`audit/`) starts that build on port 5199, visits every screen at 4 widths, runs in-page check functions plus axe-core, takes full-page screenshots, and a global teardown merges the per-test issue files into `audit-output/report.{json,md}`.

**Tech Stack:** Vite 8 (custom `resolveId` plugin), React 19, `@playwright/test` (Chromium only), `@axe-core/playwright`, Vitest for the fake-backend tests.

**Spec:** The agreed design lives in Claude's memory note `raven-visual-audit-plan` (2026-11-05). There is no spec file, so the design is restated below. Keyboard-only navigation checks were approved on 2026-11-05.

## Design (restated from the agreed memory note)

- **Command:** `npm run audit:visual`. Port **5199** only. Never port 3000, never `npm run tauri dev`.
- **Audit mode:** a fake `api` with synthetic data that stresses layouts. It skips the vault unlock and never touches the real DB.
- **Stress data:** long engagement and host names; about 12 credentials, so the "new credentials" notice gets long; hosts with 20+ ports, including UDP `open|filtered`; long commands, Windows paths and base64 blobs; an exam sim with locked Metasploit; an AD set with a DC.
- **Widths:** 900, 1024, 1280, 1440.
- **Screens:** the dashboard and the board; every host tab (Story, Checklist, Credentials, Findings), plus the Now panel and the stuck view; the engagement checklist, including Lateral movement; credentials, findings and the log; Settings, including Field Manual; the ⌘K palette (with its host menu), the Arsenal drawer, `/arsenal` browse, and the transfer generator.
- **Automated checks**, each naming the screen and element: horizontal overflow; text cut off by ellipsis or clipped; controls off-screen or overlapping; axe-core contrast and missing labels. **Added 2026-11-06:** imported screenshots must keep their original aspect ratio. **Added 2026-11-05:** keyboard-only navigation, and UX checks: flow friction, hierarchy and spacing, targets and states, noise and distraction.
- **Output:** a screenshot per screen and width, plus a JSON and a markdown report. Claude reviews the screenshots by eye for spacing, hierarchy and awkward wrapping.
- **Runs on demand,** before each merge.

## Global Constraints

- Dev server for the audit: `vite --mode audit --port 5199 --strictPort`. Nothing in this project may bind port 3000 or 1420, or launch Tauri.
- `src/audit/**` is only reachable through the audit-mode plugin. A normal `npm run build` bundle must not contain the fixtures (Task 1 verifies this).
- Fixtures are synthetic. No real lab data, IPs from `10.10.x.x` / `172.16.x.x` only, and placeholder secrets (`Password123!`, fake NTLM hashes).
- Playwright: Chromium only, `headless: true`, `reducedMotion: "reduce"`, locale `en-US`, timezone `UTC`. The fake's clock is fixed so screenshots are stable.
- Output goes to `audit-output/` (gitignored). Screenshots are `audit-output/shots/<screenId>@<width>.png`.
- Issue records always carry `screen`, `width`, `check`, `selector`, `detail`. A finding that doesn't name its element is a bug in the check.
- Reported layout issues do **not** fail the run (Claude triages them). The run exits non-zero only when a screen fails to reach its ready state, a check throws, or a self-test fails.
- Branch: `visual-audit` from `main` (`ef184fd`). Commits follow the repo's `type(scope): msg` style.

## Review Focus

1. **The fake drifts from `Api`.** When a new command is added to `api.ts` and the fake lacks it, the result must be a type error, not a blank screen at audit time. The fake is declared `satisfies Api` (Task 1 test: typecheck).
2. **Intentional horizontal scrollers flagged as overflow.** Code blocks with `overflow-x: auto` are deliberate. Overflow is only reported when content spills or is hidden (Task 2 self-test case `scroller-ok`).
3. **Truncation that has a tooltip.** Ellipsis on an element with a `title` attribute or `data-audit-allow="truncate"` is intentional and must not be reported (Task 2 self-test case `truncate-titled-ok`).
4. **Mutating keys during the keyboard walk.** Tab-walking and pressing shortcuts (`[`/`]` move a host, Enter on buttons) must not crash or poison later screens. Each test gets a fresh page, and the fake's state resets on load (Task 1 test `resets state per page load`).
5. **State scenarios leaking into the normal audit.** `?audit=empty|loading|error` must only affect the page that asks for it, and the default run must still see full stress data (Task 6 test `scenario is read per page load and defaults to full`).
6. **Roving-tabindex widgets reported as unreachable.** Tabs, listboxes and menus expose one tab stop. Members of `[role=tablist|listbox|menu|radiogroup]` count as reached when any sibling member is reached (Task 4 self-test case `roving-ok`).

---

### Task 1: Audit mode — fake backend, stress fixtures, Vite plugin

**Files:**
- Create: `src/audit/fixtures.ts` — the synthetic dataset plus exported ID constants
- Create: `src/audit/fakeApi.ts` — `export const api` (in-memory, `satisfies Api`) and `export type { Api }`
- Create: `src/audit/vitePlugin.ts` — `auditApiPlugin()`
- Modify: `vite.config.ts` — `defineConfig(({ mode }) => …)`; add `auditApiPlugin()` when `mode === "audit"`
- Modify: `package.json` — script `"dev:audit": "vite --mode audit --port 5199 --strictPort"`
- Modify: `tsconfig.json` if `src/audit` isn't already covered (it is under `src`, so it should be)
- Test: `src/test/audit/fakeApi.test.tsx`

**Interfaces:**
- Produces (used by Tasks 3–4):
  - `AUDIT_IDS = { labEngagement: "e-lab", examEngagement: "e-exam", archivedEngagement: "e-old", webHost: "h-web", dcHost: "h-dc01", msfHost: "h-exam-ms01" } as const` from `src/audit/fixtures.ts`
  - `AUDIT_NOW = Date.UTC(2026, 10, 5, 14, 0)`. The fake's timestamps are relative to this. Task 3 freezes the browser clock to it.
  - `api` from `src/audit/fakeApi.ts`: same shape as `src/lib/api.ts`. List and get commands return fixtures. Create, update and move commands mutate an in-memory copy and return the resulting record. Delete returns `null`. `vaultStatus` → `{ exists: true, unlocked: true }`. `fieldManualLoad` → `null` (the built-in library is used). `fieldManualScan` / `backupNow` / `importApply` / `backupRestore*` reject with `RavenError` code `unsupported`, so they are visibly inert.
  - `auditApiPlugin(): Plugin`: `enforce: "pre"`. `resolveId` resolves the import with `skipSelf`. If the result is `<root>/src/lib/api.ts`, it returns `<root>/src/audit/fakeApi.ts`. Imports from inside `src/audit/` are left alone, so the fake can `import type { Api } from "../lib/api"`.

**Fixture requirements** (exact values a test asserts):
- `e-lab`: kind `lab`, name ≥ 70 chars (e.g. `"Acme Corp — internal segment B (10.10.20.0/24) with the long-named finance DMZ"`), domain `acme.corp`.
  - **6 hosts:**
    - `h-web`: name ≥ 40 chars, 24 services, ≥ 3 of them UDP `open|filtered`, some confirmed.
    - `h-dc01`: windows, `adSet: true`, ports 53/88/135/389/445/636/3268/5985.
    - Two more AD members.
    - One linux host.
    - One `dualHomed` host.
  - **12 credentials:** mix of plaintext, NTLM, and cracked/uncracked hashes. Labels up to 50 chars. All `createdAt` later than a done checklist goal, so GoalRow's "N new credentials since this was done" notice shows 12.
  - **4 findings**, one with 6 steps.
  - **≥ 25 log entries**, including:
    - a 400-char one-line command with a base64 blob;
    - a `C:\Program Files (x86)\…` path ≥ 90 chars;
    - multi-line output;
    - a command with `--flag=value` tokens under 40 chars, used for the mid-token-wrap check.
  - Tunnels, hops, notes, cleanup items: ≥ 1 each.
  - **4 screenshot log entries with real PNG attachments** of awkward shapes: `wide` 2400×300 (a terminal strip), `tall` 500×1800, `hd` 1920×1080 and `tiny` 64×40. The PNGs are committed under `src/audit/images/`, generated once by `src/audit/images/make.py` (pure stdlib `zlib` + `struct`, flat color with a 1px border so distortion is visible). The fake imports them with Vite's `?inline` and strips the `data:image/png;base64,` prefix for `Attachment.dataBase64`.
- `e-exam`: kind `exam-sim`, `msfHostId: "h-exam-ms01"`, timebox started 3h before `AUDIT_NOW`, 5 hosts.
- `e-old`: archived, so the dashboard's past table renders.
- Settings: every field non-empty, `fieldManualPath: "/Users/audit/Documents/Field-Manual"`.

- [ ] **Step 1: Write the failing tests** in `src/test/audit/fakeApi.test.tsx`
  - `it("implements every Api command")`: `expect(Object.keys(fake).sort()).toEqual(Object.keys(realApi).sort())`. Import the real one with `vi.importActual`. The real module calls Tauri lazily, so importing it is safe.
  - `it("stresses layouts")`, asserting on the fake's return values:
    - `(await api.engagementGet("e-lab")).name.length >= 70`;
    - `(await api.credentialsList("e-lab")).length === 12`;
    - `servicesList("h-web")` length ≥ 20, with ≥ 3 entries `protocol === "udp" && state === "open|filtered"`;
    - `hostsList("e-lab")` has an `adSet` windows host named `dc01`;
    - `engagementGet("e-exam")` has `kind === "exam-sim"` and `msfHostId === "h-exam-ms01"`;
    - `attachmentGet` for each of the 4 screenshot entries returns `mime: "image/png"` and base64 whose PNG IHDR width/height (bytes 16–23) equal the fixture's declared size;
    - some `logList("e-lab")` command text matches `/[A-Za-z0-9+/]{200,}={0,2}/` and some matches `/C:\\Program Files \(x86\)\\/`.
  - `it("mutations persist until reload")`: `hostMove("h-web", "reporting")`, after which `hostsList` reflects it. Then `resetAuditState()` (exported from `fakeApi.ts` and called once at module load) restores the fixtures.
  - `it("boots the app past the vault")`: `vi.mock("../../lib/api", () => import("../../audit/fakeApi"))`, render `<App/>` in `MemoryRouter` at `/`, and `findByText` the `e-lab` name. No unlock screen appears.
- [ ] **Step 2: Run to verify they fail.** Run `npx vitest run src/test/audit/fakeApi.test.tsx`. Expected: FAIL, cannot resolve `../../audit/fakeApi`.
- [ ] **Step 3: Implement `src/audit/fixtures.ts` and `src/audit/fakeApi.ts`.** The store is a `structuredClone(FIXTURES)` held in a module variable. `const api = { … } satisfies Api`. Use the real types from `src/types/*`. Where a command needs derived fields (e.g. `Host.adSetEffective`, `boardDerived`), set them in the fixture rather than reimplementing engines.
- [ ] **Step 4: Run tests.** `npx vitest run src/test/audit/fakeApi.test.tsx`: PASS. `npm run typecheck`: PASS.
- [ ] **Step 5: Implement `src/audit/vitePlugin.ts` and wire it in `vite.config.ts`.** Add the `dev:audit` script.
- [ ] **Step 6: Verify isolation both ways.**
  - Run `npx vite build --mode audit --outDir "$TMPDIR/raven-audit-dist" && grep -l "Acme Corp" "$TMPDIR"/raven-audit-dist/assets/*.js`. Expected: a match (the fake is in).
  - Run `npm run build && ! grep -l "Acme Corp" dist/assets/*.js`. Expected: exit 0 (the fake is out of the normal build).
  - Run `npm run dev:audit`, then `curl -s localhost:5199 | grep -c root`. Expected: `1`. Stop the server.
- [ ] **Step 7: Run the full suite.** `npm test && npm run lint`: all pass.
- [ ] **Step 8: Commit.** `git commit -m "feat(audit): audit mode with in-memory fake backend and stress fixtures"`

---

### Task 2: Layout and accessibility checks, with a self-test page

**Files:**
- Create: `audit/types.ts`
- Create: `audit/checks/layout.ts` — `collectLayoutIssues`, self-contained (no imports and no outer-scope references, because it is passed to `page.evaluate`)
- Create: `audit/checks/a11y.ts` — `collectA11yIssues`
- Create: `audit/fixtures/selftest-layout.html`
- Create: `audit/selftest.spec.ts`
- Create: `audit/playwright.config.ts` — `testDir: "audit"`, Chromium project, `use` per Global Constraints. The `webServer` is added in Task 3.
- Modify: `package.json` — devDeps `@playwright/test`, `@axe-core/playwright`; script `"audit:selftest": "playwright test -c audit/playwright.config.ts selftest"`
- Modify: `.gitignore` — `audit-output/`, `test-results/`, `playwright-report/`
- Modify: `eslint.config.js` / `tsconfig.node.json` so `audit/**/*.ts` is linted and typechecked (node + DOM libs)

**Interfaces:**
- Produces:
  - `audit/types.ts`:
    ```ts
    export type CheckId =
      | "page-overflow" | "overflow" | "truncated" | "clipped" | "offscreen" | "overlap"
      | "squeezed" | "oversized-control" | "mid-token-wrap"
      | "contrast" | "label"
      | "focus-invisible" | "focus-hidden" | "unreachable" | "focus-trap" | "shortcut"
      // UX (Tasks 5–6 implement these; declared here so the union lives in one place)
      | "hierarchy-flat" | "tight-stack" | "off-scale-spacing" | "tiny-text" | "long-lines"
      | "image-distorted" | "image-cropped"
      | "small-target" | "color-noise" | "competing-primaries" | "unreduced-motion"
      | "missing-empty-state" | "blank-loading" | "silent-error"
      | "flow-over-budget" | "flow-needs-mouse" | "flow-slow";
    export interface RawIssue { check: CheckId; selector: string; detail: string }
    export interface Issue extends RawIssue { screen: string; width: number }
    ```
  - `collectLayoutIssues(): RawIssue[]`, run via `page.evaluate(collectLayoutIssues)`.
  - `collectA11yIssues(page: Page): Promise<RawIssue[]>`.

**Rules for `collectLayoutIssues`.** Only visible elements count: a non-zero rect, `visibility` not hidden, `opacity` > 0. Tolerance is 1px.
- `page-overflow`: `documentElement.scrollWidth > innerWidth`.
- `overflow`: `scrollWidth > clientWidth` where `overflow-x` is `visible` or `hidden` (`auto`/`scroll` are intentional scrollers, so skip them) and `text-overflow` is not `ellipsis`.
- `truncated`: `text-overflow: ellipsis` and `scrollWidth > clientWidth`; or `-webkit-line-clamp` set and `scrollHeight > clientHeight`. Skip elements with a `title` attribute or an ancestor-or-self with `data-audit-allow="truncate"`.
- `clipped`: `overflow-y: hidden` with text children and `scrollHeight > clientHeight`, when not already reported as `truncated`.
- `offscreen`: an interactive element (`button, a[href], input, select, textarea, [role=button|tab|checkbox|switch|menuitem]`) whose rect lies partly outside the viewport horizontally, or outside its nearest scrolling ancestor's horizontal bounds.
- `overlap`: two visible interactive elements whose rects intersect by > 4px on both axes, where neither contains the other.
- `squeezed`: an element whose own text has ≥ 3 words, rendered width < 80px, and height ≥ 3 × its computed line-height. This is the "one word per line" bug.
- `oversized-control`: a `button` whose text is ≤ 12 chars and whose width > 40% of its parent's width, when the parent is ≥ 400px wide. This is the "Copy is 50% wide" bug.
- `image-distorted`: a visible `img` with `naturalWidth > 0` whose computed `object-fit` is `fill` (the default) or `scale-down`, where the rendered ratio `clientWidth / clientHeight` differs from `naturalWidth / naturalHeight` by more than 2%. Detail: `"natural 2400×300 (8.00) rendered 640×300 (2.13)"`.
- `image-cropped`: the same mismatch with `object-fit: cover`. The ratio is kept, but part of the screenshot is hidden.
- `mid-token-wrap`: inside `code, pre, kbd, [data-command]`, a whitespace-delimited token of ≤ 40 chars whose `Range.getClientRects()` spans more than one line top. Check at most 300 tokens per page.

**`selector` format:** the first match among `[data-testid=…]`, `role[name="…"]` (from `aria-label`, else trimmed text ≤ 40 chars), then a `tag.class1.class2` path of up to 3 ancestors. `detail` gives the measured numbers, e.g. `"scrollWidth 812 > clientWidth 640"`.

**`collectA11yIssues`:** `new AxeBuilder({ page }).withRules(["color-contrast", "label", "button-name", "link-name", "aria-input-field-name", "select-name"]).analyze()`. Each violation node maps to one `RawIssue`: `check` is `"contrast"` for `color-contrast` and `"label"` otherwise, `selector` is `node.target.join(" ")`, `detail` is `node.failureSummary` (first line).

- [ ] **Step 1: Write `audit/fixtures/selftest-layout.html`.** It is static HTML with a fixed `width: 900px` viewport. Every case is a `<section data-case="…" data-expect="<CheckId>|none">` holding a minimal reproduction:
  - `overflow`, `truncated`, `clipped`, `offscreen`, `overlap`, `squeezed`, `oversized-control`, `mid-token-wrap`, `contrast` (`#777` on `#888`), `label` (bare `<input>`);
  - `image-distorted` (a 400×100 PNG data URL forced to `width:200px;height:200px`), `image-cropped` (same box with `object-fit:cover`);
  - the clean cases `image-ok` (`max-width:100%; max-height:120px` with auto width and height, exactly like `AttachmentImage`), `scroller-ok` (`pre` with `overflow-x:auto`), `truncate-titled-ok` (ellipsis with `title`), `allow-ok` (`data-audit-allow="truncate"`), `wrap-ok` (long text wrapping at spaces).
- [ ] **Step 2: Write `audit/selftest.spec.ts`.** It loads the file via `page.goto("file://…")` at 900×800 and runs both collectors.
  - Test `each expected case is flagged with its check`: for every `[data-expect]` other than `none`, some issue has that `check` and a `selector` that resolves (`page.locator(selector)`) inside that section.
  - Test `clean cases produce no issues`: no issue's element sits inside a `data-expect="none"` section.
- [ ] **Step 3: Run to verify it fails.** `npx playwright install chromium && npm run audit:selftest`. Expected: FAIL, the collectors are not implemented.
- [ ] **Step 4: Implement `audit/types.ts`, `audit/checks/layout.ts` and `audit/checks/a11y.ts`** per the rules above.
- [ ] **Step 5: Run to verify it passes.** `npm run audit:selftest`: 2 passed. Also `npm run typecheck && npm run lint`: pass.
- [ ] **Step 6: Commit.** `git commit -m "feat(audit): in-page layout checks and axe checks with self-test page"`

---

### Task 3: Screens, runner, screenshots and report (`npm run audit:visual`)

**Files:**
- Create: `audit/screens.ts`
- Create: `audit/visual.spec.ts`
- Create: `audit/report.ts` — global teardown
- Create: `audit/README.md` — 10 lines: how to run, where output goes, the `data-audit-allow` escape hatch
- Modify: `audit/playwright.config.ts`:
  - `webServer: { command: "npm run dev:audit", url: "http://localhost:5199", reuseExistingServer: false }`;
  - `baseURL`;
  - `globalTeardown: "./report.ts"`;
  - `reporter: [["list"]]`;
  - `fullyParallel: true`.
- Modify: `package.json` — `"audit:visual": "playwright test -c audit/playwright.config.ts"`. This runs selftest, visual and (later) keyboard together.

**Interfaces:**
- Consumes: `AUDIT_IDS` and `AUDIT_NOW` (Task 1); `collectLayoutIssues`, `collectA11yIssues`, `Issue` (Task 2).
- Produces:
  - `audit/screens.ts`:
    ```ts
    export interface Screen { id: string; path: string; ready: string; setup?: (page: Page) => Promise<void> }
    export const WIDTHS = [900, 1024, 1280, 1440] as const;
    export const SCREENS: Screen[];
    ```
    Here `ready` is a Playwright selector that must be visible before checks run.
  - `writeIssues(screen: string, width: number, issues: RawIssue[]): Promise<void>`, exported from `audit/report.ts`. It writes `audit-output/issues/<screen>@<width>.json`, and Task 4 reuses it.
  - The default export of `audit/report.ts` merges every issues file into:
    - `audit-output/report.json`, an `Issue[]` sorted by screen, width, check;
    - `audit-output/report.md`, with a summary table of counts per check × width, then one `## <screen>` section per screen. Each lists `- [<width>] **<check>** \`<selector>\` — <detail>` and links `shots/<screen>@<width>.png`. Duplicate (check, selector) rows across widths collapse into one line listing the widths.

**`SCREENS`** (ids are exact; shorthand: `E = /e/e-lab`, `H = /e/e-lab/h/h-web`):

| id | path | setup |
|---|---|---|
| `dashboard` | `/` | — |
| `board` | `E` | — |
| `host-story` | `H` | — (Now panel visible) |
| `host-checklist` | `H` | click tab "Checklist"; expand GoalRow's new-credentials notice |
| `host-credentials` | `H` | click tab "Credentials" |
| `host-findings` | `H` | click tab "Findings" |
| `host-stuck` | `H` | press `h` |
| `dc-story` | `/e/e-lab/h/h-dc01` | — |
| `eng-checklist` | `E/s/checklist` | scroll the Lateral movement group into view |
| `credentials` | `E/s/credentials` | — |
| `findings` | `E/s/findings` | open the finding with 6 steps |
| `log` | `E/s/log` | — |
| `log-images` | `E/s/log` | scroll the `wide` screenshot entry into view; `ready` waits until all 4 attachment `img`s have `complete && naturalWidth > 0` |
| `capture-image` | `H` | press `l`, then paste the `tall` PNG (in-page: build a `File` from the inline data URL, dispatch a `paste` `ClipboardEvent` with a `DataTransfer` on the paste area); `ready` waits for the preview `img` to load |
| `exam-board` | `/e/e-exam` | — (MSF lock visible) |
| `exam-host-locked` | `/e/e-exam/h/h-exam-ms01` | open the Checklist tab, where MSF items are locked |
| `settings` | `/settings` | scroll Field Manual section into view |
| `palette` | `H` | press `Meta+K`, type `smb` |
| `palette-hostmenu` | `H` | `Meta+K`, then `Alt+H` (opens the host picker) |
| `arsenal-drawer` | `H` | press `a`, type `kerberos` |
| `arsenal-browse` | `/arsenal` | — |
| `transfer-generator` | `/arsenal` | pick engagement `e-lab` / host `h-web` so the TransferGenerator renders |

`ready` per screen is the most specific stable element. Prefer roles: `role=tablist`, `role=dialog`, a heading.

**Per test** (one test per screen × width, named `<id>@<width>`):
1. `page.setViewportSize({ width, height: 900 })`.
2. `page.clock.install({ time: AUDIT_NOW })`.
3. `goto(path)`, then `setup`, then wait for `ready`.
4. `await page.evaluate(() => document.fonts.ready)`.
5. Run `collectLayoutIssues` and `collectA11yIssues`, then `writeIssues`.
6. `page.screenshot({ path: shots/<id>@<width>.png, fullPage: true, animations: "disabled" })`.
7. Fail the test if `ready` never appears or the page logs a `pageerror`.

- [ ] **Step 1: Write `audit/visual.spec.ts` and `audit/screens.ts`** with the `dashboard` screen only, plus the teardown with the report format above.
- [ ] **Step 2: Run** `npx playwright test -c audit/playwright.config.ts visual`. Expected: 4 passed, and `audit-output/shots/dashboard@{900,1024,1280,1440}.png` plus `audit-output/report.md` exist.
- [ ] **Step 3: Add the remaining 21 screens** from the table.
- [ ] **Step 4: Run** `npm run audit:visual`. Expected: selftest passes, 88 visual tests pass (22 × 4), and `ls audit-output/shots | wc -l` → `88`. Fix any `ready`/`setup` selector that times out by correcting the selector, never by loosening `ready` to `body`.
- [ ] **Step 5: Sanity-check that the report shows real bugs.** Open `audit-output/report.md`. It must have a summary table and at least one section. Read 4 screenshots (`host-checklist@900`, `log@1024`, `palette@1280`, `log-images@900`) to confirm they show the stress data and not a blank or unlock screen. Do not fix the issues found in this task. They are the review output.
- [ ] **Step 6: Commit.** `git commit -m "feat(audit): screens, screenshots and report for npm run audit:visual"`

---

### Task 4: Keyboard-only navigation checks

**Files:**
- Create: `audit/checks/keyboard.ts`
- Create: `audit/fixtures/selftest-keyboard.html`
- Create: `audit/keyboard.spec.ts`
- Modify: `audit/selftest.spec.ts` — add keyboard self-test cases
- Modify: `audit/report.ts` — the summary table gains the keyboard checks, so no format change is needed if it iterates over `CheckId`s present

**Interfaces:**
- Consumes: `SCREENS`, `AUDIT_IDS`, `writeIssues`, `RawIssue` (Tasks 1–3).
- Produces:
  - `tabWalk(page: Page, opts?: { maxStops?: number }): Promise<RawIssue[]>`. The default `maxStops` is 150.
  - `checkShortcut(page: Page, s: ShortcutCase): Promise<RawIssue[]>`, where
    ```ts
    export interface ShortcutCase {
      id: string; path: string; keys: string[];          // e.g. ["Meta+K"]
      opens: string;                                      // selector that must become visible
      focusInside: boolean;                               // focus must land inside `opens`
      closesWithEscape: boolean;
    }
    export const SHORTCUTS: ShortcutCase[];
    ```

**`tabWalk` rules:**
- Before walking, collect the visible interactive elements (same selector as `offscreen` in Task 2, plus `[tabindex]:not([tabindex="-1"])`).
- Then press `Tab` up to `maxStops` times. At each stop, read `document.activeElement`:
  - `focus-invisible`: compare the computed `outline-style`, `outline-width`, `outline-color`, `box-shadow`, `border-color`, `background-color` and `text-decoration-line` with focus against the same element after `blur()`. Then re-focus with `el.focus()`; Chromium keeps keyboard modality, so `:focus-visible` still applies. If nothing differs, report it.
  - `focus-hidden`: the focused element has a zero-size rect, is `visibility:hidden`, has `opacity` 0, or stays outside the viewport after the browser's focus scroll.
- The walk ends when focus returns to the first stop or to `body`.
- `focus-trap`: `maxStops` was reached without cycling and no `[role=dialog]` is open.
- `unreachable`: an interactive element never focused. Exception: members of `[role=tablist|listbox|menu|radiogroup]` count as reached when any member of the same group was reached.

**Screens walked:** every `SCREENS` entry at width **1280 only**. Issues are written via `writeIssues(screen.id + ":kbd", 1280, …)`.

**`SHORTCUTS`** (all at 1280):

| id | path | keys | opens | focusInside | closesWithEscape |
|---|---|---|---|---|---|
| `palette` | `H` | `Meta+K` | palette dialog | yes | yes |
| `palette-hostpick` | `H` | `Meta+K`, `Alt+H` | host picker | yes | yes |
| `arsenal` | `H` | `a` | Arsenal drawer | yes | yes |
| `stuck` | `H` | `h` | stuck view | no | yes |
| `capture` | `H` | `l` | capture panel | yes | yes |
| `notes` | `H` | `n` | notes panel | yes | yes |
| `new-engagement` | `/` | `Meta+N` | engagement dialog | yes | yes |
| `board-move` | `E` | focus first board card, `]` | that card now in the next column | no | no |

**`checkShortcut`:** press the keys and expect `opens` visible within 1s, else report `shortcut` with detail `"<keys> did not open <opens>"`. If `focusInside` is set, `activeElement` must be inside `opens`. If `closesWithEscape` is set, press `Escape`: `opens` must be hidden and focus must not be lost to a detached node (`document.activeElement.isConnected`).

- [ ] **Step 1: Write `audit/fixtures/selftest-keyboard.html`.** Cases use `data-expect`:
  - `focus-invisible`: a button with `outline: none` and no other focus style;
  - `unreachable`: a `div role=button` with no tabindex;
  - `focus-trap`: an input whose keydown handler cancels Tab and refocuses itself;
  - `roving-ok`: a tablist with one `tabindex=0` tab and two `tabindex=-1` tabs;
  - `focus-ok`: a button with a visible `:focus-visible` ring.
- [ ] **Step 2: Add self-tests to `audit/selftest.spec.ts`.**
  - `tabWalk flags each keyboard case`: same assertion shape as Task 2.
  - `tabWalk leaves roving and styled cases alone`.
  - The trap case lives in its own section, loaded on a separate page, so it doesn't stop the walk for the others.
- [ ] **Step 3: Run to verify it fails.** `npm run audit:selftest`. Expected: the keyboard tests FAIL, `tabWalk` is not defined.
- [ ] **Step 4: Implement `audit/checks/keyboard.ts`** (`tabWalk`, `checkShortcut`, `SHORTCUTS`).
- [ ] **Step 5: Run.** `npm run audit:selftest`: all pass.
- [ ] **Step 6: Write `audit/keyboard.spec.ts`.** It has one test per screen (`<id>:kbd`) and one per shortcut (`shortcut:<id>`). Shortcut issues go to `writeIssues("shortcut:" + id, 1280, …)`.
- [ ] **Step 7: Run the whole audit.** `npm run audit:visual`. Expected: every test passes (selftest + 88 visual + 22 walks + 8 shortcuts). `report.md` contains `:kbd` and `shortcut:` sections whenever issues exist. `npm test && npm run typecheck && npm run lint` pass.
- [ ] **Step 8: Commit.** `git commit -m "feat(audit): keyboard-only navigation checks (tab walk, focus visibility, shortcuts)"`

---

### Task 5: Static UX checks — hierarchy and spacing, targets, noise

**Files:**
- Create: `audit/checks/ux.ts` — `collectUxIssues`, self-contained like `collectLayoutIssues`
- Create: `audit/fixtures/selftest-ux.html`
- Modify: `audit/selftest.spec.ts` — UX cases
- Modify: `audit/visual.spec.ts` — call `collectUxIssues` next to the layout checks, on every screen × width

**Interfaces:**
- Consumes: `RawIssue`, `CheckId` (Task 2); `writeIssues` (Task 3).
- Produces: `collectUxIssues(): RawIssue[]`, run via `page.evaluate`. It reads the accent color from `getComputedStyle(document.documentElement).getPropertyValue("--accent")`.

**Rules.** Raven's font is JetBrains Mono, so 1ch = 0.6 × font-size. "Viewport" means the first 900px of height. Elements inside an open `[role=dialog]` are judged against the dialog only.
- **`hierarchy-flat`:** for each heading-like element (`h1–h6`, `[role=heading]`, or any element whose computed `font-weight ≥ 600` and whose text ≤ 60 chars starts a block followed by body text), compare it with the first following text block in the same container. Report it if the heading's font-size < 1.1 × the body's **and** its weight difference < 200 **and** its color equals the body's. Detail: `"heading 13px/600 vs body 13px/400, same color"`.
- **`tight-stack`:** two adjacent sibling command blocks (`pre`, `code` blocks that are `display:block`, `[data-command]`) with a vertical gap < 8px.
- **`off-scale-spacing`:** collect computed `margin-*`, `padding-*`, `gap`, `row-gap` and `column-gap` values that are not multiples of 2px. Ignore 0 and 1px hairlines. Report **one** issue per screen listing the 5 most frequent values with their counts. The selector is `"(page)"`.
- **`tiny-text`:** visible text with computed font-size < 12px.
- **`long-lines`:** a non-code text block (`p, li, [role=note]`, or a `div` with direct text) whose width in ch exceeds 100.
- **`small-target`:** an interactive element (Task 2 selector) whose rect is < 24×24, unless it is an `a` inline in running text. `Button size="sm"` is `h-6` = 24px, which passes.
- **`color-noise`:** the distinct saturated hues in the viewport. Gather text, background and border colors whose HSL saturation > 30% and lightness is between 20% and 85%, bucketed by hue in 30° bins. Report it if there are > 3 buckets, since Ink is a single-accent theme. Detail lists the buckets with an example selector each.
- **`competing-primaries`:** > 1 visible `[data-variant="primary"]` in the viewport (or within one dialog).
- **`unreduced-motion`:** under `reducedMotion: "reduce"`, any `document.getAnimations()` entry that is running with `iterations === Infinity` or a duration > 200ms. Spinners shown only during loading are allowed when they carry `data-audit-allow="motion"`.

- [ ] **Step 1: Write `audit/fixtures/selftest-ux.html`.** It has one `data-expect` section per rule above:
  - `hierarchy-flat`: a 13px/400 "heading" over 13px body;
  - `tight-stack`: two `pre` with a 2px gap;
  - `off-scale-spacing`: `padding: 7px`, three times;
  - `tiny-text`: 10px;
  - `long-lines`: a 160-char paragraph in a 1200px box;
  - `small-target`: a 16×16 icon button;
  - `color-noise`: red, green, blue and purple text plus the accent;
  - `competing-primaries`: two `data-variant="primary"` buttons;
  - `unreduced-motion`: an infinite CSS animation.

  It also has these clean cases:
  - `hierarchy-ok`: 15px/600 over 13px/400;
  - `stack-ok`: a 12px gap;
  - `target-inline-ok`: a link in a sentence;
  - `motion-allowed-ok`: a spinner with `data-audit-allow="motion"`.

  The page's `:root` sets `--accent` to Raven's value. Each case lives in its own `iframe srcdoc`, because the viewport-wide rules (color-noise, primaries, off-scale) would otherwise bleed between cases.
- [ ] **Step 2: Add self-tests** `ux checks flag each case` and `ux checks leave clean cases alone`, with the same shape as Task 2. Each runs the collector inside its case's frame.
- [ ] **Step 3: Run to verify it fails.** `npm run audit:selftest`. Expected: the UX tests FAIL.
- [ ] **Step 4: Implement `audit/checks/ux.ts`.**
- [ ] **Step 5: Run.** `npm run audit:selftest`: all pass.
- [ ] **Step 6: Wire it into `visual.spec.ts`, then run** `npm run audit:visual`. Expected: every test passes, and `report.md` shows UX checks in the summary table.
- [ ] **Step 7: Commit.** `git commit -m "feat(audit): UX checks for hierarchy, spacing, targets and visual noise"`

---

### Task 6: UX flows and states — friction budgets, empty, loading and error

**Files:**
- Modify: `src/audit/fakeApi.ts` — scenario support
- Modify: `src/test/audit/fakeApi.test.tsx` — scenario tests
- Create: `audit/checks/flows.ts` — `FLOWS`, `runFlow`
- Create: `audit/checks/states.ts` — `collectStateIssues`
- Create: `audit/ux.spec.ts`

**Interfaces:**
- Consumes: `AUDIT_IDS`, `resetAuditState` (Task 1); `SCREENS`, `writeIssues` (Task 3); `RawIssue` (Task 2).
- Produces:
  - In `fakeApi.ts`: `type AuditScenario = "full" | "empty" | "loading" | "error"`, plus `scenarioFromSearch(search: string): AuditScenario`, which falls back to `"full"` for anything unknown, and `setAuditScenario(s: AuditScenario): void`. The setter also calls `resetAuditState()`. It is read once at module load from `window.location.search` (`?audit=…`). The scenarios:
    - `empty`: every list returns `[]` except `engagementsList` and `engagementGet`, which return only `e-lab` (with no hosts or data), so routes still resolve.
    - `loading`: every command except `vaultStatus`, `settingsGet`, `engagementsList` and `engagementGet` returns a never-settling promise.
    - `error`: the same commands reject with `new RavenError("io", "Audit: simulated failure")`. Match the real constructor signature in `src/types/errors.ts`.
  - `audit/checks/flows.ts`:
    ```ts
    export type FlowStep =
      | { press: string }                  // 1 action
      | { type: string }                   // 1 action (one field fill = one action)
      | { click: string; why: string }     // 1 action, and reported as flow-needs-mouse
      | { expect: string };                // 0 actions: waits for the selector, timed
    export interface Flow { id: string; path: string; budget: number; steps: FlowStep[]; done: string }
    export const FLOWS: Flow[];
    export function runFlow(page: Page, flow: Flow): Promise<RawIssue[]>;
    ```
  - `collectStateIssues(page: Page, scenario: Exclude<AuditScenario, "full">): Promise<RawIssue[]>`.

**`FLOWS`** (budgets are the spec for "low friction"; all start at width 1280):

| id | path | intended keyboard path | budget |
|---|---|---|---|
| `log-command` | `H` | `l` → type the command → `Meta+Enter` | 3 |
| `add-credential` | `H` | `l` → paste `administrator:Password123!` (intake detects the credential) → `Meta+Enter` | 3 |
| `next-step` | `E` | focus first board card → `Enter` → Now panel visible | 2 (+ the Tabs needed to reach the first card, counted) |
| `palette-run` | `H` | `Meta+K` → type `smb` → `Enter` (copies or fills the top command) | 3 |
| `arsenal-copy` | `H` | `a` → type `kerberoast` → `Enter` | 3 |
| `switch-host` | `H` | `Meta+K` → type `dc01` → `Enter` → lands on `/e/e-lab/h/h-dc01` | 3 |
| `stuck-and-back` | `H` | `h` → stuck view → `Escape` → back on host | 2 |

**`runFlow` rules:**
- Each `press`, `type` and `click` counts as 1 action, and each `Tab` press counts too.
- `flow-over-budget`: actions > budget. Detail: `"5 actions > budget 3: l, Tab, Tab, type, Meta+Enter"`.
- `flow-needs-mouse`: any `click` step. Its `why` names the missing keyboard path.
- `flow-slow`: the time from an action to the following `expect` becoming visible is > 200ms (the fake answers instantly, so this measures the UI itself).
- The flow fails as a test only if `done` never appears, which means it is broken, not merely slow.
- Write the steps as the shortest path that **actually works today**. If it exceeds the budget, keep the real steps and let the issue report it. Never pad the budget to make it pass.

**`collectStateIssues` rules** (run on every `SCREENS` entry whose path is under `/e/` or `/arsenal`, at 1280, with `?audit=<scenario>` appended):
- `missing-empty-state` (`empty`): a main-content region (`main` and every `role=tabpanel` / `section` under it) that has no visible text beyond its own heading.
- `blank-loading` (`loading`): 500ms after navigation, the main content has neither visible text nor an element with `aria-busy="true"`, `role="progressbar"` or `role="status"`.
- `silent-error` (`error`): after 1s, no visible `role="alert"` and no visible text matching `/error|failed|couldn.?t|try again/i`.
- Each state also screenshots to `shots/<id>@1280~<scenario>.png`.

- [ ] **Step 1: Write the failing scenario tests** in `src/test/audit/fakeApi.test.tsx`:
  - `scenarioFromSearch("?audit=empty") === "empty"`;
  - `scenarioFromSearch("") === "full"`;
  - `scenarioFromSearch("?audit=bogus") === "full"`;
  - under `empty`, `credentialsList("e-lab")` resolves `[]` and `engagementGet("e-lab")` resolves;
  - under `error`, `hostsList` rejects with a `RavenError` and `vaultStatus` resolves;
  - under `loading`, `hostsList` is still pending after `await new Promise(r => setTimeout(r, 50))` (race it against a sentinel).

  To test each scenario, set the module's scenario through an exported `setAuditScenario(s: AuditScenario)` (test-only seam; module load calls it with `scenarioFromSearch(location.search)`).
- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/test/audit/fakeApi.test.tsx`. Expected: FAIL, `scenarioFromSearch` is not exported.
- [ ] **Step 3: Implement scenario support** in `src/audit/fakeApi.ts`.
- [ ] **Step 4: Run.** `npx vitest run src/test/audit/fakeApi.test.tsx`: PASS.
- [ ] **Step 5: Implement `audit/checks/flows.ts` and `audit/checks/states.ts`, then write `audit/ux.spec.ts`.**
  - One test per flow, `flow:<id>`; issues go to `writeIssues("flow:" + id, 1280, …)`.
  - One test per state screen and scenario, `<id>~<scenario>`; issues go to `writeIssues(id + "~" + scenario, 1280, …)`.
- [ ] **Step 6: Verify the checks bite.** Temporarily set `log-command`'s budget to 1 and run `npx playwright test -c audit/playwright.config.ts ux -g log-command`. Expected: `report.md` has a `flow-over-budget` line for `flow:log-command`. Restore the budget to 3.
- [ ] **Step 7: Run everything.** `npm run audit:visual && npm test && npm run typecheck && npm run lint`. Expected: all pass, and `report.md` has `flow:` and `~empty` / `~loading` / `~error` sections whenever issues exist.
- [ ] **Step 8: Commit.** `git commit -m "feat(audit): friction budgets for core flows and empty, loading and error state checks"`

---

## After the last task (not a task: the review pass)

Run `npm run audit:visual` once more, then read `audit-output/report.md` and every screenshot at 900 and 1280 (the extremes that matter most), plus the `~empty`, `~loading` and `~error` shots. Write the triage as the PR's findings list:
- automated issues, grouped by root cause;
- flow budgets that were exceeded, with the real step list;
- eye-review issues (spacing, hierarchy, awkward wrapping), each with its screenshot path.

Layout and UX fixes go on a follow-up branch, not this one.
