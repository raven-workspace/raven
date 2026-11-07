# Raven: host page redesign and in-place findings

Date: 2026-11-06. Status: draft for the user's approval.
Branch: `ux-fixes-round-1`. Product record: `PRODUCT.md`. Audit triage: `docs/superpowers/audits/2026-11-06-visual-audit-triage.md`.
Mockups (brainstorm, not committed): `.superpowers/brainstorm/20740-1794003145/content/` (`finding-placement.html`, `host-facts.html`, `host-layout.html`).

## 1. Intent

The host page is where the user spends most of a box. They open it for three jobs:
- log something;
- look up what's known about the host;
- check the checklist for what to run next.

They need the checklist and the host facts about equally, because the facts decide which next steps apply and rule others out. ("50/50" is a measure of how much each is needed, not a layout.)

**What's wrong today:**
- **Two places show the same thing.** A duplicate "Now" checklist sits beside the real Checklist tab.
- **Narrow windows break.** The page scrolls sideways below about 1100px, and tabs and actions go off-screen. Raven usually shares a screen with other apps at all sorts of widths, so this happens often.
- **The credentials notice squeezes titles** to one word per line.
- **Host chips repeat.** Every log row carries the full name of the host you're already on.
- **Sidebar host names are cut to 7 characters.**
- **Adding a finding means leaving the host.** Once the modal is open, none of the host's information can be seen, so writing one is a loop of close, look up, reopen.
- **CVSS needs a Google search** every time.

## 2. Goals, non-goals, anti-goals

**Goals**
- **One look answers both questions:** what do I know about this host, and what should I run next?
- **The facts change with the phase.** The facts that matter come first and the rest fold down to one line. Nothing is ever hidden.
- **Findings get written beside the host's information,** with the host, services, steps, references and CVSS filled in as far as Raven can.
- **The page works at any window width** from about 800px up, with no sideways scrolling.

**Non-goals (this round)**
- **Other screens.** Arsenal (the empty Reporting stage, command layout), the credentials table, the board and error states each get their own round.
- **Full output interpreters** (linpeas, winPEAS, SUID lists, cron). Only the three outputs in §4.4 are parsed now.
- **The Report section.**

**Anti-goals (failure even if it "works")**
- **The finding editor stays on screen permanently.** The user said they feared exactly that.
- **Something the user needs ends up a scroll or a tab-switch away** when they're deciding a next step.
- **Motion that is decorative, slow or startling.**
- **Icons that make the user guess.**

## 3. Constraints

- **PRODUCT.md principles bind:**
  - what's needed stays in view;
  - Raven fills in what it can;
  - keyboard-first;
  - nothing competes for attention;
  - grid layouts.
- **Grid over flexbox.** Use CSS grid with explicit tracks (`minmax(0,1fr)`, fixed action tracks). Use flexbox only for single-line runs.
- **Real data.** Every schema change goes through the migration system (`src-tauri/migrations/`, next is `0010_…`) and takes a backup first.
- **Network.** The NVD lookup (§5.4) is the **only** network exception, as the user decided on 2026-11-06. Update PRODUCT.md (Capabilities, Vault line) and the original design's non-goal to say so. Everything else stays offline.
- **Motion.** Use motion only where it shows a change of state: 150–250ms, ease-out, and instant when macOS "reduce motion" is on.
- **Keyboard.** New keys must not clash with existing ones:

  | Key | Action |
  |---|---|
  | `L` | capture |
  | `N` | notes |
  | `A` | Arsenal |
  | `H` | stuck view |
  | `1`–`6` | sections |
  | `[` `]` | move a board card |
  | `Esc` | close |
  | ⌘K | search |
  | ⌘L | lock |
  | ⌘N | new engagement |
  | ⌘E | notes scope, in the notes panel |
  | ⌥H | host picker |
  | ⌘P | private, inside capture |
  | ⌘↵ | save, in forms |

- **Tests.** `npm test`, `npm run typecheck`, `npm run lint` and `npm run audit:visual` all pass. Every user-visible fix gets a hard check in `audit/regressions.spec.ts` (§8).

## 4. Host page

### 4.1 Layout

- **Header:** host name, IP (monospace), OS, current stage, open-thread count and access level.
- **Wide windows (≥ ~1000px; exact breakpoint is the builder's call):**
  - the engagement sidebar;
  - a **Facts** column;
  - a **work** column with three tabs: **Next · Log · Findings**.

  The tracks are explicit, along the lines of `grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)]`.
- **Narrow windows:**
  - the sidebar starts collapsed (§6);
  - the Facts column turns into a stack of one-line summaries above the work column;
  - each summary opens in place (`Services · 7 ✓ · entry IIS 80 · 2 ?  ▸`).
- **The "Now" panel is removed.** The Next tab replaces it.
- **"Story" is renamed "Log"** everywhere it shows the same information: the tab, empty states, copy and tests. The user's rule: one name per kind of information.

### 4.2 Next tab (default)

- **Content:** the current stage's open checklist steps, each with its filled, ready-to-copy commands.
- **Full checklist:** "Full checklist ▸" expands all stages. This is today's Checklist content, inside this tab.
- **The "N new credentials since this was done" notice** becomes one line in the step: `12 new creds since done · re-check ▸`. The credential list sits in a disclosure, and the row's title track keeps its width.
- **Command blocks** keep Copy inline in a fixed grid track, with at least 8px between blocks.

### 4.3 Log tab

- **Content:** today's Story.
- **Rows** for the current host show no host chip. Rows that name other hosts show their short name (§6), truncated to about 16ch, and the title track gets priority.

### 4.4 Facts column

**Which phase:** the host's `access` field decides it, not the board column. `none` means before a foothold; `user` or `root` means after. A card placed by hand, or one the board hasn't caught up on, doesn't change which facts show.

Groups are ordered by phase. The current phase's groups come first and are open. Earlier groups fold to one summary line, which opens in place. An opened group stays open for that host until the user folds it. `S` toggles the **Services** group from anywhere on the host page. Keys for the other groups are the builder's call.

**Before a foothold** (Information gathering, Vulnerability detection, Initial foothold):
- **Coverage:** steps done out of applicable, per stage.
- **Services:** a grid with port/proto, identity and verdict columns.
  - The identity is the **confirmed product and version** when set; otherwise nmap's guess, dimmed, with `?` for unidentified ones.
  - The verdict is one of: **candidate**, **untested**, **dead end**, or **identify** (automatic for unidentified services).
  - Windows dynamic RPC (`msrpc` on 49152–65535) folds into one `msrpc ×N` row, and UDP folds into `N UDP`. Both open on click.
  - Rows sort by verdict: candidate, then identify, then untested, then dead end. Port number breaks ties.
- **Credentials here:** this replaces the host's Credentials tab. Everything that tab does today stays, inside this group:
  - what works here, with each result linked to its proof log entry;
  - engagement credentials not yet tested against this host's services;
  - access without a secret, added and removed in place.

  The full matrix stays in the engagement's Credentials section.

**After a foothold** (Privilege escalation onwards):
- **Who am I:** the user, how access was gained, and key privileges.
- **Privesc vectors:** each with a status of **try**, **untested** or **ruled out**.
- **Other accounts:** accounts that might get further, such as uncracked hashes or credentials for other users seen on this host.
- **Services, Coverage and Credentials** fold into summaries.

**Where the new facts come from:**
- **Service verdict.**
  - Stored on the service.
  - Set with a keystroke on the focused row, or from its menu.
  - Setting **dead end** asks for a one-line reason and creates a ruled-out item, which feeds the report as today's ruled-out items do.
  - **Candidate** and **untested** need no reason.
- **Who am I and privileges.**
  - Parsed from captured command output of `whoami`, `whoami /priv`, `whoami /groups` (Windows) and `id` (Linux), when those commands are logged against the host.
  - Stored per host as the latest identity, with a link to the log entry it came from. "How access was gained" comes from the matching access grant's "via", so it is not stored twice.
  - Can be edited by hand.
  - Notable privileges (SeImpersonate, SeBackup, SeDebug, SeLoadDriver, SeTakeOwnership, SeRestore and SeManageVolume; `sudo`/`docker`/`lxd`/`disk` groups on Linux) automatically add a privesc vector marked **try**.
- **Privesc vectors.** Stored per host. They are added automatically from privileges, or by hand. Marking one ruled out works like a dead-end service: one line, and it becomes a ruled-out item.
- **Undoing a verdict.** A ruled-out item created from a service or vector keeps a link back to it (a source column in migration `0010`). Setting the service back to candidate or untested, or reopening the vector, deletes that ruled-out item. Ruled-out items written by hand are untouched.

### 4.5 Findings tab and the in-place editor

- **Tab content:** the host's findings and their attempts.
- **Adding or editing a finding** (button, plus a key chosen by the builder) splits the host page:
  - the editor takes the right side;
  - the left keeps the host's Log, Services and Notes, live and scrollable.

  It is a temporary mode, never a modal and never permanent. Save (⌘↵) or `Esc` closes it.
- **Drafts.** An unsaved draft survives `Esc`, closing the split and navigating away, and comes back when the user reopens "Add finding" on that host. It lives in app memory only and is gone after an app restart or a lock, so draft text never sits unencrypted on disk.
- **Filled in from the host:**
  - affected host = this host;
  - affected services are offered from the selected hosts **only**, in the same grid, identity, folding and sort as §4.4, and selected by row;
  - steps = Log rows clicked (or picked with a key) on the left, appended in order and reorderable as today;
  - references: CVE IDs (`CVE-\d{4}-\d{4,}`) and EDB IDs (`EDB-ID[: ]?\d+`, `exploit-db.com/exploits/\d+`) found in this host's Log and Notes are offered as one-click chips.
- **CVSS:** see §5.
- **The left pane** has three tabs: **Log · Facts · Notes**.
  - The Facts tab is the same Facts column as §4.4, so Who am I and privesc vectors are there when writing a privesc finding.
  - Notes is the host's field notes, editable inline.
- **More than one affected host:** the left pane gets a host switcher listing the finding's affected hosts, and steps can come from any of them.
- **Opened from the engagement's Findings section:** it opens the same split, and this replaces today's modal everywhere.
  - With one affected host, the left pane shows that host.
  - With several, it shows the switcher.
  - With none yet, it shows the engagement Log.
- **The ordered steps list** in the editor stays as today's `FindingSteps`, with reorder and remove.
- **Narrow windows (below the stacked breakpoint):** the split becomes two panes the user flips between with one key, editor or host info, and the draft is kept.
- **Other right-edge panels:**
  - `N` while the editor is open switches the left pane to its Notes tab.
  - `H` (stuck view) closes the split, keeping the draft.
  - Capture (`L`) works as normal, and a new entry appears in the left pane's Log immediately.

## 5. CVSS, CVE details and the NVD lookup

### 5.1 CVSS 4.0 support

- `src/engines/findings/cvss.ts` parses and scores **CVSS 3.0, 3.1 and 4.0** base vectors.
- **4.0 scoring:** use the official FIRST CVSS v4.0 method (MacroVector lookup table plus severity distance). It should be ported and tested against FIRST's published examples, not approximated.
- **Storage:** `cvssVector` keeps the full prefixed vector (`CVSS:4.0/…` or `CVSS:3.1/…`). The score and severity come from it.
- **Existing rows:** vectors stored without a prefix are read as 3.1 at runtime. No migration rewrites them.

### 5.2 Local builder (no CVE, or offline)

- **Purpose:** a compact metric picker beside the vector field for misconfigurations (no CVE) or when NVD can't be reached.
- **Mechanics:** one segmented control per base metric. It writes the vector and shows the score live. Version 3.1 or 4.0 is picked with a toggle; 4.0 is the default (my call).

### 5.3 What the user does

1. Add a CVE in references, by typing it or clicking a suggested chip.
2. Raven looks it up (§5.4) and shows what came back. Empty fields fill in directly. For fields that already hold text, a one-click "use NVD" diff is offered, so the user's text is never overwritten without asking.

### 5.4 NVD lookup

- **Endpoint:** `GET https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=<ID>`, with the header `apiKey: <key>`.
- **Runs in Rust.** A Tauri command makes the request, so the webview's CSP stays closed to the network and no other code path can reach the internet.
- **What's sent:** only the CVE ID and the key.
- **The key** is entered in Settings and stored encrypted in the vault like other settings. With no key there are **no lookups**, and the local builder is the only path.
- **What's taken back:**
  - the CVSS vectors and scores: 4.0 preferred, falling back to 3.1, then 3.0;
  - the English description;
  - CWE IDs;
  - published and last-modified dates;
  - reference URLs. Any `exploit-db.com/exploits/<id>` becomes an EDB reference.
- **Fill rules:**
  - an empty finding CVSS takes the CVE's vector, and the score and severity follow from it;
  - NVD's own Primary score is used; if NVD has none, the CNA's;
  - with several CVEs, the highest-scoring vector is used, and a filled CVSS gets the "use NVD" diff as in §5.3;
  - the description fills an empty finding description;
  - reference URLs are added to refs;
  - CWE IDs are added to refs as `CWE-<n>`.
- **Caching:** each response is cached per CVE in the database, so a repeat lookup and later offline use cost nothing.
- **Rate limits:** NVD allows 50 requests per 30s with a key. One lookup per added CVE, debounced, stays far under that.
- **Errors:** "No connection", "Key rejected" and "CVE not found" show as one quiet line under the reference, with "use the builder". A failed lookup never blocks saving.

## 6. Engagement sidebar

- **Headings:** an **"Engagement"** heading over the section links (Board, Log, Credentials, Findings, Engagement checklist, Report), matching the existing "Hosts" heading.
- **Collapsible:**
  - **On collapse,** it narrows to a slim rail with icons and the number-key hints for sections and host state glyphs, and the rest of the page takes the space.
  - **The key** to toggle it is the builder's call, checked against §3.
  - **Animation:** the slide is about 200ms ease-out, animating width or transform on a grid track, with no layout jump on the page. It is instant under reduce motion.
  - **Persistence:** the state is remembered across sessions.
  - **Default:** collapsed below the narrow breakpoint, expanded above it.
- **Host rows** show two lines on a grid:
  - the **short name** (the first DNS label, so `web-finance-dmz-portal-01`, not `web-fin…`), with the full name in a tooltip;
  - the **IP underneath**, monospace and never truncated.

  The user's reason: matching the name to the IP at the start of an engagement, above all when the name had to be enumerated.

## 7. Icons

- **Set:** Phosphor (`@phosphor-icons/react`), imported per icon so the bundle stays tree-shaken. The default weight is **light**, to match Ink's hairlines. Fill or bold only where state needs it, such as a selected toggle.
- **Where icons replace words,** only for universal meanings:
  - edit;
  - delete (keeps the warning amber and its confirmation);
  - copy;
  - close;
  - add;
  - expand and collapse;
  - the sidebar toggle.
- **Accessibility:** every icon-only button has an `aria-label` and a tooltip that shows its shortcut.
- **Words stay** wherever an icon would make the user guess.
- **Scope:** this round uses icons on the host page, the finding editor and the sidebar only.

## 8. Audit and regression checks

Add hard checks to `audit/regressions.spec.ts`, each failing the run when it breaks:
- **No sideways scroll:** the host page at 800, 900, 1024, 1280 and 1440px has no horizontal page scroll, and every tab is fully on-screen.
- **Next tab:** a step with the credentials notice keeps its title on one line at 900px when the title fits, and is never more than two lines.
- **Add finding from a host:**
  - opens the split;
  - the Log stays visible and scrollable;
  - clicking a Log row adds a step;
  - `Esc` keeps the draft.
- **Finding services field:** it lists only the selected hosts' services, and confirmed identities replace nmap names.
- **Sidebar:**
  - collapse and expand change the layout without the page scrolling sideways;
  - host rows show the IP;
  - names are no longer cut to `web-fin…`.
- **Log rows on a host page** have no chip for that host.

Update `audit/screens.ts` for the renamed tabs and new states:
- the pre- and post-foothold facts, using an exam host with access in the fixtures;
- the finding split;
- the collapsed sidebar.

Add `narrow-wrap` to the audit's checks: text blocks of 4 or more lines averaging 6 or fewer characters per line. This is triage §5 item 10.

## 9. Left to the builder

- Exact breakpoints, and keys for the tabs, fact groups (other than `S`), "Add finding" and the sidebar toggle, all checked against §3.
- The data shapes and migration for the service verdict, host identity and privesc vectors, and the NVD cache (`0010_…`).
- How the narrow-layout summaries word each group.
- The Rust HTTP client crate for the NVD call. Keep it small, and use rustls rather than native TLS if that's simpler to ship.

## 10. Calls I made (the user should check these)

- **The full checklist moves inside the Next tab** ("Full checklist ▸") instead of keeping a separate Checklist tab.
- **The host's Credentials tab is removed** and replaced by the "Credentials here" fact. The full matrix stays at engagement level.
- **About 1000px is the switch point** between the stacked and the two-column layout.
- **Finding drafts live in app memory only,** never on disk, so they don't survive an app restart or a lock.
- **The local CVSS builder defaults to 4.0.**
- **NVD fill rules:** empty fields fill directly; filled fields get a "use NVD" diff rather than being overwritten.
- **Only three outputs are parsed for "Who am I" this round:** `whoami` (with `/priv` and `/groups`) and `id`. The fuller interpreters stay in phase 2b.
- **Marking a service a dead end or a vector ruled out asks for one line** and creates a ruled-out item.
- **The engagement Findings section uses the same split editor,** and the modal is removed everywhere.
- **The host Facts switch on `access`**, not on the board column.
- **The host's Credentials tab moves into the "Credentials here" fact** with all of its features kept (results with proof links, access without a secret). "How access was gained" comes from access grants.
- **The split's left pane has three tabs: Log · Facts · Notes.** Several affected hosts get a host switcher. Narrow windows flip between the panes. `N` opens the Notes tab, and `H` closes the split with the draft kept.
- **NVD fills an empty CVSS** with NVD's own score (the CNA's if NVD has none), and the highest-scoring CVE wins.
- **Unprefixed stored vectors are read as 3.1** at runtime, with no data rewrite.
- **Undoing a dead end or a ruled-out vector deletes the ruled-out item it created.** Hand-written ones are kept.
