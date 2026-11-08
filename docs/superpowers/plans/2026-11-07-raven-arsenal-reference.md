# Arsenal as a Command Reference: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Raven's Arsenal into a complete, category-organised command reference. Commands it produces must be correct: the right credential filled, an unfilled placeholder caught before copy, and the host never switched by accident. Browse becomes three panes, and the app moves to its own interface font.

**Architecture:**
- **Two new pure engine modules feed every surface:**
  - `src/engines/library/categories.ts`: the category set, labels, aliases, and a category for every command;
  - `src/engines/library/arsenalSearch.ts`: relevance ranking plus grouping by category.
- **Shared fill controls:** `HostChip`, `CredChip` and `FillBar`.
- **Copy guard:** a pure `guardCopy` plus the `useCopyGuard` hook.
- **Who uses them:** the drawer, ⌘K, browse and the card reading view.
- **The host only fills.** Nothing reads the host to rank or filter.

**Tech Stack:** React 19, TypeScript, Tailwind 4, zustand, TanStack Query, Vitest + Testing Library, Playwright (`audit/`), Tauri 2 (Rust settings validation).

**Spec:** `docs/superpowers/specs/2026-11-07-raven-arsenal-reference-design.md`. Read it before any task: section numbers below (§4.x) refer to it.

## Global Constraints

**Layout and look**
- Grid by default, with explicit tracks. Flexbox only for single-line runs (`PRODUCT.md` principle 5).
- Ink theme: one accent (`--accent` #c6ff00), no red, and `--warn` amber for warnings and unfilled values.
- No sideways scroll at any width from 800px.

**What the host may do**
- The host never filters, groups, folds or reorders Arsenal results. It only fills.
- Ranking is by query relevance only. Nothing folds; every match stays visible.

**Copy guard**
- An unresolved token means the first unfilled field gets focus instead of a copy.
- A second Enter, with that field still empty, copies anyway.
- The "Copied" confirmation names the host.

**Credential chip**
- It fills USER, DOMAIN and PASS/HASH from one pick in `useCredPickStore`, shared with the checklist.
- It has no Tab stop.

**Host chip**
- No Tab stop, and no `opacity-0` control anywhere.
- ⌥H or a click opens it.
- When the host changes, the chip and the IP flash once (reduced motion respected), and chip overrides are dropped.

**Rules and safety**
- Exam rules still fail closed: nothing is shown until the engagement kind is known.
- Data safety:
  - built-in categories live in code, so there is no migration;
  - any stored-data change needs a migration and a backup first.
- No new network calls. `obsidian://` is local, and the opener is scoped to that scheme only.

**Gates for every task:** `npm test`, `npm run lint` and `npm run typecheck` all pass. Rust tasks also need `cargo test` in `src-tauri`.

**Commits:** one per task, with message prefixes `feat(arsenal)`, `fix(…)` and so on. End each commit with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Visual check:** for UI tasks, the implementer looks at the rendered screen at 900 and 1440 using `npm run dev:audit` on port 5199. Never use port 3000 and never `tauri dev`.

## Review Focus

Each item names the input and the expected behaviour, and points to the task whose test pins it.

1. **An imported vault adds a folder that isn't in the code list** (e.g. `02-Cards/Cloud`). It shows as its own category, and nothing crashes or disappears. *Task 1: `extra vault folder becomes a category`.*
2. **An exam engagement bans every command in a category.** That category is hidden in pane 1 and in drawer search, and an empty query with exam rules not yet known shows nothing. *Task 2: `exam-banned category is dropped`; Task 7: `fails closed while the engagement loads`.*
3. **The picked credential is deleted, or is hash-only on a PASS template.**
   - Deleted: the pick falls back to the default.
   - Hash-only: the guard focuses the credential chip, and a second Enter copies the literal `{PASS}`.

   *Task 3: `deleted pick falls back`; Task 6: `hash-only credential guards PASS on the chip`.*
4. **The route's host changes while the drawer is open with overrides typed.** The chip follows the route and the overrides drop. *Task 7: `route host change resets chip and overrides`.*
5. **The copy guard is armed, and then the user fills the field or moves to another result.** The arm resets, so the next Enter copies only when everything is resolved or the guard re-arms on the new command. *Task 6: `arm resets when the command or its unresolved set changes`.*

---

## File map

| File | Responsibility |
|---|---|
| `src/engines/library/categories.ts` (new) | `CATEGORIES`, `categoryLabel`, `CATEGORY_ALIASES`, `categoryOf`, `allCategories` |
| `src/engines/library/arsenalSearch.ts` (new) | `searchArsenal`: relevance scoring and category groups |
| `src/engines/library/types.ts` | `LibraryCommand.category?: string` |
| `src/engines/library/data/*.ts` | per-file `DEFAULT_CATEGORY` plus per-entry overrides |
| `src/features/palette/search.ts` | `searchPalette`, rebuilt on `searchArsenal`, plus engagement items and hosts |
| `src/engines/checklist/fill.ts` | password-preferred defaults |
| `src/features/palette/fillData.ts` | no-host domain credential; pick key |
| `src/features/arsenal/HostChip.tsx` (new; replaces `HostPicker.tsx`) | visible listbox host picker |
| `src/features/arsenal/CredChip.tsx` (new) | credential picker chip |
| `src/features/arsenal/FillBar.tsx` (new) | host chip, credential chip and fill fields, in a stable order |
| `src/features/arsenal/copyGuard.ts` (new) | `guardCopy` (pure) and `useCopyGuard` |
| `src/features/checklist/CommandList.tsx` | guarded copy and the "Copied for <host>" confirmation |
| `src/features/arsenal/ArsenalDrawer.tsx` | drawer rework |
| `src/features/palette/Palette.tsx` | ⌘K rework |
| `src/features/arsenal/CardView.tsx` | reading view: contents strip, j/k/c, Also in Raven, Field Manual link |
| `src/features/arsenal/ArsenalBrowse.tsx` | three panes |
| `src/features/generators/TransferGenerator.tsx`, `src-tauri/src/settings.rs`, `src/features/settings/SettingsPage.tsx` | generator fixes and Kali path validation |
| `src/engines/credentials/paste.ts` (new), `src/features/credentials/CredentialForm.tsx` | `user:pass` paste |
| `src/styles/tokens.css`, `src/main.tsx`, `PRODUCT.md` | Instrument Sans |
| `src/audit/fixtures.ts`, `audit/screens.ts`, `audit/regressions.spec.ts` | audit coverage |

---

### Task 1: Categories, labels, aliases and a category for every command

**Files:**
- Create: `src/engines/library/categories.ts`
- Modify: `src/engines/library/types.ts`, every built-in data file in `src/engines/library/data/` (except `fieldManual.ts`, whose commands take their card's category)
- Test: `src/test/categories.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES: readonly string[]`: the 12 vault slugs, verbatim: `AV-Evasion, Active-Directory, Client-Side-Attacks, Enumeration, Exploitation, Password-Attacks, Pivoting, Post-Exploitation, PrivEsc-Linux, PrivEsc-Windows, Shells-and-Transfers, Web`.
  - `categoryLabel(slug: string): string`, e.g. `Active-Directory` → `Active Directory`, `Shells-and-Transfers` → `Shells & transfers`, `PrivEsc-Windows` → `PrivEsc Windows`. Unknown slugs get dashes turned into spaces. This moves out of `ArsenalDrawer.tsx`; re-export there until Task 7 removes it.
  - `CATEGORY_ALIASES: Record<string, string[]>`, with the values from spec §4.1.
  - `categoryOf(c: LibraryCommand, cards: CardMeta[]): string`, returning the first that applies:
    1. the card's category, when `cardId` resolves;
    2. `c.category`;
    3. `"Other"`.
  - `allCategories(cards: CardMeta[]): string[]`: `CATEGORIES` plus any card category not already in it, sorted by label.
  - `LibraryCommand.category?: string`.

- [ ] **Step 1: Write the failing tests** in `src/test/categories.test.ts`:
```ts
it("every built-in command has a category from CATEGORIES", () => {
  for (const c of BUILTIN_LIBRARY.filter((c) => c.source !== "field-manual"))
    expect(CATEGORIES, c.id).toContain(c.category);
});
it("field-manual commands take their card's category", () => {
  const c = BUILTIN_LIBRARY.find((x) => x.cardId)!;
  expect(categoryOf(c, FIELD_MANUAL_CARDS)).toBe(FIELD_MANUAL_CARDS.find((k) => k.id === c.cardId)!.category);
});
it("pivot built-ins are Pivoting", () => {
  expect(PIVOT_COMMANDS.every((c) => c.category === "Pivoting")).toBe(true);
});
it("extra vault folder becomes a category", () => {
  const cards = [{ id: "x", title: "X", stage: "s", category: "Cloud", os: "any" as const, file: "02-Cards/Cloud/X.md" }];
  expect(allCategories(cards)).toContain("Cloud");
});
it("labels read as words", () => {
  expect(categoryLabel("Shells-and-Transfers")).toBe("Shells & transfers");
  expect(categoryLabel("Active-Directory")).toBe("Active Directory");
});
it("aliases cover lateral movement", () => {
  expect(CATEGORY_ALIASES["Pivoting"]).toEqual(expect.arrayContaining(["lateral movement", "tunneling", "port forwarding"]));
});
```
- [ ] **Step 2: Run** `npx vitest run src/test/categories.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `categories.ts` and add `category?: string` to `LibraryCommand`.

  **Tag the built-ins.** Give each data file a `DEFAULT_CATEGORY` and apply it with a map at export, overriding per entry where the tool says otherwise. File defaults:
  - `enum`, `enumServices`: `Enumeration`
  - `web`: `Web`
  - `foothold`: `Exploitation`
  - `windows`: `PrivEsc-Windows`
  - `linux`: `PrivEsc-Linux`
  - `loot`: `Post-Exploitation`
  - `pivot`: `Pivoting`
  - `ad`, `adUser`, `adUserPaths`: `Active-Directory`
  - `misc`: decide per entry

  Per-entry overrides, by tool or purpose:
  - listeners, reverse shells and transfers (penelope, nc listener, `python3 -m http.server`, certutil/iwr downloads): `Shells-and-Transfers`;
  - hashcat, john, hydra, sprays: `Password-Attacks`.
- [ ] **Step 4: Run** `npx vitest run src/test/categories.test.ts`. Expected: PASS. Then run `npm test && npm run typecheck`.
- [ ] **Step 5: Commit** with `feat(arsenal): categories for every command, labels and aliases`.

### Task 2: One relevance search, grouped by category

**Files:**
- Create: `src/engines/library/arsenalSearch.ts`
- Modify: `src/features/palette/search.ts`
- Test: `src/test/arsenalSearch.test.ts`; update `src/test/palette.test.tsx` where it asserted OS or stage boosts

**Interfaces:**
- Consumes (Task 1): `categoryOf`, `categoryLabel`, `CATEGORY_ALIASES`.
- Produces:
```ts
export type ArsenalHit =
  | { type: "command"; id: string; title: string; command: LibraryCommand; msfMarker: boolean }
  | { type: "card"; id: string; title: string; card: CardMeta }
  | { type: "generator"; id: string; title: string; category: string };
export interface ArsenalGroup { category: string; label: string; hits: ArsenalHit[] }
export function searchArsenal(query: string, ctx: {
  library: LibraryCommand[]; cards: CardMeta[]; generators: { id: string; title: string; category: string }[];
  exam?: { kind: EngagementKind; hostId: string; msfHostId?: string | null }; examPending?: boolean;
}): ArsenalGroup[];
```
- **Weights:** title 8, tool or tags 4, category name or alias 2, template (cards: file path) 1. A hit's score is the highest field it matched.
- **Matching:** every query word must prefix-match a word in some field. Keep the existing `wordsOf` and `matches` semantics, but treat a multi-word alias such as "lateral movement" as matched when the query words prefix its words.
- **Sort order:**
  - within a group, by score descending, then title alphabetically;
  - groups by their best score descending, then label.
- **Empty query:** returns every hit, grouped, with groups by label.
- **`searchPalette`:**
  - keeps its signature, minus `os` and `stageId` in `PaletteContext`;
  - returns `{ groups: ArsenalGroup[]; items: PaletteResult[] }`;
  - `items` are engagement items plus hosts. Add `kind: "host"` to `EngagementItem`; hosts are searched by name and IP.
  - Remove `score()`.
- **Generators in `src/features/palette/generators.ts`** gain `category`. Transfer is `Shells-and-Transfers`.

- [ ] **Step 1: Write the failing tests:**
```ts
it("title matches outrank template matches (smb)", () => {
  const g = searchArsenal("smb", { library: [FIND_CREDS /* template mentions smb */, PSEXEC /* title has SMB */], cards: [], generators: [] });
  const hits = g.flatMap((x) => x.hits);
  expect(hits[0]!.id).toBe(PSEXEC.id);
  expect(hits.map((h) => h.id)).toContain(FIND_CREDS.id); // still listed
});
it("cards and commands share a category group", () => {
  const g = searchArsenal("kerberos", { library: [KERBRUTE /* Active-Directory */], cards: [KERB_CARD /* Active-Directory */], generators: [] });
  expect(g).toHaveLength(1);
  expect(g[0]!.hits.map((h) => h.type).sort()).toEqual(["card", "command"]);
});
it("lateral movement finds Pivoting via alias", () => {
  const g = searchArsenal("lateral movement", { library: PIVOT_COMMANDS, cards: [], generators: [] });
  expect(g.map((x) => x.category)).toEqual(["Pivoting"]);
});
it("exam-banned category is dropped", () => {
  const g = searchArsenal("", { library: [BANNED_ONLY_IN_CAT], cards: [], generators: [], exam: { kind: "exam-sim", hostId: "h" } });
  expect(g.find((x) => x.category === BANNED_ONLY_IN_CAT.category)).toBeUndefined();
});
it("examPending returns nothing", () => {
  expect(searchArsenal("", { library: PIVOT_COMMANDS, cards: [], generators: [], examPending: true })).toEqual([]);
});
it("no host input exists: results never depend on a host", () => {
  // Type-level guard: ctx has no os/stageId fields.
  // @ts-expect-error os is not an input
  searchArsenal("x", { library: [], cards: [], generators: [], os: "windows" });
});
it("palette items include hosts by name and IP", () => {
  const r = searchPalette("10.10.20.21", { ...BASE, engagementItems: [{ id: "h1", kind: "host", title: "fs01", text: "10.10.20.21" }] });
  expect(r.items[0]!.id).toBe("h1");
});
```
- [ ] **Step 2: Run** `npx vitest run src/test/arsenalSearch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `searchArsenal`, and rewrite `searchPalette` on top of it. Update callers so they still compile: the Palette and the drawer flatten `groups` for now. Their UIs change in Tasks 7–8.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS. Fix palette tests that asserted OS ranking by asserting relevance instead.
- [ ] **Step 5: Commit** with `feat(arsenal): relevance search grouped by category; hosts in ⌘K items`.

### Task 3: Credential defaults and no-host fill

**Files:**
- Modify: `src/engines/checklist/fill.ts` (`defaultCredFor`, `defaultDomainCred`), `src/features/palette/fillData.ts` (`useFillBase`)
- Test: `src/test/credDefaults.test.ts`

**Interfaces:**
- Produces:
  - `defaultCredFor` and `defaultDomainCred` keep their signatures. Among credentials with a valid or admin attempt, prefer `type === "password"`, then the newest attempt.
  - `useFillBase(engagementId, hostId)` additionally returns:
    - `cred: Credential | null`;
    - `credOwnerId: string`: the `hostId`, or the `engagementId` when there's no host. This is the key into `useCredPickStore`.
  - With no host, `cred` is the pick for `engagementId`, else `defaultDomainCred`. `makeInput` passes `cred` even with no host.

- [ ] **Step 1: Write the failing tests:**
```ts
it("prefers a valid password over a newer valid hash on the host", () => {
  expect(defaultCredFor({ id: "h" }, [HASH_ADMIN, PW_SVC], [att(HASH_ADMIN, "h", 20), att(PW_SVC, "h", 10)])!.id).toBe(PW_SVC.id);
});
it("falls back to the newest when none has a password", () => {
  expect(defaultCredFor({ id: "h" }, [H1, H2], [att(H1, "h", 1), att(H2, "h", 2)])!.id).toBe(H2.id);
});
it("domain default prefers a password too", () => { /* same shape with authMode 'domain' */ });
it("deleted pick falls back", () => {
  // renderHook(useFillBase) with useCredPickStore picks { h: "gone" } → cred is the default
});
it("no host: cred is the engagement's domain default and fills USER", () => {
  // renderHook(useFillBase("e1", null)); fillCommand("{USER}", makeInput({})).text === PW_SVC.username
});
```
- [ ] **Step 2: Run** `npx vitest run src/test/credDefaults.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Make sure `HostChecklist` and `EngagementChecklist` still pass, since they share the defaults: update any expectation that encoded "newest hash wins".
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(fill): prefer passwords by default; fill credentials with no host`.

### Task 4: HostChip, a visible picker with no Tab stop

**Files:**
- Create: `src/features/arsenal/HostChip.tsx`
- Delete: `src/features/arsenal/HostPicker.tsx` (move `isHostPickKey` into `HostChip.tsx`)
- Modify: the call sites in `ArsenalDrawer.tsx`, `Palette.tsx` and `ArsenalBrowse.tsx`
- Test: `src/test/hostChip.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface HostChipHandle { open(): void }
export function HostChip(props: {
  hosts: Host[]; value: string | null; onChange: (hostId: string | null) => void;
  engagementName?: string; ref?: Ref<HostChipHandle>;
}): JSX.Element;
export const isHostPickKey: (e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string; key: string }) => boolean;
```
- **The chip:** a `<button tabIndex={-1}>` labelled `Fill for host: <short name>`, with `aria-haspopup="listbox"`. It shows the short name (`src/lib/hostName.ts`).
- **The list:**
  - opens below the chip as a `role="listbox"` with "No host" plus each host as `name  ip`;
  - arrows move, Enter picks, Esc closes and returns focus to whatever had it before;
  - typeahead works only inside the open list.
- **On change:** `data-flash` goes on the chip for 600ms. The drawer, ⌘K and browse also set `data-flash` on their filled-preview `<pre>` (Tasks 7, 8 and 10). CSS: an accent outline fade, skipped under `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing tests:**
```ts
it("is not in the Tab order", async () => { /* render inside a form with an input before/after; tab from first input lands on the last */ });
it("typing while focus is elsewhere never changes the host", async () => { /* type "sq" in the search input; onChange not called */ });
it("⌥H handle opens the list; Enter picks; onChange called with the id", async () => {});
it("flashes on change", async () => { /* after pick, chip has data-flash */ });
```
- [ ] **Step 2: Run** `npx vitest run src/test/hostChip.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and swap every `HostPicker` and `openPicker` use for `HostChip` and `ref.current?.open()`. Browse's native `<select aria-label="Host">` becomes a `HostChip` too.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Update the tests that drove `select[aria-label='Fill for host']` and the audit screen `palette-hostmenu` (its `ready` becomes `role=listbox[name='Fill for host']`).
- [ ] **Step 5: Commit** with `fix(arsenal): host chip is a visible picker with no Tab stop or typeahead`.

### Task 5: CredChip, FillBar and stable fill fields

**Files:**
- Create: `src/features/arsenal/CredChip.tsx`, `src/features/arsenal/FillBar.tsx`
- Modify: `src/features/arsenal/CardView.tsx` (`CommandPane` uses `FillBar`), `src/features/palette/Palette.tsx` (remove the PASS, HASH and CRED fields, and use `FillBar`)
- Test: `src/test/fillBar.test.tsx`

**Interfaces:**
- Consumes (Task 3): `useFillBase(...).cred` and `credOwnerId`; `useCredPickStore`; `credLabel`.
- Produces:
```ts
export interface CredChipHandle { open(): void; focus(): void }
export function CredChip(props: { credentials: Credential[]; value: Credential | null; onPick: (credId: string | null) => void; ref?: Ref<CredChipHandle> }): JSX.Element;
export const isCredPickKey: (e: KeyboardEvent | ReactKeyboardEvent) => boolean; // ⌥C by code "KeyC"
export function FillBar(props: {
  tokens: string[];                       // first-seen order from the templates; never PASS/HASH/CRED
  auto: Record<string, { text: string; unresolved: boolean; dcByName?: boolean }>;
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  suggest: SuggestContext; os: "linux" | "windows" | null;
  fieldRef?: (token: string, el: HTMLInputElement | null) => void;
}): JSX.Element;
```
- **CredChip:**
  - reads `as <credLabel> · password|hash ⌄`, or `as no credential ⌄`;
  - is a `tabIndex={-1}` button;
  - its list shows each credential with its kind and its tested state on the host (valid, admin, failed, untested from `attempts`), plus "No credential";
  - picking writes `useCredPickStore.set(credOwnerId, id)`.
- **Field order:** `tokensOf` order, and editing never reorders. Fixes `Palette.tsx:143-145`.
- **Field look:**
  - unfilled: amber label and amber outline;
  - auto-filled: the value as normal text (`text-fg-2`), not a placeholder;
  - "(by name)" shows once, on `DC_IP`.

- [ ] **Step 1: Write the failing tests:**
```ts
it("fields keep template order after editing one", async () => { /* tokens [LHOST, PORT]; type in LHOST; order still LHOST, PORT */ });
it("PASS never renders as a field", () => {});
it("picking a credential in the chip is shared with the host checklist", async () => {
  // pick in CredChip for h1 → useCredPickStore.getState().picks.h1 === cred id
});
it("auto-filled value shows as text, unfilled is amber", () => {});
it("DC by-name note shows once", () => {});
```
- [ ] **Step 2: Run** `npx vitest run src/test/fillBar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Put `CredChip` next to `HostChip` wherever `HostChip` is (Task 7, 8 and 10 placement; for now, in `CommandPane`'s header and the palette's search bar trailing area).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Rewrite palette test "a USER token offers the engagement's usernames…" for the credential chip (USER is no longer a typed field when a credential fills it).
- [ ] **Step 5: Commit** with `feat(arsenal): credential chip and stable fill fields`.

### Task 6: Copy guard and the "Copied for <host>" confirmation

**Files:**
- Create: `src/features/arsenal/copyGuard.ts`
- Modify: `src/features/checklist/CommandList.tsx`, `src/features/palette/Palette.tsx` (preview uses `CommandList`'s `Text` marking, or an exported `MarkedText`)
- Test: `src/test/copyGuard.test.tsx`

**Interfaces:**
- Produces:
```ts
export type GuardResult = { action: "copy" } | { action: "focus"; token: string };
export function guardCopy(cmd: { id: string; unresolved: string[] }, armed: { id: string; key: string } | null): GuardResult;
// key = cmd.id + "|" + unresolved.join(","); "copy" when unresolved is empty or armed matches key; else "focus" on unresolved[0].
export function useCopyGuard(opts: { focusToken: (token: string) => void; focusCred: () => void; hostName: string | null }): {
  attempt: (cmd: FilledCommand, doCopy: () => Promise<void>) => Promise<"copied" | "guarded">;
  hint: string | null;    // e.g. "{PASS} not filled · ↵ again to copy anyway"
  confirm: string | null; // "Copied for fs01" | "Copied for fs01 · 1 placeholder left"
};
```
- **Where focus goes:** PASS, HASH, CRED and USER go to `focusCred()`; any other token goes to `focusToken`.
- **Disarming:** the arm clears when the command id or its unresolved set changes.
- **Confirmation:** the text sits in the copy row, `role="status"`, in amber when placeholders are left. It clears after 2.5s.
- **Shared copy path:** `CommandList` copy buttons and `c`/Enter go through `attempt`.

- [ ] **Step 1: Write the failing tests:**
```ts
it("unresolved → focus first token; same command again → copy", () => {
  const r1 = guardCopy({ id: "a", unresolved: ["LHOST", "PORT"] }, null);
  expect(r1).toEqual({ action: "focus", token: "LHOST" });
  expect(guardCopy({ id: "a", unresolved: ["LHOST", "PORT"] }, { id: "a", key: "a|LHOST,PORT" })).toEqual({ action: "copy" });
});
it("arm resets when the command or its unresolved set changes", () => {
  expect(guardCopy({ id: "a", unresolved: ["PORT"] }, { id: "a", key: "a|LHOST,PORT" }).action).toBe("focus");
  expect(guardCopy({ id: "b", unresolved: ["LHOST"] }, { id: "a", key: "a|LHOST" }).action).toBe("focus");
});
it("hash-only credential guards PASS on the chip", async () => { /* render palette with hash cred on {PASS} template: Enter → cred chip focused, clipboard untouched; Enter again → clipboard has literal {PASS} */ });
it("Copy button in a card guards too and confirms with the host", async () => { /* status reads "Copied for dc01" */ });
it("⌘K preview marks unresolved tokens amber", () => { /* mark.text-warn contains {PORT} */ });
```
- [ ] **Step 2: Run** `npx vitest run src/test/copyGuard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire it into `CommandList` and the palette's `run()`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(arsenal): copy guard and host-named copy confirmation`.

### Task 7: Drawer: category list, grouped results, Enter copies, → into the card

**Files:**
- Modify: `src/features/arsenal/ArsenalDrawer.tsx`, `src/features/arsenal/useArsenalStore.ts` (add `blockId: string | null` and `openCard(cardId?, blockId?)`)
- Test: `src/test/arsenal.test.tsx` (extend)

**Interfaces:**
- Consumes: `searchArsenal` (Task 2), `HostChip`/`CredChip` (Tasks 4–5), `useCopyGuard` (Task 6).
- Produces: `useArsenalStore.openCard(cardId?: string, blockId?: string)`. `blockId` is a `LibraryCommand.id`, and Task 9 scrolls to it.
- **Empty query:** shows categories (label and count) as options. Enter or → on one lists that category's hits, and Esc goes back.
- **Results:**
  - groups come from `searchArsenal`;
  - structure is `role="listbox"` containing `role="group" aria-labelledby` per category, with a plain `<div id>` heading (not an `h3`) and options inside;
  - focus stays in the input, with `aria-activedescendant`;
  - the active row gets `ON` (`bg-accent/10 text-accent shadow-[inset_2px_0_0_var(--accent)]`);
  - rows are tagged `card`, or with the tool in mono.
- **Keys:**
  - Enter on a command copies, through the guard, with the filled preview and `FillBar` shown under the list for the selected command, as in ⌘K;
  - Enter on a card or generator opens it;
  - → on a command opens `openCard(cardId, command.id)`, or the solo view for card-less commands;
  - ⌘↵ copies and logs.
- **Header:** `grid grid-cols-[1fr_auto_auto_auto]` holding search, `HostChip`, `CredChip`, and the full-screen icon button (`aria-label="Full screen"`, Phosphor `ArrowsOut`).
- **Footer:**
  ```
  ↵ copy · ⌘↵ copy and log · → in card · ⌥H host · ⌥C credential · Esc close
  ```
- **Remove** `MAX_RESULTS`, since there's no capping or folding.

- [ ] **Step 1: Write the failing tests** (in the existing `describe("Arsenal drawer")`):
```ts
it("empty query lists categories with counts", async () => {});
it("Enter on a command copies the filled command and keeps the drawer open", async () => {});
it("→ on a field-manual command opens its card at that block", async () => { /* store.blockId === cmd.id */ });
it("results are grouped by category with cards and commands together", async () => {});
it("route host change resets chip and overrides", async () => {});
it("fails closed while the engagement loads", async () => { /* engagementGet pending → no options */ });
it("listbox has no heading children", () => { /* listbox.querySelectorAll('h3').length === 0 */ });
```
- [ ] **Step 2: Run** `npx vitest run src/test/arsenal.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Then check the drawer at 900 and 1440 on `/e/e-lab/h/h-web` (`a`, then "smb"): no header overlap, and the selected row is visible.
- [ ] **Step 5: Commit** with `feat(arsenal): drawer copies on Enter, groups by category, opens cards at the command`.

### Task 8: ⌘K: category groups, hosts, valid listbox, contained suggestions

**Files:**
- Modify: `src/features/palette/Palette.tsx`, `src/features/palette/TokenInput.tsx` (suggestion list placement)
- Test: `src/test/palette.test.tsx` (extend)

**Interfaces:**
- Consumes: `searchPalette` from Task 2, which returns `{ groups, items }`, and Tasks 4–6.
- **Order:**
  - Arsenal groups first, using the same row look as the drawer;
  - then one group "This engagement" (hosts first, then log, notes and credential labels).
  - Each list is capped at 30 hits (*plan call*, for dialog height). Arsenal groups are never folded; the cap only trims the tail.
- **Enter on a host** navigates to `/e/:id/h/:hostId` and closes.
- **Listbox structure:** the same valid group structure as Task 7, with no `h3` inside `ul[role=listbox]`.
- **→ on a command** opens the card at its block (`openCard(cardId, id)`). On a card-less command it opens the drawer's solo view. → is never a silent no-op.
- **`TokenInput` suggestions** render inside the dialog's bounds. Flip above the field when the space below is too small, and never cover the hint line.
- **Footer** gains `⌥C credential` and changes `→ card` to `→ in card`.

- [ ] **Step 1: Write the failing tests:**
```ts
it("finds a host by IP and Enter opens it", async () => {});
it("→ on a raven command opens the drawer solo view", async () => {});
it("results listbox contains no headings", async () => {});
it("suggestion list stays inside the dialog", async () => { /* list bottom <= dialog bottom using getBoundingClientRect mocks or a jsdom-safe placement prop assertion */ });
```
- [ ] **Step 2: Run** `npx vitest run src/test/palette.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Check visually at 900 and 1440 with "smb" and "psexec" on `/e/e-lab/h/h-fs01`.
- [ ] **Step 5: Commit** with `feat(palette): category groups, hosts, valid listbox, contained suggestions`.

### Task 9: The card reading view

**Files:**
- Modify: `src/features/arsenal/CardView.tsx`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` (add `tauri-plugin-opener`, scoped to `obsidian://*`)
- Modify: `package.json` (`@tauri-apps/plugin-opener`)
- Modify: `src/lib/api.ts`, plus the audit fake: add `openObsidian(file: string): Promise<void>`
- Test: `src/test/cardView.test.tsx`

**Interfaces:**
- Consumes: `useArsenalStore.blockId` (Task 7), `useCopyGuard` (Task 6).
- Produces:
  - `CardView` props add `focusBlockId?: string | null`. There is no read-only host case: checklist steps open cards in the drawer (`GoalRow.tsx:78`), so spec §4.3's "cards shown inline on the host page" doesn't occur. The drawer keeps its live chip.
  - each block root gets `id={"block-" + command.id}` and `data-block`.
- **Layout:**
  - **header:** the title as h2, then a meta line `categoryLabel · os`;
  - **contents strip:** a `nav aria-label="On this card"`, a single-line grid of block titles. It is sticky inside the scroll pane. Clicking an entry scrolls to its block. While scrolling, the strip highlights the current block (IntersectionObserver).
  - **`focusBlockId`:** scrolls that block into view and outlines it (`ring-1 ring-accent`) until the next keypress.
- **Keys** (when focus is inside the card or the pane): `j`/`k` move the focused block, and `c` or Enter copies it through the guard.
- **"Also in Raven":**
  - a `<details>` that is closed by default;
  - its contents come from `source === "raven" || source === "oscp-notes"`, so both kinds of built-in commands are listed.
- **Field Manual link:**
  - a button "Open in Obsidian" at the end of the card;
  - it calls `api.openObsidian(card.file)`, which builds `obsidian://open?vault=<basename of settings.fieldManualPath>&file=<file without .md, URI-encoded>`;
  - the Rust opener allows only the `obsidian` scheme.
- **Remove** the Field Manual, stage, category and OS chips row. The meta line replaces it.

- [ ] **Step 1: Write the failing tests:**
```ts
it("contents strip lists every block and jumps to it", async () => {});
it("focusBlockId outlines that block", () => {});
it("j/k move between blocks and c copies the focused one", async () => {});
it("Also in Raven is folded and includes oscp-notes commands", () => {});
it("Open in Obsidian calls the API with the card's file", async () => {});
```
- [ ] **Step 2: Run** `npx vitest run src/test/cardView.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** For Rust, `cargo add tauri-plugin-opener` in `src-tauri`, register the plugin, and add a capability entry that allows `opener:allow-open-url` with the URL scope `obsidian://*` only. Add a Rust-free wrapper in `api.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`, then `cd src-tauri && cargo test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(arsenal): card reading view with contents strip, j/k/c and Obsidian link`.

### Task 10: Full-screen browse in three panes

**Files:**
- Modify: `src/features/arsenal/ArsenalBrowse.tsx`, `src/features/arsenal/useArsenalStore.ts` (add `lastRead: { kind: "card" | "command" | "generator"; id: string } | null`)
- Create: `src/features/arsenal/browseList.ts`
- Test: `src/test/arsenalBrowse.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4–6 and 9.
- Produces:
```ts
export interface BrowseSection { heading: string | null; rows: ArsenalHit[] } // null heading = the cards block
export function browseList(category: string, library: LibraryCommand[], cards: CardMeta[], generators: { id: string; title: string; category: string }[]): BrowseSection[];
// Cards (alphabetical) first under heading null; then generators of that category; then commands WITHOUT a cardId, grouped under their tool (headings alphabetical, rows alphabetical). Field-manual commands never appear as rows.
```
- **Grid:** `grid-cols-[minmax(150px,180px)_minmax(220px,260px)_1fr]` from 1100px up. Below 1100px, pane 1 becomes a compact category select above pane 2 (`grid-cols-[minmax(220px,260px)_1fr]`).
- **Top bar:** search (`/` focuses it), `HostChip`, `CredChip`.
- **Pane 1:** `nav aria-label="Categories"`. Each category shows its label and count (cards plus card-less commands). Hide categories with a count of 0 after exam filtering. While searching, show hit counts and dim categories with no hits.
- **Pane 2:** `browseList` for the selected category; while a query is typed, it shows `searchArsenal` groups instead. Headings are plain labels, never collapsible.
- **Pane 3:**
  - a card shows `CardView`;
  - a command shows its title, tool, why line and filled block, plus "From card X" as an in-app button (no ↗ glyph);
  - a generator opens in pane 3.
- **Opening state:** `lastRead`, else the first category's first row. Never "Pick a card."
- **Keys:** ↑/↓ within a pane, ←/→ between panes, `/` for search, and Esc clears the search, else leaves (existing `useEscapeTo("/")`). `A` focuses the search.
- **Remove** the Stage filter, the native Host select, and the "Generators" and "Cards" sections.

- [ ] **Step 1: Write the failing tests:**
```ts
it("browseList: cards first, then card-less commands under tool headings", () => {
  const s = browseList("Active-Directory", [KERBRUTE_RAVEN, NXC_RAVEN, FM_CMD_IN_CARD], [KERB_CARD], []);
  expect(s[0]).toEqual({ heading: null, rows: [expect.objectContaining({ type: "card", id: KERB_CARD.id })] });
  expect(s.slice(1).map((x) => x.heading)).toEqual(["kerbrute", "nxc"]);
  expect(s.flatMap((x) => x.rows).some((r) => r.id === FM_CMD_IN_CARD.id)).toBe(false);
});
it("opens on the first category's first item, never 'Pick a card.'", async () => {});
it("has no Stage filter", () => { expect(screen.queryByRole("region", { name: "Stage" })).toBeNull(); });
it("typing filters pane 2 to grouped results and marks categories with hits", async () => {});
it("searching 'lateral movement' shows Pivoting items", async () => {});
it("←/→ move focus between panes", async () => {});
```
- [ ] **Step 2: Run** `npx vitest run src/test/arsenalBrowse.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS. Look at `/arsenal` at 900, 1024, 1280 and 1440: no sideways scroll, and pane 2 headings read as labels.
- [ ] **Step 5: Commit** with `feat(arsenal): three-pane browse by category`.

### Task 11: Transfer generator fixes and a Kali-only tools folder

**Files:**
- Modify: `src/features/generators/TransferGenerator.tsx`, `src-tauri/src/settings.rs`, `src/features/settings/SettingsPage.tsx`, `src/audit/fixtures.ts:415`, and the audit fake api's `settingsUpdate` (same rule)
- Test: `src/test/transferGenerator.test.tsx` (extend); a Rust unit test in `settings.rs`

**Interfaces:**
- Consumes: `HostChip`/`CredChip` (Tasks 4–5).
- **Fill controls:** the generator uses `HostChip` and `CredChip` instead of its own host select.
- **Footnote** (`TransferGenerator.tsx:216`): with a host, "copies the <host> half"; with no host, "copies the target half". Never "the the".
- **Method pills:** grouped under two plain labels, "HTTP" and "Other" (*plan call*), so no group shows more than about 6.
- **`windowsToolsDir` and `linuxToolsDir`** are rejected when they look like Windows paths (`^[A-Za-z]:[\\/]` or containing `\`). The error reads exactly: `must be a folder on Kali, like ~/tools/windows`. The labels become "Windows tools folder (on Kali)" and "Linux tools folder (on Kali)".
- **Audit fixture:** `windowsToolsDir: "~/tools/windows"`.

- [ ] **Step 1: Write the failing tests:**
```rust
#[test]
fn tools_dir_rejects_windows_paths() {
    assert!(clean_tools_dir("windowsToolsDir", r"C:\Tools").is_err());
    assert!(clean_tools_dir("windowsToolsDir", "~/tools/windows").is_ok());
}
```
```ts
it("footnote never reads 'the the'", () => { /* no host: text matches /copies the target half/ and not /the the/ */ });
it("method pills are grouped with at most 6 per group", () => {});
```
- [ ] **Step 2: Run** `cd src-tauri && cargo test tools_dir` and `npx vitest run src/test/transferGenerator.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `clean_tools_dir(field, s)` (`clean_path` plus the Windows-path rule). Use it for both tools fields in `update` (lines 240–241). Leave reads lenient: an already-stored bad value still loads, so the user can see it and fix it.
- [ ] **Step 4: Run** `npm test && npm run typecheck && cd src-tauri && cargo test`. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(generators): Kali-only tools folders, transfer footnote, grouped methods`.

### Task 12: Paste `user:pass` into the credential form

**Files:**
- Create: `src/engines/credentials/paste.ts` (export from `index.ts`)
- Modify: `src/features/credentials/CredentialForm.tsx` (the username field's `onPaste`)
- Test: `src/test/credentialPaste.test.ts`

**Interfaces:**
- Produces:
```ts
export function parseCredentialPaste(text: string): { username: string; domain: string | null; secret: string; type: "password" | "hash" } | null;
```
- **Accepts one line only:** `user:secret`, `DOMAIN\user:secret`, `user@domain:secret`.
- **Hash detection:** the secret is a hash when it is 32 hex characters, or `LM:NT` (32hex:32hex). For `user:LM:NT`, the secret is `LM:NT`.
- **Returns null for:**
  - URLs (`://`);
  - `host:port` (the secret is all digits);
  - multi-line text;
  - an empty user or secret.
- **On paste in the username field:** a non-null result fills username, domain, secret and type, and prevents the default paste. A null result pastes normally.

- [ ] **Step 1: Write the failing tests:**
```ts
it.each([
  ["svc_report:Summer2026!", { username: "svc_report", domain: null, secret: "Summer2026!", type: "password" }],
  ["ACME\\svc_report:Summer2026!", { username: "svc_report", domain: "ACME", secret: "Summer2026!", type: "password" }],
  ["admin@acme.corp:pw", { username: "admin", domain: "acme.corp", secret: "pw", type: "password" }],
  ["Administrator:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", { username: "Administrator", domain: null, secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", type: "hash" }],
])("parses %s", (input, out) => expect(parseCredentialPaste(input)).toEqual(out));
it.each(["http://x:8080", "10.10.20.21:445", "a:b\nc:d", ":pw", "user:"])("rejects %s", (s) => expect(parseCredentialPaste(s)).toBeNull());
it("pasting DOMAIN\\user:pass into the form fills the fields", async () => {});
```
- [ ] **Step 2: Run** `npx vitest run src/test/credentialPaste.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(credentials): paste user:pass into the credential form`.

### Task 13: Accessibility leftovers

**Files:**
- Modify: `src/ui/TitleBar.tsx`, `src/features/checklist/CommandList.tsx` (`COMMAND_PRE`), `src/styles/tokens.css` (`--faint`)
- Test: `src/test/a11y.test.tsx` (new, small)

**Changes:**
- **Header buttons:** the accessible name includes the visible word, and the kbd hint is `aria-hidden`. For example, the name is "Arsenal", and the visible text "Arsenal A" becomes "Arsenal" plus an aria-hidden `A`.
- **`COMMAND_PRE`:** gains `tabIndex={0}` on the `<pre>` wherever it can scroll sideways, with an accessible name `Command: <title>`.
- **`--faint`:** raised to at least 4.5:1 on `#000` and `#111` (*plan call:* `#8a8a8a`, which is `--muted`). If that collapses the hierarchy between muted and faint, raise `--muted` to `#a8a8a8` and `--muted-2` to `#c4c4c4`. Confirm by eye at 1280.

- [ ] **Step 1: Write the failing tests:**
```ts
it("title bar button names contain their visible word", () => { expect(screen.getByRole("button", { name: "Arsenal" })).toBeInTheDocument(); });
it("command blocks are focusable", () => { expect(screen.getAllByTestId("command-block")[0]!.querySelector("pre")!.tabIndex).toBe(0); });
```
- [ ] **Step 2: Run** `npx vitest run src/test/a11y.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run lint`, then `npm run audit:visual`. Expected: tests PASS, and no `color-contrast`, `aria-required-children`, `scrollable-region-focusable` or `label-content-name-mismatch` issues on the drawer, palette or browse screens in `audit-output/report.md`.
- [ ] **Step 5: Commit** with `fix(a11y): header names, focusable command blocks, faint contrast`.

### Task 14: Instrument Sans as Raven's interface font

**Files:**
- Modify: `package.json` (`@fontsource-variable/instrument-sans`), `src/main.tsx`, `src/styles/tokens.css:63`, `PRODUCT.md` (Brand Commitments)

**Changes:**
- **Font stack:** `--font-ui: "Instrument Sans Variable", -apple-system, system-ui, sans-serif;`. JetBrains Mono stays the font for `--font-mono`.
- **PRODUCT.md:** "The font is JetBrains Mono" becomes "The interface font is Instrument Sans; commands, code and data use JetBrains Mono."

- [ ] **Step 1:** `npm i @fontsource-variable/instrument-sans`, and import it in `src/main.tsx` next to the JetBrains import.
- [ ] **Step 2:** Update the token and PRODUCT.md.
- [ ] **Step 3: Run** `npm test && npm run build`. Expected: PASS, with the font file in `dist/assets`.
- [ ] **Step 4: Run** `npm run audit:visual`, and look at every screen at 900 and 1440. Pay particular attention to the host page, credentials and the sidebar, since narrower letters change wrapping. Fix any regression found in the screen it appears on. Expected: no new truncation or overflow issues compared with the previous report.
- [ ] **Step 5: Commit** with `feat(ui): Instrument Sans as Raven's interface font`.

### Task 15: Audit coverage and hard regressions

**Files:**
- Modify: `audit/screens.ts`, `audit/regressions.spec.ts`, `src/audit/fixtures.ts`

**New screens** (all four widths):
- `arsenal-drawer-empty`: drawer opened with no query.
- `arsenal-drawer-smb`: "smb" on `h-fs01`.
- `arsenal-browse`: ready on `nav[aria-label='Categories']`.
- `arsenal-browse-search`: "lateral movement".
- `arsenal-card-long`: the longest card, opened in browse.
- `palette-credmenu`: ⌘K then ⌥C.
- `palette-guard`: a command with an unfilled field, after one Enter.

**Fixtures:** ensure `src/audit/fixtures.ts` has:
- a password credential with a valid attempt on `h-fs01`;
- a hash-only admin credential on the DC.

- [ ] **Step 1: Write the regressions in `audit/regressions.spec.ts`:**
```ts
test("host chip is never a Tab stop", async ({ page }) => { /* ⌘K, Tab from search never focuses role=button[name^='Fill for host'] */ });
test("Enter in the drawer copies", async ({ page, context }) => { /* grant clipboard; a, type smb, Enter; clipboard contains 10.10.20.21 on h-fs01 */ });
test("copy guard focuses the first unfilled field", async ({ page }) => {});
test("lateral movement finds Pivoting", async ({ page }) => {});
test("browse never shows 'Pick a card.'", async ({ page }) => { await page.goto("/arsenal"); await expect(page.getByText("Pick a card.")).toHaveCount(0); });
```
- [ ] **Step 2: Run** `npm run audit:visual`. Expected: the regressions PASS, and every new screen reaches its ready state.
- [ ] **Step 3: Drive the critique task end to end at 1280** ("Windows host, SMB, have a password: get the command filled and copied"), and confirm it takes no more than 4 keystrokes after ⌘K plus the query. Read the screenshots for the new screens yourself, and fix what they show.
- [ ] **Step 4: Run** all the gates: `npm test && npm run lint && npm run typecheck && (cd src-tauri && cargo test) && npm run audit:visual`. Expected: all PASS.
- [ ] **Step 5: Commit** with `test(audit): Arsenal reference screens and regressions`.
