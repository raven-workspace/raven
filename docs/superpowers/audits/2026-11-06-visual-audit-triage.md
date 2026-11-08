# Raven visual audit: by-eye triage (2026-11-06)

Inputs: `audit-output/report.md` / `report.json` (28,181 rows) and every screen at 900 and 1280, every `~state` shot, plus 1024 where 900 looked width-dependent. Shot paths are relative to `audit-output/shots/`.

**Headline:** 89% of rows (25,208) come from two checks, `tiny-text` and `small-target`, and nearly all of them flag the design scale on purpose. A further ~7 overlay screens re-audit the host page underneath them, which multiplies every host-page finding by about 8. Once those are taken out, about 15 real root causes are left. Most are width bugs at 900–1024 and duplicated or redundant content. Three of the worst issues by eye were not caught by any check: the credentials secret mask wrapping into a column, the duplicate checklist panel, and the affected-services chip wall.

---

## 1. Top fixes (ranked by friction/noise)

| # | Fix | Screens @ widths | Shots | What's wrong | Likely root cause | Auto-caught? |
|---|---|---|---|---|---|---|
| 1 | **Remove/shrink the duplicate "NOW" checklist panel on the host page** | host-checklist, exam-host-locked, dc-story, host-story (and all host overlays) @ all widths | `host-checklist@1280.png`, `exam-host-locked@1280.png`, `dc-story@1280.png` | Under SERVICES, a 270px "NOW · Information gathering" panel repeats the whole phase checklist: same items, status toggles, commands and a second "Commands use" select. The right-hand Checklist tab shows the same items. The duplicate doubles the noise, makes the host page 5–6k px tall, and in the narrow column commands break mid-token (`--min-\nrate`, `host-\ndiscovery`, `(?\n=/open)`). On a rooted DC it still says "Scan all 65,535 TCP ports · To do". | NOW panel in the services column (`div.grid…grid-cols-[300px_1fr]`). Reduce it to **one line**: current step title + status + "open in Checklist" link, or hide it while the Checklist tab is active. | Partly: `mid-token-wrap` (pr-16 code blocks ×~300 rows) and `long page`. The duplication itself was not caught. |
| 2 | **Host page layout at 900–1024: three columns don't fit** | every host screen @900, partly @1024 | `host-checklist@900.png`, `host-story@900.png`, `exam-host-locked@900.png` | Sidebar 200 + services 300 + pane ≈ 330px leaves no room. The page scrolls sideways (751 > 652), FINDINGS tab, Edit/Delete and "sections" are clipped off-screen, the host FQDN wraps to 3 lines, and checklist titles squeeze to 2–4 words per line with the status toggles beside them. | `grid-cols-[300px_1fr]` has no breakpoint. Below ~1100px, stack services above the tabs (or collapse them to a 1-line summary). Let the host title use `break-all` on dots only, or truncate it with the IP kept. | Yes: `overflow` (grid, section, tablist), `offscreen` (Findings tab, Edit, Delete, sort button), `overlap` (Oldest-first over tabs). |
| 3 | **"N new credentials since this was done" notice squeezes the checklist row** (the known regression is back) | host-checklist @900 (severe), @1280 (noisy) | `host-checklist@900.png` (top), `host-checklist@1280.png` | The notice lists all 12 credentials inline inside the title column. At 900 the title becomes one word per line ("Every / port has / a confirmed…"), the long service account breaks into 5 lines, and the status toggle floats mid-row, far from its title. At 1280 there is a 12-line block of plain text inside a checklist row. | Goal row title column (`[data-testid="goal-title-col"]`). Make the notice one line: "12 new creds since done · Reopen" with the list in a disclosure. Align the toggles to the top of the row. | Only at 900, and only as a 2px `overflow` on `goal-title-col`. The checks miss the squeeze itself (see tuning §5, "narrow-wrap"). |
| 4 | **Credentials table: masked secret wraps into a vertical dot column** | credentials @900 (severe), @1280 | `credentials@900.png`, `credentials@1280.png` | `•••••••••` wraps to 1 dot per line at 900 (rows about 8× taller) and 3 lines at 1280. At 900 Crack/Edit/Delete fall off-screen. Each row has 5 buttons, and an orange Delete on every row is colour noise. | Secret cell has no `whitespace-nowrap`. Use a fixed short mask (`••••••`) with nowrap, group Reveal/Copy, and move Crack/Edit/Delete into a row hover or overflow menu with neutral colour. | No. Nothing flagged the wrap. `offscreen` only caught the matrix cells. |
| 5 | **Story & Log rows: full-FQDN host chip on every row** | host-story, dc-story @900/1280; log @900/1280 | `host-story@1280.png`, `host-story@900.png`, `log@900.png` | On a host's own Story tab every row repeats `web-finance-dmz-portal-01.dmz.finance.acme.corp`. The chip pushes titles to "Anonymous FTP …" at 1280, and at 900 the titles disappear entirely while the chips are clipped. The Log shows the same chip wall. | Story row (`button.flex.w-full.items-center.gap-3.px-1.py-2`) and the log row chip. Hide the chip when it equals the current host. Elsewhere show the short name (first DNS label) with `max-w-[16ch] truncate`, and give the title priority (`min-w-0 flex-1`). | Yes: `overflow` (132 rows, 463 > 436), `truncated` (span.min-w-0.flex-1.truncate). |
| 6 | **Board at 900/1024: 6 columns don't fit** | board, exam-board @900, @1024 | `board@900.png`, `exam-board@1024.png` | Column headers collide with the neighbour's count ("INFORMATION 1 VULNERABILITY 0 INITIAL"), user/root chips spill outside the cards, and IPs are truncated to `10.10.2…`, which makes them useless. | Board grid with equal 1fr columns and no min width. Set `minmax(160px,1fr)` with horizontal scroll, or 3×2 below 1100px. Let chips wrap, and never truncate the IP. | Yes: `overflow` (header, section, span.mt-0.5, card links). |
| 7 | **Engagement stats strip wraps at 900/1024** | all engagement screens @900; exam @900/1024 | `exam-board@900.png`, `exam-board@1024.png`, `log@900.png` | "No dates" and "Rooted 2/6 · flags 2/12" wrap to 2 lines. In exam mode, "Rooted 0/5 · flags 1/6" becomes 4 lines and spills out of the strip over the board, the timebox wraps, and "sections"/"engagements" are clipped. | Strip items need `whitespace-nowrap shrink-0`. Hide the `1–6 sections / esc engagements` hint below ~1100px. | Partly: `squeezed` (exam only), `overflow` on `role=status`. |
| 8 | **Keyboard gaps in core flows** | flows @1280; palette:kbd | report §flow | Reaching the next checklist step takes 13 Tabs (budget 2). In the Arsenal drawer, Enter opens the card instead of copying (the palette's Enter copies, so the two are inconsistent). The palette can't find hosts. Pasting `user:pass` into capture creates nothing. The focused "Fill for host" picker is invisible (opacity 0). | Add a "next step" key (e.g. `N`) that focuses the first To-do or Doing step. Make Enter in the drawer copy, as in the palette, with Tab or → to open. Add hosts to palette results. Have intake parse `user:pass` / `DOMAIN\user:pass`. Add a `:focus-within` ring to the host-picker wrapper. | Yes: `flow-over-budget`, `flow-needs-mouse`, `focus-hidden`. |
| 9 | **Credential routine commands: cramped, detached Copy, mid-token wraps** | credentials @all | `credentials@1280.png` (lower half) | The two commands per protocol sit about 4px apart as bare text. Copy is pinned 600px+ to the right at 1280+, and filenames break mid-token (`nxc-smb-backup-\noperator.txt`). Spacing and hierarchy don't match the boxed command blocks used elsewhere. | `code.min-w-0.flex-1.overflow-x-auto.whitespace-pre-wrap`. Reuse the checklist CommandBlock (boxed, inline Copy, 8px gap). Wrap at spaces only by rendering each space-separated token as a `whitespace-nowrap` span (plain CSS cannot stop breaks at hyphens). | Yes: `mid-token-wrap` (28), `long-lines` (credentials li). |
| 10 | **Error/loading states: silent, misleading, inconsistent** | board, exam-board, all `~loading` | `board@1280~error.png`, `host-story@1280~loading.png`, `credentials@1280~error.png`, `log@1280~error.png` | Board/exam-board errors render as an empty board with 0 counts, pixel-identical to loading. Loading shows a blank pane while the header claims "Rooted 0/0 · flags 0/0". There are three different error styles: a dashed card with Try again (log, which is good), a dashed card without retry (host), and a bare orange line (credentials/findings/eng-checklist). | Add one `<ErrorState title reason onRetry>` and use it everywhere. Hide the stats strip until it has loaded. Show a delayed skeleton or "Loading…" after ~150ms. | Yes: `silent-error` (4), `blank-loading` (14). The inconsistency and the misleading zeros are eye-only. |
| 11 | **Add/Edit finding: "Affected services" is a wall of chips** (also seen in real use, Lab A, 2026-11-06) | findings @900/1280; real app | `findings@1280.png` | About 45 chips across 6 hosts, and every port of every host is listed even when only some hosts are selected. Wrapped chips fall back under the host label instead of staying indented, and the host label is truncated ("web-finance-d…"). The chips show raw nmap names (`ldapssl?`, `globalcatLDAPssl?`, `5040/tcp unknown`) even where the real product and version have been confirmed. MS01 alone runs to 40+ chips, mostly Windows dynamic RPC and UDP noise. | Rebuild the field as follows. (a) Only list services of the **selected** hosts. (b) **Show the confirmed service and version** (`confirmedProduct`/`confirmedVersion`) in place of the nmap name when they are set. (c) **Collapse the noise**: show Windows dynamic RPC (49152–65535 `msrpc`) as one `msrpc ×7` chip that expands on click, and collapse UDP by default to "+N UDP". (d) **Sort by relevance, not port number**: confirmed or flagged first, unidentified `?` second, everything else last. (e) **Use a grid, not flex-wrap**: fixed columns (port/proto · service · version) with a selectable row per service, so a long list can be scanned. | Partly: `truncated` on the w-24 label only. The chip wall, the raw nmap names and the sort order are eye-only. |
| 12 | **Sidebar host names truncated to 7 chars at every width** | all engagement screens | `host-story@1280.png` | `web-fin…` (62px visible of 306px) while the IP column takes the space. | Sidebar host row (`span.truncate`). Show the first DNS label (`web-finance-dmz-portal-01`), make the IP smaller or hide it on overflow, and use the full name as the tooltip. | Yes: `truncated` (64 rows, 306 > 62). |

---

## 1b. Layout principle: grid over flexbox (user decision, 2026-11-06)

Use **CSS grid as the default layout primitive** across Raven. Use flexbox only for single-line, one-dimensional runs that cannot wrap, such as an icon next to a label or a button group.

**Why:** most of the bugs above come from flex items negotiating space with each other:
- one-word-per-line squeezes (#3);
- the 0px search field next to the host chip (fixed in PR #8);
- the chip walls (#5, #11);
- detached Copy buttons (#9).

Grid tracks (`grid-cols-[auto_minmax(0,1fr)_auto]`, `minmax()`, named areas) make each column's size explicit, so content can't steal space from its neighbours.

**How to apply when fixing the items above:**
- Rows with a label, content and actions, such as checklist rows, credential rows, story and log rows, and command blocks with Copy, become grids with a fixed action track.
- Lists of structured items, such as services, ports and credentials, become real columns. They should not be wrapped chips.
- Keep flex only where the content is truly one line and the order can't overflow.

The audit should get a matching check: flag `flex-wrap` containers whose children vary widely in width. Those are candidates for grid.

## 2. Automated findings grouped by root cause

| Root cause | Rows | Verdict | Reason |
|---|---:|---|---|
| tiny-text 11px: checklist status segmented control (To do/Doing/Done/N/A) and small `Copy` buttons | ~11,000 | Intentional | Design scale for secondary controls. Repeated ×4 buttons × every step × every overlay screen. |
| tiny-text 11px: chips/pills (`rounded-full text-[11px]`) and mono meta (`font-mono text-[11px] text-muted`) | ~2,000 | Intentional | Chip and meta tokens. |
| tiny-text 10.5px: section labels (`uppercase tracking-label`, th, form labels) | ~1,400 | Intentional (hierarchy too weak in places, see §3) | Label token. Small caps-style labels are by design. |
| tiny-text 10.5px: kbd hints (`kbd h-[18px] text-[10.5px]`) | ~630 | Intentional | kbd hints are meant to be quiet. |
| tiny-text 10.5px: faint mono meta (sidebar IPs, arsenal tool names) | ~800 | Intentional | Meta. |
| tiny-text 10px: matrix SMB/SSH column heads, `text-[10px] text-muted` | 372 | **Real (minor)** | 10px mono at faint contrast is the one size actually hard to read. Bump to 10.5–11px. |
| small-target 20px: status segmented control (35–48×20) | 5,896 | **Real, low** (one fix) | 20px tall with 0 gap. Going to h-6 (24px) is cheap. Counted ×4 buttons × ~90 steps × 8 overlay screens. |
| small-target 16×16: checklist collapse chevrons (`button.w-4`, "Collapse …") | ~420 | **Real** | Tiny disclosure targets. Make the whole row header toggle. |
| small-target 16px: inline text links ("more in Arsenal", "From card …", nav links) | ~570 | False positive | Inline text links are exempt in WCAG 2.5.8. |
| small-target 19px: NOW-panel / list row title buttons (270×19) | 652 | False positive | Full-width text rows, easy to hit. Height-only test. |
| small-target 23px: Arsenal/Transfer sidebar list buttons (276×23) | 432 | False positive | Full-width rows 1px under the threshold. |
| contrast: `--faint` #5c5c5c on #000/#111 (3.14 / 2.82:1) | 896 | **Real token issue, one fix** | Sidebar IPs, kbd labels, arsenal tool names, "Per service" labels. Raise `--faint` to about #777 (4.5:1) or stop using faint for anything you need to read (IPs). |
| contrast: #747474 / #545454 | 16 | Real, trivial | Same token family. |
| mid-token-wrap: NOW-panel command blocks (`pr-16 font-mono text-[12.5px]`) | ~390 | **Real** | Duplicate panel too narrow (Top fix 1). Same rows repeated on 8 screens. |
| mid-token-wrap: credential routine commands | 28 | **Real** | Top fix 9. |
| overflow: story-row host chip (463 > 436) | 264 | **Real** | Top fix 5. Repeated on 6 overlay screens. |
| overflow: host grid / section / tablist at 900–1024 | ~85 | **Real** | Top fix 2. |
| overflow: board header/section/card at 900–1024 | ~60 | **Real** | Top fix 6. |
| overflow: exam status strip | 4 | **Real** | Top fix 7. |
| overflow: credentials matrix cell 34 > 32 | 4 | False positive | 2px sub-pixel, invisible. |
| offscreen: credentials/host-credentials matrix cells | ~160 | **Real (medium)** | The matrix (and the page) is wider than the viewport. At 1280 the ws07 column is cut off. Give it its own `overflow-x-auto` with a sticky first column. |
| offscreen: Findings tab, Edit, Delete, sort button @900 | ~36 | **Real** | Top fix 2. |
| overlap: page content under drawers/modals (host-stuck, capture-image, arsenal-drawer, palette) | ~120 | False positive | Elements behind an open overlay. |
| overlap: content under the sticky top bar or modal footer (Search/Lock vs To do; textarea vs Save) | ~60 | False positive | Scrolled under a sticky header/footer. |
| overlap: "Oldest first" sort over tab bar @900/1024 | ~21 | **Real** | Top fix 2. |
| truncated: sidebar host name (306 > 62) | 64 | **Real** | Top fix 12. |
| truncated: story-row title (266 > 225) | 36 | **Real** | Top fix 5. |
| truncated: engagement h1 (738 > 728), dashboard card h3, board card title, palette "for host" | ~84 | Intentional | Deliberately long test titles with ellipsis. Fine. |
| truncated: stuck drawer heading, findings services label | 8 | Real, minor | Stuck heading repeats the FQDN. Use the short name. |
| long-lines >100ch: checklist/credentials/list rows @1280/1440 | 400 | Mostly false positive | Single-line commands and table rows are good. Only `p.text-xs.text-muted` descriptions (~10) are real prose, so add `max-w-[80ch]`. |
| oversized-control: "Kali (VM)", "+ Host", "Commands use: None" selects; findings DCSync/Kerberoast row buttons | 22 | False positive | Full-width form fields and clickable rows are intended. The Copy-50% regression this check targets is **not** present. |
| squeezed: exam stats strip | 4 | **Real** | Top fix 7. |
| focus-hidden: "Fill for host" picker | 3 | **Real** | Top fix 8. |

**Noisy checks:** `tiny-text` (17k rows) and `small-target` (8k) flag design tokens, not defects. `contrast` repeats one colour token 896 times. `overlap` and `overflow` multiply because overlay screens re-audit the host page beneath them (identical counts of 36/53 on arsenal-drawer, capture-image, palette, palette-hostmenu, host-story, host-stuck). `long-lines` flags commands. The useful signal-to-row ratio is roughly 1 real root cause per ~1,800 rows.

---

## 3. Eye-only issues (not caught by checks)

- **Duplicate checklist on the host page** (NOW panel + Checklist tab), including on a rooted host. `exam-host-locked@1280.png`, `dc-story@1280.png`
- **Secret mask wraps into a vertical column.** `credentials@900.png`
- **Affected-services chip wall** for unselected hosts. `findings@1280.png`
- **"(hash)" said twice**: the name suffix `ACME\krbtgt (hash)` plus a "hash" type column or subtitle. Drop the suffix. `credentials@1280.png`, `host-credentials@1280.png`
- **Orange destructive buttons on every row** (credentials Delete ×12, finding steps Remove ×6, log Delete). This is accent noise. Use neutral styling until hover, or an overflow menu. `credentials@1280.png`, `findings@1280.png` (lower), `log-images@1280.png`
- **Flat hierarchy in the stuck drawer.** The group header "Manual enumeration first" has the same size and weight as the command labels. `host-stuck@1280.png`
- **Weak sub-section labels.** "Per service" and "Behind pivot-gw" are faint 10.5px and read as metadata, not section breaks. `host-checklist@1280.png` (y≈740), `eng-checklist@1280.png`
- **Status toggles centred vertically on tall rows** instead of top-aligned with the title. `host-checklist@1280.png`
- **Command spacing in the credential routine** is about 4px with no box, unlike the rest of the app. `credentials@1280.png`
- **Native `<select>`s with OS chrome** (white chevrons, system font) in Arsenal and Transfer. They clash with Ink, and the host select truncates `…dmz.finan`. `arsenal-browse@1280.png`, `transfer-generator@1280.png`
- **Arsenal browse wastes the main pane.** "Pick a card." sits alone in about 950px of empty space while cards are listed only in the sidebar. Auto-open the first card or list the cards in the main pane. `arsenal-browse@1280.png`
- **Transfer method tabs look like plain text** (no affordance). There is also a typo, "copies the **the** target half" (Windows variant). `transfer-generator@1280~error.png`
- **Test-matrix legend wraps to 3 rows at 900**, and the legend shows even when the matrix is empty. `host-credentials@900.png`, `credentials@1280~empty.png`
- **Log filter label "RAN ON" wraps to 2 lines.** `log@1280.png`
- **Log image caption repeats the title** ("Cropped proof of the hostname (64x40)"), and a 1920px image expands inline at full width. `log-images@1280.png`
- **Board puts rooted hosts (dc01, pivot-gw = root) in "Initial foothold".** Possibly a logic or stage-derivation bug. Verify. `board@1280.png`
- **Palette with no visible active row.** Nothing shows what Enter will act on. For "smb", the first hit is "Find credential files for client tools", so ranking may be off. `palette@1280.png`
- **Capture drawer**: the filename sits under the Caption input and reads like helper text. `capture-image@1280.png`
- **Checklist and engagement checklist open scrolled mid-list.** This may be intended auto-scroll to the current step, but the shots start mid-item with no anchor. Verify. `eng-checklist@1280.png`, `eng-checklist@1280~empty.png`

---

## 4. Flow friction & states

| Item | Recommended fix |
|---|---|
| flow:next-step: 13 actions > budget 2 (Tab×12, Enter) | Add `N` to focus or scroll to the first To-do or Doing step on the host page. |
| flow:arsenal-copy: 4 > 3; Enter opens instead of copies | Make Enter copy in the Arsenal drawer, as in the palette. Use → or Tab to open the card. |
| flow:switch-host: needs mouse | Index hosts in ⌘K (name/IP), and/or add `g h` then a digit, or ⌘1–9 for hosts. |
| flow:add-credential: pasting `user:pass` creates nothing | Teach intake to parse `user:pass`, `DOMAIN\user:pass` and `user:hash`. |
| focus-hidden: "Fill for host" (palette, arsenal-drawer) | Add a `:focus-within` ring on the picker wrapper (the native select is opacity 0). |
| blank-loading ×14 (host pages, credentials, findings, eng-checklist, palette, capture) | Show a skeleton or "Loading…" after 150ms. Hide the stats strip and sidebar host list until loaded (avoid "Rooted 0/0"). |
| silent-error: board, exam-board | Show the shared ErrorState with Try again instead of an empty board with zeros. |
| silent-error: arsenal-browse, transfer-generator | Likely a false positive: the cards are bundled and still render. Only the host list failed (it shows "No host"), so add an inline "Couldn't load hosts · retry" in the host picker. |
| missing-empty-state: credentials "Hashes 0" | Add "No hashes yet. Captured hashes land here." Hide the matrix legend when the matrix is empty. |
| Error style inconsistency (3 styles) | One ErrorState component everywhere. The log's card with Try again is the model. |

---

## 5. Check-tuning suggestions (audit, not app)

1. **Scope overlay screens to the overlay.** For drawer, modal and palette screens, run layout checks only inside `[role=dialog]`/`aside[aria-label]`, or treat the background as inert. This removes the ~8× duplication of host-page findings.
2. **Dedupe across screens and widths.** Group by (check, normalised selector, detail pattern). Report a count, the screens and the widths once. Collapse role-name selectors (`role=button[name=…]`) to their component class.
3. **tiny-text:** set the threshold to <10.5px, or allowlist the type tokens (`tracking-label`, `kbd`, chip `text-[11px]`, segmented control). Report per token, not per element.
4. **small-target:** apply the WCAG 2.5.8 rules properly: exempt inline text links, use the spacing exception, and flag only when **both** dimensions are <24, or width <24, or height <20. That keeps the 16×16 chevrons and 20px segmented control and drops the 276×23 rows.
5. **contrast:** collapse by (fg, bg) pair into one finding per colour token with the element count.
6. **overlap:** ignore elements that are not hit-testable (`elementFromPoint` ≠ element) because a sticky header/footer covers them, a scroll container clips them, or an aria-modal overlay sits on top.
7. **overflow / truncated:** ignore diffs ≤2px. For `truncated`, raise severity only when the visible part is <50% of the text, or <10ch (the sidebar host name 62/306 qualifies, the h1 728/738 doesn't).
8. **offscreen:** measure against the nearest scroll container, not the viewport, when that container has `overflow-x:auto`.
9. **long-lines:** exclude `code`/`pre`, command blocks and multi-column rows (`li` with flex children). Check only prose (`p`, description divs).
10. **New check, `narrow-wrap`:** flag text blocks of 4+ lines with an average of 6 or fewer characters per line. This would have caught both the user-reported 1-word-per-line notice and the secret-mask column, which every current check missed.
11. **Screenshots:** the full-page captures stretch fixed overlays. The palette renders at y≈407, the capture footer at the bottom of a 5,000px page, and inner scrollers start mid-content. Take a viewport-sized shot (scroll reset to top) plus the full-page shot.
12. **palette-hostmenu scenario:** the host menu never appears in the shot because native `<select>` popups don't render in Playwright, so this screen adds no coverage. Assert that the menu is open, or drop the screen.
13. **States:** for `silent-error`, require that the failed command's data is what the screen renders, since bundled Arsenal content isn't. For `blank-loading`, use a realistic delay and also flag "zero counts while loading" (e.g. `Rooted 0/0`) as misleading.

## 6. Deferred from UX round 1 (host page redesign, 2026-11-06)

Each item was reviewed and judged not to block the merge. Source: the round-1 review ledger.

- (T1) collapsed rail drops ThreadDot
- (T1) no tests for <1000px default, legacy story.order fallback, ⌘B under dialog, rail render
- (T1) log row chip track unbounded count
- (T2) vectorUpsert rejects ruled_out (use vectorSetStatus) — document in api.ts JSDoc
- (T2) fakeApi drift (manual upsert over ruled_out doesn't unlink; identity not trimmed/deduped)
- (T2) deleting service/vector orphans linked ruled_out; hand-deleting linked item leaves dead_end — consider clearing source on delete
- (T2) api.ts hostIdentitySet sends updatedAt:0; no cascade test for host delete
- (T3) id matched only as exact "id" (not id -a / sudo id); no test for serviceIdentity with unconfirmed version, whoami /groups CRLF
- (T4) no tests for error-output skip, empty no-op, ranOn mismatch, username fallback; "unknown" literal username
- (T5) Host Credentials "works" can double-count grant+attempt; services/queries.ts dead ruledOut invalidation; no stacked-variant test; ⌥2 typing test misnamed; (new-creds signal added to Next in final wave)
- (T6) 3.0 vector's version button is inert (no 3.0→3.1 switch)
- (T7) in-flight save error after close not surfaced; NVD state not in draft (closing within 400ms cancels lookup); nvdFill applied over snapshot; RefSuggestions fake Note objects; FindingEditor ~450 lines (extract useNvdLookup); no debounce test
- (T7) split log/host-chip/N tests assert DOM not layout (Playwright covers)
- (T7b) ServicePicker list double right padding inside editor pane; regression scoping via class-string match
- (T8) (bbox clipping check fixed in final wave) no ThreadsList pane test
- (T8b) dead hostIdentityGet fallback; write-timing test doesn't assert vectorUpsert
- (user) Log titles include the Evil-WinRM prompt (`*Evil-WinRM* PS C:\…> whoami /priv`). The title should be the command only.
- (identity) In a proof pasted with bare `#`/`$` prompts, a line inside `cat` output that starts with `# whoami` is read as a command, so the next line can be taken as a username (only when Ran on is that host). Pinned by a test in identityProof.test.ts.
- (identity) A Linux target reached by SSH and logged with Ran on = Kali is not read automatically. This is safe but manual; splitPaste could name the host from a `user@host` prompt.
