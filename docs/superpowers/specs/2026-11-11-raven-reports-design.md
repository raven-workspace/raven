# Raven Reports: design

Date: 2026-11-11. Branch: `feat/reports`. Status: approved brief, written design.

## 1. Intent

Raven's fourth job (PRODUCT.md) is to "produce a polished report afterwards from what was recorded". The Report section is still a placeholder (`src/features/engagements/sections.tsx`, "Report arrives in phase 3"). This round builds it.

The first target is the **OSCP+ exam report**: a PDF uploaded within 24 hours of the exam ending. The owner has never written a pentest report. During the exam they only capture (log entries, screenshots, flags, notes) and move fast. Afterwards they sit down once and write. Raven's job in that window is to do every clerical part — gathering, ordering, formatting, numbering, checking against OffSec's rules — so the owner spends the time writing explanations, not hunting and pasting.

The original desktop spec (`2026-11-03-raven-desktop-design.md`, phase 3) planned this and asked that it be **done before the exam so the owner has practised with it**. Practice runs happen on lab and exam-sim engagements.

## 2. What OffSec grades (binding)

From the current OSCP+ Exam Guide (help.offsec.com article 360040165632):

- **Format:** PDF only, named `OSCP-OS-XXXXX-Exam-Report.pdf` (OS-XXXXX is the OSID; case-sensitive), inside an unpassworded `OSCP-OS-XXXXX-Exam-Report.7z`, at most 200 MB. Uploaded at upload.offsec.com, where the owner checks the MD5 shown against the local file.
- **Reproducible:** every step, command and console output, so a technically competent reader can replicate the attack. Insufficient documentation loses points. Nothing can be sent later.
- **Exploit code:** an unmodified exploit gets only its URL. A modified one needs the modified code, the original URL, any shellcode generation command, the changes highlighted, and an explanation of each change. Scripts and PoCs go in the PDF as text.
- **Proof:** each `local.txt` and `proof.txt` in a screenshot showing the file's contents (`type`/`cat` from an interactive shell, in its original location) **and** the target's IP (`ipconfig`, `ifconfig` or `ip addr`). A web shell earns zero. Missing proof in a screenshot means zero for that target.
- **Order:** targets are graded in the order they appear in the report.
- **Exam layout:** three standalone machines (20 points each: 10 foothold, 10 privesc) and one AD set of three machines (40 points).
- **Metasploit:** usable on one target only; the report should say which.
- **No AI help:** LLMs are banned as third-party help.

## 3. Goals, non-goals, anti-goals

**Goals**
- Open Report and a draft already exists for every target. The owner writes and trims; they never start from a blank page.
- Everything Raven knows is filled in: candidate details, the file name, services, commands with output, screenshots with numbered captions, proofs, the proof table, the Metasploit target, the AD chain, house cleaning.
- Every OffSec rule Raven can check is checked, per target, in plain words, before export.
- Export writes the correctly named PDF (and .7z) in one action.
- Fast and keyboard-first, as everywhere in Raven.

**Non-goals (this round)**
- Client report specifics (findings-first layout with an executive risk summary, branding, cover, logo). They come after the exam and reuse this machinery; this round already reports vulnerabilities, fixes and what was tested per target (5.4).
- A personal findings library.
- Report templates or themes beyond the one house style.
- Collaboration, comments, version history beyond undo.

**Anti-goals (a failure even if it works)**
- Any AI or "suggested wording" for the owner's prose. OffSec bans it; the words are the owner's.
- Any extra action required **during** the exam to make the report work. Capture stays exactly as it is.
- Private content (private log entries, private notes, finding lessons, private ruled-out items and attempts, operator-kind attempt reasons) reaching the page, the rail or the PDF.
- A report that looks finished but would score zero (a missing proof or IP) without Raven saying so loudly.
- Copying evidence into the document so it goes stale or doubles the database size (see 6.2).

## 4. The Report view

The owner chose the "Page with an evidence rail" layout. Sketch: `.impeccable/mocks/decision/report-page-and-rail.html` (1440×900, first viewport only). It is the composition the build matches; the build owes the responsive page, content below the fold and every state.

It lives at the engagement's **Report** section (sidebar, its existing number key). It is a full section view inside the engagement, with Raven's title bar and sidebar.

### 4.1 Regions

**Status strip (top).** Labelled cells, as the existing status strip: the file name (`OSCP-OS-48213-Exam-Report.pdf`), time left until the 24-hour deadline (from the exam end; see 6.6), targets ready (`2/6`), gaps (count, amber when non-zero). **Export PDF** is the view's one primary action, at the strip's right.

**Outline (left, ~272px).**
- *Report:* Report details, High-level summary, Methodology.
- *Targets, in grading order:* each standalone host, then the AD set as one entry (its machines named). Each target shows a state glyph (ready / gaps / not started) and its IP's last octet. The current target is selected (surface-hi + accent bar).
- *Under the current target, its checks* (6.5) in plain words, each with a pass or amber mark. Clicking a check scrolls the page to the place it concerns and focuses it.
- *Appendices:* Proof table, Tools and payloads, Metasploit usage, House cleaning, and any long exploit code moved out of a target section. Marked "auto" when generated.
- Targets can be reordered (drag, and ⌥↑/⌥↓ on the focused target). The order is the grading order.

**Page (centre).** A light page on Ink's black, styled as the PDF will look (house style, 4.3). The owner types directly on it. It shows one target (or one front-matter section, or one appendix) at a time: the item selected in the outline. Evidence blocks (commands with output, screenshots with captions, flags) sit on the page as non-editable blocks the owner can move, remove or insert between; prose is freely editable around them.

**Evidence rail (right, ~320px).** Tabs for the current target:
- *Unused* (with count): this target's non-private log entries that are not on the page, newest first or time order (builder's call, with a sort toggle per DESIGN.md). Each row has **Insert** (at the cursor; also ⌘↵ on the focused row).
- *Notes:* the host's field notes (and the engagement note), read-only, with lines copyable. Open threads (`? ` lines) are marked.
- *Creds:* credentials and access grants relevant to this host (source host or works-on), read-only.

### 4.2 Keys

Keyboard-first, listed in the Shortcuts sheet (`usePageShortcuts`), not a hint row:
- `J`/`K` or ↑/↓ in the outline moves between targets and sections; ↵ opens.
- A key to jump focus between outline, page and rail (builder's choice; e.g. ⌥1/⌥2/⌥3 or F6 cycling, consistent with existing tab keys).
- On a focused evidence block on the page: **Backspace/Delete removes it to Unused** (with undo), ⌥↑/⌥↓ moves it.
- In the rail: ↵/⌘↵ inserts the focused entry at the page cursor.
- ⌘E exports (or the builder's choice that doesn't collide).
- Standard editor keys inside the page (⌘B, ⌘Z/⇧⌘Z, lists, code).

### 4.3 House style (the PDF and the page)

The owner's own clean house style, not a copy of OffSec's Word template:
- Light paper, near-black ink, Instrument Sans for text and JetBrains Mono for commands, output and code. One accent colour used sparingly (it must work on paper and in greyscale print; Ink's lime is a screen colour, so the paper accent is a darker relative or a neutral — decided in the style round).
- Section structure: see 5.6 (the outline is binding). It follows OffSec's required content, PEN-200 Module 5, the owner's Field Manual `05-Reporting` notes, and the template in the owner's old template (a PentestReportAI template, not OffSec's own; used as a reasonable structure, not as authority).
- Cover: "OSCP Exam Report", OSID, email, exam date, report date, "Confidential". Every page: header "OSCP Exam Report - OS-XXXXX", footer "Page N | Confidential". A table of contents after the cover.
- Commands render as `prompt$ command` above their output in a tinted code block; long lines wrap, never clip. Screenshots fit the page width with "Figure N." captions, numbered across the document.
- **A short style round comes before the export work:** two or three page-style mockups (title page, a target section with code and a screenshot, the proof table) in the decision page, owner picks one. The page in the editor and the PDF share that one stylesheet.

### 4.4 Narrow windows

The owner's real window is about 1400px wide in WKWebView, often with the sidebar expanded.
- Under ~1200px of pane width, the evidence rail becomes a drawer from the right (same slide as Notes/stuck view), toggled by a key and a strip button.
- Under ~1000px, the outline collapses to a single target picker above the page; checks move into a "Checks" disclosure above the page.
- The page has a max width (~720–760px) and is centred in its pane; it never scales its type with width.
Use container queries on the pane (DESIGN.md layout rule 6).

### 4.5 States

- **No report yet:** opening Report creates it (6.1) and builds the draft; there is no empty "create report" step. If the engagement has no hosts, an EmptyState says so.
- **Report details missing** (name, OSID, email): Report details is the first outline item with an amber mark; the file name in the strip shows `OSCP-OS-?????-Exam-Report.pdf` in amber.
- **Target not started** (no log entries): its page says so in one line; it still appears in the outline and the PDF (with whatever exists), and its checks fail.
- **Evidence changed after it was placed** (entry edited in the Log): the block shows the current entry (6.2). **Entry deleted or made private:** the block turns into an amber placeholder on the page ("This entry was deleted / is now private") and counts as a gap; it is never exported.
- **Export running / done / failed:** see 6.7.
- **Loading / error:** standard `LoadingState` / `ErrorState`.

## 5. The smart draft

When a target's page is first opened (or the report is first created), Raven builds that target's draft once. After that, the owner's page is the source of truth; Raven never rebuilds it silently.

**Add new evidence** (per target) is the only re-run, for when the owner logged more after starting. It never removes or rewrites anything on the page: it takes entries that now qualify under 5.1 and aren't on the page or deliberately removed, and appends each to the end of its sub-section (Initial access, Privilege escalation or Proof), each followed by an empty prose slot. Entries the owner removed to Unused are remembered and not re-added. It shows what it added and supports undo. There is no "throw the page away and regenerate" action.

### 5.1 What lands on the page

Per target, in time order, split into **Initial access**, **Privilege escalation** and **Proof** sub-sections:
- Log entries linked to the host that **proved something**:
  - ticked a checklist goal (they appear as `evidence` on a checklist item);
  - confirmed a service (`services.confirmed_entry_id`);
  - granted access (`access_grants.log_entry_id`) or made a hop (`hops.log_entry_id`);
  - a flag entry;
  - steps of a finding linked to the host (`finding_steps`).
- A screenshot entry whose time falls between two kept entries, or within a few minutes after one (builder picks the window), comes along with it.
- **Left out of the step-by-step (in Unused):** entries with a failed attempt linked (`failed_attempts.log_entry_id`), "returned nothing" entries, notes, and anything not matched above. Failed attempts are still reported, as the "Tested, not exploited" list (5.4); Unused only decides whether their full command and output also appear as a step.
- **Never anywhere:** private entries.

**The foothold/privesc split:** the first entry that granted user-level access (or the first `local.txt` flag) closes Initial access; everything after it up to the root/SYSTEM/admin access goes to Privilege escalation; flags go to Proof. If Raven can't tell, everything goes to Initial access and the owner moves the divider (the sub-section heading is a block they can move like any other). Where the target was entered via a hop rather than its own foothold (AD set), the hop is the foothold.

### 5.2 What else is filled

- **Target heading:** host name, IP, OS, and one line of facts (ports, access reached).
- **Services table:** port, protocol, the confirmed product and version where proven, otherwise nmap's guess marked as such.
- **Each command block:** each `{command, output}` pair from the entry, with the prompt shown as the `ran_on` machine (`kali$` or the host's shell). The owner trims output by **keeping chosen line ranges**; Raven puts "… N lines omitted" between them (head-and-tail folding would hide the line that matters, often in the middle). The owner can also emphasise key lines. Long outputs start trimmed to a builder-chosen head with a prompt to pick the relevant lines; trimming is per placement and never changes the log entry.
- **Each screenshot:** the image and a caption from the entry's caption, numbered at render time.
- **Proof:** each flag entry with its value, the pasted proof text and its screenshot.
- **Exploits:** `finding_files` gain two fields (migration): **modified** (yes/no) and **original URL**, editable in the finding's Files section and on the page. A modified file attached to a finding linked to the host appears in the section as code, with its original URL and an "explain each change" prose slot (the check in 6.5 enforces it). An unmodified exploit appears as its URL only, as OffSec asks: from the file's original URL, or from the finding's `refs` (EDB IDs and URLs) when there's no file. OffSec requires the changes **highlighted**, so a modified file also takes the **original** (pasted or loaded as text; no network) and Raven renders a local line diff with changes marked. Where the owner has no original, they mark changed lines on the code block by hand. Code too long for the flow (course p.113) moves to an appendix, leaving a reference in the target section.
- **Empty prose slots** after each block, so the cursor has an obvious place to go. They carry quiet placeholder text ("What this shows, and why it matters") that never exports.

### 5.3 Which targets

- **Exam-sim engagements:** every standalone host is a target; hosts with `ad_set` form the one AD set target, as the existing progress counts do.
- **Lab engagements:** the owner picks which hosts are in the report (a checkbox per host in the outline's target list; default: hosts with at least one flag). Each is a standalone target. If any hosts have `ad_set`, they group as an AD set target the same way.
- **Client engagements:** the Report section shows a one-line EmptyState ("Client reports come after the exam") this round.

### 5.4 Written as a real engagement report

The owner's rule (2026-11-11): treat the exam report as a real pentest report. What didn't work is reported too, because it gives the client coverage assurance and shows a complete testing methodology. The only things left out are private ones; a failed attempt whose reason is **operator** (the owner's own inexperience) is private by design and never appears.

So each target section also carries, generated from live data and editable around:
- **Vulnerabilities:** for each finding linked to the host: title, severity (and CVSS vector where set), **affected** (host, IP, port, URL or parameter, from the finding's hosts and services), description as the vulnerability explanation, impact, remediation as the fix (rendered as a list: one distinct step per item, remediation and mitigation both where a fix takes time), and **references** (from `refs`). It sits at the **top** of the sub-section it enabled (foothold or privesc, by the finding's steps, or the owner moves it), before the steps. This is the template's "Vulnerability Explanation / Vulnerability Fix / Severity" block. Lessons stay private.
- **Tested, not exploited:** terse one-line entries, no command blocks by default (course p.105: don't bury the reader in the technical detail of attempts): the target's non-private failed attempts (title, reason kind as plain words: "blocked by a control", "precondition not met", "no access", and the reason text) and non-private ruled-out items (text and reason), as a list. A failed attempt's log entry can still be inserted as full evidence from Unused where showing the command helps.
- **Coverage per service:** the services table gains a result column: exploited (with which finding), tested, no exploitable issue found (with the attempt or ruled-out reason; never an absolute claim, course p.108), or not tested. Derived from findings, attempts, ruled-out items and service verdicts; the owner can correct a row.

Engagement-level failed attempts and ruled-out items with no host go in a **Tested, not exploited** sub-section of the AD set (if domain-related) or a report-level one before the appendices (builder decides the placement rule).

New checks (6.5), soft: a service with no result ("not tested") and a finding with an empty description or remediation.

### 5.5 Report-level sections

- **Report details:** candidate name, email, OSID; report title; exam date and report date. Name and email default from Settings (a new "Report details" group; OSID too), and are editable per report.
- **High-level summary:**
  - a generated **Engagement details** block first (course §5.2.3): scope (every target and IP), test window (from the timebox), the attacker IP, restrictions in force (Metasploit on one target, banned techniques, no AI), and accounts or credentials created (from the cleanup list);
  - prose slots in the course's order, as labelled empty placeholders only: what the engagement was; hardening observed (things done well); vulnerabilities and trends; wrap-up. The rail surfaces "blocked by a control" attempts for the "done well" slot;
  - the exploited-systems table: target, IP, access level, **method** (defaults to the finding title; editable). No flag columns; those are in the proof table;
  - **Recommendations**, an empty prose slot.
- **Testing considerations:** after the summary, one prose slot for anything that affected testing (course §5.2.4), placeholder naming positive, neutral and negative outcomes (e.g. VPN drops, machine reverts, time).
- **Methodology:** a default text the owner can edit (stored as a Settings default so it is written once), with sub-sections Information gathering, Service enumeration, Penetration, Post-exploitation (maintaining access), House cleaning, and a **severity legend** (Critical/High/Medium/Low/Info, one line each), stating that ratings are technical severity, not business risk.
- **AD set:** an **AD overview** first (domain, a machine/IP/role/OS table, a prose slot for the path); then a sub-section per machine whose phases are named by how it was entered: **Initial access** (the first machine), **Lateral movement** (entered by a hop), **Domain compromise** (the DC), replacing the foothold/privesc split for these machines; the DC's proof adds a "Domain admin: yes/no" row; then the **attack chain** generated from `hops` and `access_grants` (from → to, via what credential or technique, at which step), rendered as a simple ordered list (a diagram is a later round).
- **Appendices (auto):** proof table (target, IP, hostname, local.txt, proof.txt values; "N/A" where a flag isn't expected), tools and payloads (tool, purpose, URL; generated from command first words, purpose and URL editable), Metasploit usage (target, module, purpose; modules found in that host's commands, or "not used"), house cleaning (from the cleanup list, with removed/open status). The owner can add prose to each.

### 5.6 Report outline (binding)

1. Cover, then table of contents.
2. High-level summary: engagement details; summary prose slots; exploited-systems table; recommendations.
3. Testing considerations.
4. Methodology, with the severity legend.
5. Independent targets, in grading order. Each: heading and facts; services with coverage; Initial access (vulnerability block, then steps); Privilege escalation (vulnerability block, then steps); Tested, not exploited; Proof (item/value table: local.txt, proof.txt, IP address, hostname; then the proof screenshot and text).
6. Active Directory set: AD overview; each machine (services, Initial access / Lateral movement / Domain compromise, tested-not-exploited, proof); attack chain.
7. Engagement-level tested-not-exploited, if any.
8. Appendices: proof table; tools and payloads; Metasploit usage; house cleaning; long exploit code.

## 6. How it works

### 6.1 Data

New tables via a migration (backup first, per the data-safety rule). Names are the builder's; the shape:
- **report** (one per engagement for now; the schema allows more later): engagement, kind (`oscp`), candidate name, email, OSID, title, created/updated, exported-at.
- **report_section**: report, kind (`details`, `summary`, `methodology`, `target`, `appendix-*`), target reference (host id, or the AD set), position (grading order for targets), the editor document (ProseMirror JSON), draft-built-at.
- Settings gains the owner's default name, email, OSID and methodology text.

### 6.2 Evidence is referenced, not copied

The page document holds **evidence nodes** that point at a log entry (and, for command entries, a block index); they don't copy its text or image. The editor and the PDF render the entry's current content from the database. Editing an entry in the Log updates the report; deleting it or marking it private produces the amber placeholder (4.5). Screenshots are fetched by attachment id as today (`AttachmentImage`). Generated tables (services, proof table, exploited systems, attack chain, house cleaning) are nodes rendered from live data too, not frozen text.

### 6.3 Editor

**ProseKit** (MIT, headless, ProseMirror-based, React support) is approved by the owner as the one new dependency for this round. It is styled entirely with Raven's tokens (the page uses the house style; editor chrome uses Ink). Custom node views render the evidence and generated nodes with React. Content saves automatically (debounced) like field notes.

Required editing: paragraphs, headings (within the section's fixed structure), bold/italic/inline code, bulleted and numbered lists, code blocks (for text the owner writes, distinct from evidence blocks), links, and moving/removing evidence blocks. Tables beyond the generated ones are not needed this round.

No slash-menu AI, autocomplete or "improve writing" of any kind.

### 6.4 Rail data

- *Unused* = host-linked, non-private log entries not referenced by any node on this target's page.
- *Notes* = the host's field note (and the engagement note), non-private only. Read-only here; editing stays in `N`.
- *Creds* = non-private credentials and access grants tied to the host.

### 6.5 Checks

Per target, computed live, each a plain sentence that names what's wrong and how to fix it. "Ready" means no failing check. At least:
- **Proof present:** every flag the target is expected to have exists as a flag entry and is on the page. **Expected flags** are a per-machine setting shown in the outline under the target and editable there: standalone machines default to `local.txt` and `proof.txt`; each machine in the AD set defaults to `proof.txt` only. The owner adjusts it when a machine differs (OffSec doesn't publish a fixed rule per AD machine). The proof table lists the expected flags, with missing ones in amber.
- **Proof shows the IP:** the flag's proof text includes `ipconfig`/`ifconfig`/`ip a(ddr)` output containing the host's IP, **and** the flag has a screenshot. (Raven can't read the image; the text check plus "has a screenshot" is the proxy, and the check's wording says so.)
- **Proof from an interactive shell:** warn if the flag entry looks like it came from a web request (an HTTP entry) rather than a shell.
- **Every command has its output:** each command block on the page has output, or the entry is marked "returned nothing".
- **Every step is explained:** no evidence block without owner prose after it (soft). Screenshots without supporting text are listed first (course: never let a screenshot speak for itself).
- **Proof is complete:** besides the IP, the proof text shows identity (`whoami`/`id`) and hostname, and the `cat`/`type` path is the usual location (`/root`, `/home/*`, `C:\Users\*\Desktop`) (soft). The fix text offers the one-liners from the owner's Evidence note: `id; hostname; cat /root/proof.txt; ip addr` and `whoami && hostname && type C:\Users\Administrator\Desktop\proof.txt && ipconfig`.
- **Access has a screenshot:** a foothold or privesc access grant with no screenshot near it (soft).
- **Captions:** over ten words (soft; course p.103). A screenshot narrower than would print legibly at page width (soft).
- **Findings:** a linked finding with no severity, a title that is just a tool name, or no affected location (soft).
- **Wording:** absolute claims in owner prose ("impossible", "not vulnerable", "fully secure") (soft; a fixed word list, no AI).
- **Modified exploit highlighted:** a modified file with no original and no marked lines.
- **Modified exploit explained:** each finding file marked *modified* has its original URL and an explanation.
- **Metasploit:** if Metasploit was used on more than one host according to the log (msf modules or Meterpreter in commands), a loud warning.

Report-level: details complete; OSID matches the file name pattern; at least one target.

Checks never block export outright; export shows the open gaps in its confirm step and requires an explicit "Export anyway" when any exist. The confirm step also lists every expected flag with a **Submitted in the control panel** tick (OffSec scores zero without it); unticked ones are a gap.

### 6.6 Deadline

"Due in" counts down 24 hours from the exam end: the engagement's timebox end for exam-sim engagements (`timebox_start` + `timebox_minutes`), or a value the owner sets in Report details. Lab engagements hide the cell.

### 6.7 Export

- One action produces `OSCP-<OSID>-Exam-Report.pdf` and the matching `.7z` (no password) in a folder the owner picks once (remembered), using a save dialog the first time.
- The PDF has selectable text, embedded fonts, real page breaks (no split code lines across pages where avoidable, figures kept with captions), page numbers, and a table of contents.
- After export, a result panel shows the file paths, sizes (warning over 200 MB), and the **MD5 of the .7z** to compare at upload.offsec.com, with Copy and Reveal in Finder.
- Export never includes private content, placeholder text or amber placeholder blocks.
- **How the PDF is produced is the builder's call**, with these constraints: no network; no new JS UI library; it must run in the Tauri app on macOS; the output must match the on-page house style closely. Candidates: rendering the report HTML in a hidden WKWebView and printing it to a file via the native print operation (paginated), or a Rust-side PDF writer. A new Rust crate for 7z (and PDF, if chosen) is acceptable; Tauri plugins for the save dialog and file writing are acceptable.

## 7. Constraints

- DESIGN.md is binding for all Ink UI: grid with explicit tracks, the six type roles (the page uses its own house-style type, like the Manual's reading roles), no text under 12px, one accent meaning one thing, no red, icon buttons with tooltips, HintLine rules, focus rules, motion rules.
- Real lab data lives in the encrypted DB: migrations only, backup first, no fixtures from real data. Extend `src/audit/fixtures.ts` with a synthetic exam engagement (3 standalone + AD set, flags, screenshots, a modified exploit, private entries) and add the Report view to `npm run audit:visual`.
- The vault stays local-only; export writes only where the owner chose.
- Verify in WebKit at ~1400px (the owner's real window), not only Chromium.

## 8. Calls made in the conversation (owner may correct)

- PDF style round before export work (4.3), rather than shipping a guessed style.
- Evidence referenced live, not copied (6.2).
- Draft built once per target, then the owner's page wins. "Add new evidence" only appends; nothing ever regenerates the page (5).
- Expected flags per machine: standalone local.txt + proof.txt, AD machines proof.txt, editable per machine (6.5).
- Labs: owner picks report hosts (default: hosts with a flag); clients get a placeholder this round (5.3).
- Finding files gain "modified" and "original URL"; unmodified exploits are cited by URL (5.2).
- Aligned with PEN-200 Module 5, the template and the owner's `05-Reporting` notes (2026-11-11 review): see 5.2, 5.4, 5.5, 5.6 and 6.5. Failed attempts are terse one-liners by default (course p.105), named "Tested, not exploited" to avoid absolute claims (p.108).
- (Owner's rule, not a call) Report like a real engagement: failed attempts, ruled-out items and findings' severity/impact/remediation all appear; only private content, including operator-reason attempts, stays out (5.4).
- Checks warn and gate export behind "Export anyway", never hard-block.
- The .7z and MD5 are produced by Raven, since OffSec requires both and the owner wants every clerical step removed.
- Lab engagements get the same view (practice before the exam), with the file name and deadline cells adapting.

## 9. Left to the builder

- Table and column names; how evidence nodes reference block indices.
- The screenshot-attachment window and long-output folding thresholds.
- Unused sort order default; pane-focus keys and Export key, avoiding collisions.
- PDF production technique within 6.7's constraints.
- Task order, as long as the style round precedes export styling and the data migration precedes UI that saves.
