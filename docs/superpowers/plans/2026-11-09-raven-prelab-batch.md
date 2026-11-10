# Pre-lab batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every open Payloads follow-up and every still-open item of the 2026-11-06 visual-audit triage before the owner's next lab, so one lab session can batch-test the whole flow.

**Architecture:** Mostly fixes in place. Payload logic in `src/engines/payloads/`, UI in `src/features/payloads/`; checklist/board logic in `src/engines/checklist/`; capture in `src/features/capture/` and `src/engines/capture/`. No new persistent data is expected; if a task finds it needs a schema change, it appends a migration (backup runs first) and says so.

**Tech Stack:** React 19 + TypeScript + zustand + TanStack Query, Tauri 2 + Rust (rusqlite), vitest + Testing Library, Playwright visual audit.

**Spec:** `docs/superpowers/specs/2026-11-09-raven-prelab-batch-design.md`. Item sources: `docs/superpowers/followups/2026-11-07-raven-2b-payloads.md` and `docs/superpowers/audits/2026-11-06-visual-audit-triage.md`.

## Global Constraints

- Every item: first a failing test that reproduces it (or, for a pure layout item, an audit check or regression), then the fix. If an item turns out already fixed, write the test that proves it and say so in the report.
- Payloads work as pasted in each declared context; every part token appears in its built text; exact-output tests for changed payloads.
- Fixtures fully synthetic: RFC 5737 IPs (192.0.2.x, 198.51.100.x, 203.0.113.x), `*.example.test`.
- CSS grid first (flex only for single-line runs), Ink theme tokens, amber `text-warn` for warnings, muted for info, no red. Phosphor icons for row controls.
- Keyboard-first: every new control reachable by key; new single-letter keys must not clash (check `isFreeKey` users and every `useKeydown`); new ⌥ chords matched by `e.code`.
- Raven never flips an owner toggle; only Wrong OS / Doesn't work in <context> fold a payload.
- Any schema change: appended migration, backup first. Builders stage only their own files (`git add <paths>`); no AI attribution trailers.
- Tick each item in the follow-ups doc (or mark it in the triage doc) in the same commit that fixes it.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `cd src-tauri && cargo test`, `npm run audit:visual` (never run vitest at the same time as the audit; they flake under combined load).

## Plan calls (owner can overrule)

- **Next-step key:** `J` ("jump to next step") on a host page, when free; the implementer confirms it's free and picks the nearest free mnemonic otherwise, and adds it to the hint line.
- **Rooted host on the board:** `host.access === "root"` puts the host in Post-exploitation at least; Reporting still needs `h-pe-proof` done and late goals closed.
- **Bind-shell listener chip label:** "Connect with" under "Connect from Kali".
- **Tools picker:** a fourth state "from your log" returns an overridden row to inference.
- **SQL fold:** a step folds once it was copied (↵, Copy, ⌘↵) or its value field is filled; the fold line shows the step title and its result (the value, or "copied"); ↵ or click reopens it; the first unfinished step is open and focused.
- **Unresolved payloads are wrapped anyway** (follow-up "Unresolved payloads show unwrapped"): placeholders stay visible inside the wrapper; only the base64 PowerShell keeps its stub. The "Set … first" note stays.

## Review Focus

1. **A SQL step filled, then the value cleared.** Expect it to unfold (unfinished again), not stay folded with an empty result. (Task 3.)
2. **The next-step key with no open step, or on a page without a checklist.** Expect a calm no-op with a status line ("Every step is done"), never a thrown error or focus lost to `body`. (Task 6.)
3. **A credential paste that is also a valid command** (`admin:admin` vs `curl http://x:8080`). Expect URLs and `host:port` not to be offered as credentials. (Task 7.)
4. **Wrapping an unresolved payload for a URL context.** Expect `{LHOST}` to stay readable (not `%7BLHOST%7D`) while the rest is encoded. (Task 1.)
5. **OS override clearing an incompatible paste override.** Pick paste = cmd, then OS = Linux: the paste override is dropped (cmd is Windows-only); paste = Web shell survives (any OS). (Task 5.)

---

### Task 1: Payload content fixes

**Files:** `src/engines/payloads/msfvenom.ts`, `reverseShells.ts`, `upgrade.ts`, `build.ts`, `encode.ts`, `context.ts`, `fit.ts` (SERVICE_PREFERENCE ids), tests under `src/test/engines/payloads/`, `src/features/payloads/usePayloadSession.tsx` (Upgrade ranOn only).

Items (follow-ups doc, "Payload content" + "Found in 2b-C" WAR):
- [ ] Merge `msf-java-war-linux`/`-windows` into one `msf-java-war` with `os: "any"`; update `SERVICE_PREFERENCE` and tests. Test: OS Windows and OS Linux both list it as a fit once; OS unknown lists it once.
- [ ] Verify the WAR "browse to /rev/" (the WAR's context path is its filename without `.war`; make the note use `{FILE}`'s stem), the dll `rundll32` hint (msfvenom DLLs run from `DllMain`, so `rundll32 rev.dll,x` with any export name works — say so), and hta-psh's arch (note that `mshta.exe` from SysWOW64 is 32-bit; recommend the x64 path `C:\Windows\System32\mshta.exe`). Check the owner's `Payload-Generation-msfvenom.md` card first; where still unsure, the note says "check".
- [ ] ps-b64 parts explain the encoded script (TCPClient connect, the read loop, `iex`, the `PS <path>>` prompt) as parts whose tokens are notes, not text tokens — or add a "Decoded script" disclosure listing those parts; the token-appears rule applies to text tokens only (document the distinction in `types.ts`).
- [ ] nc-exe part token follows `{FILE}` (works when FILE is `nc64.exe`); the Nishang "quotes doubled" note shows only in `sql-string`.
- [ ] Upgrade: label which side each step runs on ("on the target" / "in your terminal"); `Ctrl-Z` is shown as a key (no Copy, not copied by ↵, ⇥ skips past it); step 3 logs `ranOn` = Kali on ⌘↵; tests that every step has parts and that `{USER}` is unresolved until set.
- [ ] Unresolved payloads are wrapped for their context (plan call), with placeholders kept readable inside the wrapper (Review Focus 4).
- [ ] URL encoding encodes newlines and non-ASCII; uppercase `{…}` inside a custom SQL `cmd` that is not a known placeholder (e.g. `${IFS}`) is encoded like any text.
- [ ] Macro wrapper escapes for VBA correctly beyond `"` (line breaks split into `vbCrLf` concatenation, `&` safe); `injected-linux` only applies `bash -c` for Linux defs (any-OS defs use the chosen OS).

- [ ] **Steps:** failing tests per item → fix → `npx vitest run src/test/engines/payloads src/test/features/payloads` → `npm test`, typecheck, lint → tick the items → commit `fix(payloads): content follow-ups (WAR any-OS, parts, upgrade steps, wrapping, encoding)`.

### Task 2: SQL engine fixes

**Files:** `src/engines/payloads/sql.ts`, `sqlKeywords.ts`, tests `src/test/engines/payloads/sql.test.ts`.

Items (follow-ups doc, "SQL", all but the panel length):
- [ ] `CONCAT(` no longer matches inside `GROUP_CONCAT(` (word-boundary match).
- [ ] The keyword scan reads only the SQL skeleton, not embedded data (base64, custom cmd, string literals).
- [ ] Explanations don't assume a stacked injection: "the leading ;" wording only for stacked points.
- [ ] LOAD_FILE's "defaults to /etc/passwd" note only when no path is given; INTO OUTFILE checks the reflected column is within the column count; `%2d` handled when nc.exe goes through `cmd`.
- [ ] Database, table and column listing steps aggregate (`group_concat` MySQL/SQLite, `string_agg` Postgres/MSSQL 2017+, `LISTAGG` Oracle) or carry a paging note where aggregation can't work (older MSSQL: `FOR XML PATH`).
- [ ] MySQL 5.7 `FROM DUAL`; Oracle `dbms_pipe` sleep notes the EXECUTE grant; strict engines with no column count use the reflected-columns path correctly.

- [ ] **Steps:** failing exact-output tests per engine/item → fix → `npx vitest run src/test/engines/payloads/sql.test.ts` → `npm test`, typecheck, lint → tick → commit `fix(sql): keyword scan, aggregation, engine gaps`.

### Task 3: SQL panel folds finished steps

**Files:** `src/features/payloads/SqlPanel.tsx` (and a small hook if it helps), tests `src/test/features/payloads/sqlPanel.test.tsx` (new or existing SQL panel tests).

- [ ] Behaviour per the plan call: finished = copied this session or its value filled; fold line = step number, title, result; ↵/click reopens; first unfinished step open and focused; clearing a value unfolds it (Review Focus 1); exec payloads (after the steps) fold the same way. Works in the 560px drawer and the Workbench; no new chord needed.
- [ ] Tests: copy step 1 → it folds to "1. … · copied"; fill column count 3 → that step folds showing "3"; clear it → unfolds; ↵ on a folded step reopens it; drawer at 560px shows at most the folded lines plus one open step above the fold (assert by count of open steps).
- [ ] **Steps:** failing tests → implement → focused tests → `npm test`, typecheck, lint → tick "The SQL panel is long" → commit `feat(sql): fold finished steps`.

### Task 4: Fit inference and memory

**Files:** `src/engines/payloads/fit.ts`, `memory.ts`, `src/features/payloads/usePayloadFit.ts`, `src-tauri/src/log.rs` (only if clearing payload id needs it), tests.

Items ("Fit and memory"):
- [ ] Inference: raw HTTP request lines (`GET /s.aspx?cmd=id HTTP/1.1` with a Host header) read as a web shell URL; ANSI colour codes stripped before linPEAS tool detection; `OpenSSH for_Windows` reads as Windows; `which python3>/dev/null` reads `python3`.
- [ ] Document the requirement → tool mapping in `fit.ts` (the 2b-C ToolId list), and use the confirmed product (not the full nmap string) in evidence text.
- [ ] A log entry's payload id can be cleared on edit (Rust update accepts an explicit clear; keep "None keeps" for other callers — e.g. an empty string clears); the failure regex no longer matches every "cannot find" (only shell/OS "not found"/"cannot find the path"/"is not recognized" shapes); remove any leftover `staleBaked` references.
- [ ] Ranking waits for the engagement kind (fail closed like the Arsenal: no ranking until the engagement is known).
- [ ] **Steps:** failing tests → fix → focused tests (+ `cargo test` if Rust touched) → full suite, typecheck, lint → tick → commit `fix(payloads): fit inference cases, clearable payload id, fail-closed ranking`.

### Task 5: Drawer and Workbench polish

**Files:** `src/features/payloads/*` (ContextChips, PayloadsWorkbench, PayloadView, ToolsPicker, usePayloadSession, usePayloadsStore), `src/features/checklist/CommandList.tsx` test, `src/audit/fakeApi.ts`, `audit/` regressions, tests.

Items ("Drawer and Workbench" + remaining "Found in 2b-C"):
- [ ] Port chip accepts a typed custom port (an "Other…" option that opens an inline numeric field), not only 443/80/Settings.
- [ ] Picking an OS drops a paste override that doesn't exist for that OS (Review Focus 5).
- [ ] After a mouse pick on a chip, ↵ copies the payload (focus returns to the body), not reopen the chip; ⌥L with no port goes through the guard (verify after 2b-C); ⌘↵ on Encode logs without LHOST/LPORT values.
- [ ] Tab order: from the drawer body, Tab reaches Full screen before leaving the drawer (or a hint names Shift+Tab) — pick the fix that keeps focus inside the drawer.
- [ ] Paste-context labels in the Workbench get a `title`; the host chip has a min width.
- [ ] Bind-shell listener chip reads "Connect with"; Tools picker gains "from your log" to clear an override; `listKey` sorts tool entries; fakeApi `payloadBuildRecord` rejects an empty payloadId; the multi-block Transfer test picks blocks by name.
- [ ] Test gaps: `P` while typing in a field does nothing; ↵/Esc inside an open chip list; ⌥1 against HostView's tabs; Esc when `/payloads` is the first history entry; replace the weak `nc.exe` `toHaveCount(0)` audit check with a positive assertion.
- [ ] **Steps:** failing tests → fix → focused tests → full suite, typecheck, lint → tick → commit `fix(payloads): drawer and Workbench polish, test gaps`.

### Task 6: Next-step key

**Files:** host page (`src/features/hosts/HostView.tsx` and the checklist tab component), `src/features/engagements/EngagementShell.tsx` or wherever host-page keys live, hint line, `audit/` flow budget, tests.

- [ ] `J` (plan call) on a host page focuses the first To-do or Doing step in the host checklist, switching to the Checklist tab if another tab is showing, and scrolls it into view. No open step → status "Every step is done" and focus stays put (Review Focus 2). Typing in a field never triggers it.
- [ ] Hint line on the host page lists it; the audit's `flow:next-step` budget (2 keys) passes.
- [ ] **Steps:** failing tests (keydown → focused element is the first open step; done-everything case; typing case) → implement → focused tests → full suite, typecheck, lint, audit flow spec → mark 8a in the triage doc → commit `feat(hosts): J jumps to the next open checklist step`.

### Task 7: Capture intake reads credentials

**Files:** `src/engines/capture/` (detect kind), `src/features/capture/` (CaptureForm / applyInterpretation), `src/engines/credentials/paste.ts` (reuse `parseCredentialPaste`), tests.

- [ ] Pasting a line (or lines) that `parseCredentialPaste` reads as credentials (`user:pass`, `DOMAIN\user:pass`, `user:hash`) into capture offers them as credentials through the existing credential intake (same review/confirm step the Credentials page uses), linked to the current host; the owner can still save it as a note instead. URLs, `host:port`, `scheme://`, and command lines are never offered (Review Focus 3).
- [ ] Tests: `admin:Summer2026!` → credential offered for the host; `CORP\svc_sql:P@ss` → domain set; `curl http://192.0.2.10:8080` → not offered; `198.51.100.20:445` → not offered; choosing "save as note" keeps today's behaviour.
- [ ] **Steps:** failing tests → implement → focused tests → full suite, typecheck, lint, cargo test if Rust touched → mark 8d → commit `feat(capture): pasted credentials are offered as credentials`.

### Task 8: Board column and loading/error/empty states

**Files:** `src/engines/checklist/board.ts`, board UI (`src/features/board/` or engagements), `src/ui/QueryState.tsx`/`ErrorState.tsx` users, Hashes view, tests.

- [ ] `derivedColumn`: `host.access === "root"` → at least `post-exploitation` (plan call). Tests: rooted, no proof → post-exploitation; rooted + proof + late goals closed → reporting; user access → unchanged.
- [ ] The board shows a loading state while queries load and an error state (shared `ErrorState`) on failure — never an empty board with zero counts. Same for exam-board's strip ("Rooted 0/0").
- [ ] Error states across features use the shared component (find the three styles named in the triage §4 and converge them); Hashes with zero rows has an empty state.
- [ ] **Steps:** failing tests (board engine + `?audit=loading|error` UI tests or vitest with a pending/rejecting fake) → fix → focused tests → full suite, typecheck, lint → mark items in the triage doc → commit `fix(board): rooted hosts reach post-exploitation; honest loading and error states`.

### Task 9: Deferred items from UX round 1 (§6)

**Files:** as found; read triage §6 first.

- [ ] Verify then fix each, with a test: Evil-WinRM prompt (`*Evil-WinRM* PS C:\…>`) stripped from log titles; the 3.0 vector's version button works (or is removed if 3.0 is read-only); NVD lookup state kept in the finding draft; collapsed rail shows ThreadDot; host-facts API cleanups (vectorUpsert/ruled_out documented, fakeApi matches Rust, orphan links cleaned on delete, `hostIdentitySet` sets `updatedAt`); the T1/T3/T4/T5/T7/T8 test gaps listed in §6.
- [ ] **Steps:** per item failing test → fix → focused tests → full suite, typecheck, lint, cargo test if Rust touched → mark items in the triage doc → commit per coherent group.

### Task 10: Layout sweep of unverified items + lab test checklist

**Files:** components found by the sweep; `audit/` regressions; new `docs/superpowers/followups/2026-11-09-prelab-lab-checklist.md`.

- [ ] Run `npm run audit:visual`; Read the screenshots at 900 and 1024 for the unverified items in the spec (board columns, stats strip, host-picker focus ring, routine commands, matrix heads, chevrons, "(hash)" twice, orange Delete, Transfer selects, Log "RAN ON", caption, palette ranking, capture filename, checklist scroll position). Fix real defects (grid, tokens), add a regression for each fix, mark each item in the triage doc as fixed or "verified fine" with the screenshot name.
- [ ] Write the lab checklist: a short, ordered list of things to try in one lab session that touches every change of 2b-C and this round (what to do, what you should see), grouped by stage of an engagement, so the owner can batch-test in flow.
- [ ] **Steps:** audit → fixes with regressions → audit again (0 gate failures) → full suite, typecheck, lint → commit `chore: layout sweep of unverified audit items; lab test checklist`.
