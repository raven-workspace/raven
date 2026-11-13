# Raven Reports: design

Date: 2026-11-11. Branch: `feat/reports`. Status: approved brief, written design.

**Amended 2026-11-12 (rework round, §10).** After the owner tried Plan A, §10 replaces the parts it names: the outline becomes a tab row (§4.1), target pages become numbered steps (§5.1, §5.2), the AD set opens with an attack-path table (§5.5), appendices return as first-class pages (§5.6, §5.7), and the summary, scope and service tables are generated (§5.5). Where §10 and an earlier section disagree, §10 wins.

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
- *Appendices:* one page per target with content moved out of its section (5.6), lettered A, B… in report order. There are no generated appendices.
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
- Section structure: see 5.7 (the outline is binding). Since 2026-11-11 the authority is **OffSec's own sample report** (v2.0, the owner's copy, kept outside the repo): the report follows its section order, its numbering (1, 1.1, 4.1.3) and its heading wording ("Target #1 – 172.31.232.55", "Initial Access – <vulnerability>", "Vulnerability Explanation:", "Port Scan Results"), so a grader reads the layout they expect. PEN-200 Module 5 and the owner's Field Manual `05-Reporting` notes add what the sample leaves out (appendices for long content, testing considerations, what was tested). The third-party template in the owner's old template is no longer used. Raven keeps its own visual house style; only the structure and wording follow the sample.
- Headings are numbered at render time from the outline order, never stored: moving a target renumbers everything after it.
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

**Add new evidence** (per target) is the only re-run, for when the owner logged more after starting. It never removes or rewrites anything on the page: it takes entries that now qualify under 5.1 and aren't on the page or deliberately removed, and appends each to the end of its sub-section (Service Enumeration, Initial Access, Privilege Escalation or Post-Exploitation), each step with an empty prose slot before it.

**Draft layout.** A section's stored meta records the layout version its draft was built with. When the layout changes (2026-11-11: the move to OffSec's sample structure is layout 2), a section saved with an older or missing layout is rebuilt from scratch the first time it opens. The owner confirmed nothing written before layout 2 needed keeping, so there is no carry-over and no rendering of the old layout. Entries the owner removed to Unused are remembered and not re-added. It shows what it added and supports undo. There is no "throw the page away and regenerate" action.

### 5.1 What lands on the page

Per target, in time order, split into **Service Enumeration**, **Initial Access**, **Privilege Escalation** and **Post-Exploitation** sub-sections:
- Log entries linked to the host that **proved something**:
  - ticked a checklist goal (they appear as `evidence` on a checklist item);
  - confirmed a service (`services.confirmed_entry_id`);
  - granted access (`access_grants.log_entry_id`) or made a hop (`hops.log_entry_id`);
  - a flag entry;
  - steps of a finding linked to the host (`finding_steps`).
- A screenshot entry whose time falls between two kept entries, or within a few minutes after one (builder picks the window), comes along with it.
- **Left out of the step-by-step (in Unused):** entries with a failed attempt linked (`failed_attempts.log_entry_id`), "returned nothing" entries, notes, and anything not matched above. Failed attempts are still reported, as the "Tested, not exploited" list (5.4); Unused only decides whether their full command and output also appear as a step.
- **Never anywhere:** private entries.

**The split:** before the first access, port scans (nmap, rustscan, masscan and the like) go to Service Enumeration on a standalone target; the first entry that granted user-level access (or the first `local.txt` flag) closes Initial Access, with the local flag at its end; everything after it up to and including the root/SYSTEM/admin access goes to Privilege Escalation; the proof flag and every step after the admin access go to Post-Exploitation. If Raven can't tell, everything goes to Initial Access and the owner moves the divider (the sub-section heading is a block they can move like any other). Where the target was entered via a hop rather than its own foothold (AD set), the hop is the foothold.

### 5.2 What else is filled

- **Target heading:** "Target #N – <IP>" for a standalone machine, "<name> – <IP>" for a machine of the AD set, numbered from the outline (4.1, 5.2).
- **Port Scan Results:** a two-column table, IP Address and Ports Open, with one line per protocol ("TCP: 21, 80, 135", "UDP: 161"), from the host's services. A standalone target has one at the top of its Service Enumeration; the AD set has one for all its machines.
- **Each command block:** each `{command, output}` pair from the entry, with the prompt shown as the `ran_on` machine (`kali$` or the host's shell). The owner trims output by **keeping chosen line ranges**; Raven puts "… N lines omitted" between them (head-and-tail folding would hide the line that matters, often in the middle). The owner can also emphasise key lines. Long outputs start trimmed to a builder-chosen head with a prompt to pick the relevant lines; trimming is per placement and never changes the log entry.
- **Each screenshot:** the image and a caption from the entry's caption, numbered at render time.
- **Proof:** each flag entry with its value, the pasted proof text and its screenshot.
- **Exploits:** `finding_files` gain two fields (migration): **modified** (yes/no) and **original URL**, editable in the finding's Files section and on the page. A modified file attached to a finding linked to the host appears in the section as code, with its original URL and an "explain each change" prose slot (the check in 6.5 enforces it). An unmodified exploit appears as its URL only, as OffSec asks: from the file's original URL, or from the finding's `refs` (EDB IDs and URLs) when there's no file. OffSec requires the changes **highlighted**, so a modified file also takes the **original** (pasted or loaded as text; no network) and Raven renders a local line diff with changes marked. Where the owner has no original, they mark changed lines on the code block by hand. Code too long for the flow moves to an appendix by the rules in 5.6, leaving a reference in the target section.
- **Empty prose slots before each step**, as in the sample: the owner writes what they are about to do and why, then the evidence follows. Only steps get a slot; the evidence of one step (a command entry's blocks and the screenshots that came along with it) shares one slot. The placeholder text ("What you do next, and why") never exports.
- **Flags:** a flag block prints "Local.txt value:" or "Proof.txt value:" with the value, then the proof text and its screenshot. The local flag closes Initial Access; the proof flag opens Post-Exploitation.

### 5.3 Which targets

- **Exam-sim engagements:** every standalone host is a target; hosts with `ad_set` form the one AD set target, as the existing progress counts do.
- **Lab engagements:** the owner picks which hosts are in the report (a checkbox per host in the outline's target list; default: hosts with at least one flag). Each is a standalone target. If any hosts have `ad_set`, they group as an AD set target the same way.
- **Client engagements:** the Report section shows a one-line EmptyState ("Client reports come after the exam") this round.

### 5.4 Written as a real engagement report

The owner's rule (2026-11-11): treat the exam report as a real pentest report. What didn't work is reported too, because it gives the client coverage assurance and shows a complete testing methodology. The only things left out are private ones; a failed attempt whose reason is **operator** (the owner's own inexperience) is private by design and never appears.

So each target section also carries, generated from live data and editable around:
- **Vulnerabilities:** for each finding linked to the host, the sample's labelled lines: **Vulnerability Explanation:** (the description), **Vulnerability Fix:** (the remediation, as a list of distinct steps), **Severity:** (with the CVSS vector where set), then **Steps to reproduce the attack:** with an empty prose slot for a short summary. It sits at the top of the sub-section it enabled (Initial Access or Privilege Escalation, by the finding's steps, or the owner moves it), before the walkthrough, and its title names that sub-section: "Initial Access – <finding title>". With no finding the heading is the phase name alone. Lessons stay private; references are listed in the References section.
- **Also tested** (the slim form of "Tested, not exploited"): one line per item, "<what> on <port>: <reason words>" (the port only when the item names one), with no commands and no steps: a client wants to know it was tested, not how to repeat a non-issue. The items are the target's non-private failed attempts (reason kind as plain words: "blocked by a control", "precondition not met", "no access", then the reason text) and non-private ruled-out items. It closes the target, after Post-Exploitation and Additional findings (task 17), and is left out when there is nothing to list. A failed attempt's log entry can still be inserted as full evidence from Unused where showing the command helps.
- There is no per-service coverage table on the page: the Port Scan Results table says what was open, the steps say what was exploited, Also tested says what was tried. Coverage is still derived (findings, attempts, ruled-out items, service verdicts) for the "untested service" check.

Engagement-level failed attempts and ruled-out items with no host go in a report-level **Also tested** section after the targets, in the same slim form.

New checks (6.5), soft: a service with no result ("not tested") and a finding with an empty description or remediation.

### 5.5 Report-level sections

- **Report details:** candidate name, email, OSID; report title; exam date and report date. Name and email default from Settings (a new "Report details" group; OSID too), and are editable per report.
- **1 OffSec Certified Professional Exam Report:** 1.1 Introduction, 1.2 Objective and 1.3 Requirements, filled from one Settings default (empty until the owner pastes their wording once; a line reading Introduction, Objective or Requirements starts that part, and text before any such line is the introduction). A part with no text is an empty slot. Raven writes none of it.
- **2 High-Level Summary:** the four prose slots in the course's order, as labelled empty placeholders only: what the engagement was; hardening observed (things done well); vulnerabilities and trends; wrap-up. The rail surfaces "blocked by a control" attempts for the "done well" slot. Then **2.1 Recommendations**, an empty prose slot. There is no generated table here: the scope is in 3.1 and each exploited system is told in its own target section.
- **Testing considerations:** one prose slot for anything that affected testing (course §5.2.4), placeholder naming positive, neutral and negative outcomes (e.g. VPN drops, machine reverts, time). It is kept because the course asks for it, but it is exported only when the owner wrote something.
- **3 Methodologies:** the Settings methodology text (written once) as the opening paragraphs, then 3.1 Information Gathering, 3.2 Service Enumeration, 3.3 Penetration, 3.4 Maintaining Access and 3.5 House Cleaning, each an empty prose slot, plus three generated facts: under 3.1 the scope line ("Exam network: <IPs>"), under 3.3 one line naming the Metasploit target (or "Metasploit was not used"), under 3.5 the cleanup list (item, host, removed or open).
- **5 Active Directory Set:** one Port Scan Results table for all its machines; then per machine "5.N <name> – <IP>" with its phases named by how it was entered: **Initial Access – <technique>** (the first machine), **Lateral Movement** (entered by a hop) or **Domain Compromise** (the DC), then Privilege Escalation if any, then **Post-Exploitation** (its flags and what was found after admin: dumped credentials, the next pivot). A machine of the set has no Service Enumeration of its own; its scan steps fall in its first phase. The **attack chain**, generated from `hops` and `access_grants` (from → to, via what credential or technique), closes the set as a short ordered list.
- There are no generated appendices. Flags sit inline with their proof, Metasploit and house cleaning are told in Methodologies, and the tools used show in the commands themselves.

### 5.6 Appendices for content too long to sit inline (binding)

PEN-200 Module 5 (§5.2.6–5.2.7, pp.110–113): the appendices hold material the report needs but that would interrupt the reading if placed inline: long lists of compromised users or affected areas, large proof-of-concept code, expanded methodology or technical write-ups, and an extended attack narrative. Evidence that is simple goes inline; otherwise it goes in an appendix, and the body **summarises and references it** ("as detailed in Appendix C.2"). The exam guide adds that scripts and PoCs must be in the PDF as text, so moving something out never means leaving it out.

Appendices exist only for this: content too big to sit inline. They are lettered A, B, C… in report order, one letter per target with moved content.

- **Move to appendix** is available on any evidence or generated block: command output, exploit code, an HTTP request/response, a long list (credentials dumped, users, shares, affected hosts or URLs), an extended narrative the owner writes. The block leaves a one-line reference in its place ("Full output: Appendix C.2, *title*"), and the owner writes the inline summary around it.
- **Trimmed inline, full in the appendix:** for output the owner trimmed (5.2), one option keeps the trimmed lines inline and puts the complete output in the appendix, with the reference between them.
- **Appendix entries** are titled (from the entry's title, editable), numbered, belong to their target, and show which section references them. References are live: renumbering after a move or reorder updates every reference, in the editor and the PDF. A reference to a removed appendix entry is a gap.
- **Suggested moves (soft checks):** Raven flags blocks that would break the flow: code or output longer than about one printed page (builder sets the line threshold), lists over about 15 rows, and any table wider than the page. The check's fix is the Move action. It never moves anything by itself.
- **Methodology** expansions (e.g. full tool command lines used for enumeration) and the extended AD narrative may also live in appendices, referenced from Methodology or the attack chain.
- Moved-out content keeps all checks: a modified exploit in an appendix still needs its highlighted changes and explanation; output in an appendix still counts as "the command has its output".

### 5.7 Report outline (binding)

The outline follows OffSec's sample report. Numbers are computed from the outline order.

1. Cover, then table of contents.
2. **1 OffSec Certified Professional Exam Report:** 1.1 Introduction, 1.2 Objective, 1.3 Requirements.
3. **2 High-Level Summary:** the summary prose slots; 2.1 Recommendations.
4. Testing considerations (exported only when written).
5. **3 Methodologies:** 3.1 Information Gathering (scope line), 3.2 Service Enumeration, 3.3 Penetration (Metasploit line), 3.4 Maintaining Access, 3.5 House Cleaning (cleanup list).
6. **4 Independent Challenges**, the standalone targets in grading order. Each is **4.N Target #N – <IP>** with:
   - 4.N.1 Service Enumeration: Port Scan Results, then the scan steps;
   - 4.N.2 Initial Access – <vulnerability>: the vulnerability's labelled lines, Steps to reproduce the attack, the walkthrough (a prose slot before each step), then Local.txt value: with its proof;
   - 4.N.3 Privilege Escalation – <vulnerability>: the same. One finding per heading: a second finding that enabled the same phase gets its own numbered heading "<Phase> – <title>" with its own steps;
   - 4.N.4 Post-Exploitation: Proof.txt value: with its proof (the flag's companions: a command printing it, a screenshot taken with it), then any steps after admin access;
   - Additional findings: findings that enabled no phase (info/low observations, unlinked ones), each under its own title, info last (task 17);
   - Also tested (slim, unnumbered, left out when empty), closing the target.
   A sub-section with nothing in it is left out, and the numbers close up.
7. **5 Active Directory Set:** Port Scan Results for all its machines; 5.N <name> – <IP> per machine (Initial Access or Lateral Movement or Domain Compromise, Privilege Escalation, Post-Exploitation); the attack chain.
8. Also tested at engagement level, if any.
9. Appendices, only for moved-out content (5.6), lettered A, B, C… by target in report order, with numbered entries (A.1, A.2).
10. Further information (optional; omitted when empty).
11. References (cited, authoritative sources; built from findings' `refs` and links the owner adds; omitted when empty).

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

Owner addition (2026-11-11): every block has a **drag handle** (ProseKit block handle + drop indicator) so blocks, especially screenshots placed by timestamp, can be dragged to the right spot; and a **formatting toolbar** (bold, italic, inline code, link, lists, code block, undo/redo) pinned to the top of the page pane.

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
- Aligned with PEN-200 Module 5, the template and the owner's `05-Reporting` notes (2026-11-11 review): see 5.2, 5.4, 5.5, 5.7 and 6.5. Failed attempts are terse one-liners by default (course p.105), named "Tested, not exploited" to avoid absolute claims (p.108).
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

## 10. Rework round (2026-11-12): binding, overrides earlier sections

**Why.** The owner tried Plan A on real data. They found two problems: (1) target pages were a log dump, every proving entry at full height under its own "What you did and why" placeholder (ms01 was about 8,700 px); (2) the Task 15 ruling that removed appendices overrode their explicit call. They chose **option A · Steps** from `.impeccable/mocks/decision/report-target-rethink.html`. They also added a model report, `docs/Mock exam A — model report.md` (their Mock exam A lab written up from their vault notes), which they rate above OffSec's sample. Its shape is now the reference for target pages and the summary, alongside OffSec's section order and numbering, which still hold.

### 10.1 View layout (replaces the left outline of §4.1)

- **Tab row** under the status strip, as in mock A: `Front matter`, each target in grading order (`1 lnx02`, `2 ms01`, …, `4 AD set`), then each appendix (`Appendix A · ms01 · 2 items`, `Appendix B · <title>`), then **+ Page**. Each tab shows its state in small text (`ready`, `N to do` in amber, `not started`). **Export PDF** sits at the row's right. The row scrolls horizontally when it overflows; the selected tab stays in view.
- Targets reorder with ⌥←/⌥→ on the focused tab (grading order). Tabs are a roving-tabindex tablist (←/→ move, ↵ opens). Pane-focus keys stay as built.
- **Front matter** is one tab. A segmented row at the top of its page switches between its parts: Details, 1 Introduction (Introduction, Objective, Requirements, Scope), 2 Summary, Testing considerations, 3 Methodology. Each part keeps its own stored section and editor; one editor is mounted at a time, so the formatting toolbar stays one. The tab's state is the worst of its parts. Closing sections (Further information, References) and the engagement-level Also tested get one **Closing** tab after the targets, using the same segmented row.
- **Checks** (§6.5) move out of the outline. A tab's `N to do` and the strip's `TO DO` cell open a **To do** panel at the top of the page pane listing that tab's checks; clicking one scrolls to its place and focuses it, as before. Esc closes it. Under ~1000px of pane width the tab row stays (it scrolls); the picker and Checks disclosure of §4.4 go away.
- The **rail** (right) is the target's log that is not in the report: `<host> log · not in the report`, grouped by phase (Service enumeration, Initial access, Privilege escalation, Post-exploitation), time order inside each group. Each row: time, the command or title, one line of what it showed, and **+ add**. A row whose output is longer than the appendix threshold offers **+ to appendix** instead (it adds the step and moves the output to the appendix in one action). A failed attempt's row says it is already in Also tested. A scan whose ports are in the port table says so ("in the port table already"). Notes and Creds stay as rail tabs.
- **+ add** puts the entry into the **current step**, the step that holds the cursor. With no cursor in a step, it becomes a new step at the end of its phase (`endOfPhase`). ⌘↵ on a focused row does the same.

### 10.2 Target page: numbered steps (replaces the step layout of §5.1 and §5.2)

- **Short draft.** Only these entries are placed: access grants, hops, flags (with their companions) and finding steps. Checklist-goal evidence and service-confirming entries no longer place an entry on the page; they stay in the rail. Port scans are not steps: the port table covers them. Screenshots still come along with a placed entry (§5.1 window).
- **Steps.** Each finding's walkthrough is a numbered **Steps to reproduce** list (a `steps` node of `step` nodes; numbers computed at render, restarting per list). A step is the owner's sentence (one paragraph slot, hint "Say what this step does") followed by its evidence. One step per placed entry, screenshots joining the entry before them. A flag is a step ("Read local.txt"), the last step of its phase, with its companions. The old reproduce-summary slot is dropped. **+ Step** under each list adds an empty step.
- **Evidence chips.** In the editor, evidence in a step shows collapsed as a chip: a command chip shows `$ <command>` and `N of M lines`; a screenshot chip shows a thumbnail and its caption (with figure number); an exploit chip shows the file name and `modified · N lines changed` or `unmodified · <URL>`; a moved block shows `→ Appendix A.1`. ↵ or a click opens the chip in place to the full block exactly as it prints, with **Trim**, **Highlight**, **Edit text** and **Move to appendix** in its bar, plus "N lines cut. The PDF prints exactly what's shown here." Esc or the bar's close collapses it. Collapse is editor view state only (not stored); a toolbar toggle opens or closes all. The PDF always prints every block in full (trimmed lines, captions, figures).
- **Port table** (replaces the two-column Port Scan Results of §5.2): under Service Enumeration on every machine, standalone and AD alike. Columns: Port (`445/tcp`), Service, Version, Notes. Rows are the host's open services in port order. Version is the confirmed product and version, else nmap's. **Notes** is the owner's, typed into the cell on the page and stored on the node (`notes` keyed by service id), empty by default. The old set-wide table of the AD set is dropped.
- **Result line** right under each machine's heading: "**Result:** <access>. <flags>." Access comes from the host's access grants in time order ("shell as `ronan`, then root"; hop-entered: "WinRM as `sam.rivera`"). Flags print as "local.txt `<value>`, proof.txt `<value>`", and a missing expected flag prints nothing. It is live; **Edit text** detaches it into an owner paragraph prefixed "Result:" (the existing detach pattern).
- Vulnerability lines (§5.4) stay as built (Explanation, Fix, Severity), above the steps.

### 10.3 Report-level tables (replaces the scope line of §5.5 and "no generated table here")

- **1.4 Scope:** a generated table: Host, IP address, OS, Set (`Independent` / `AD`). One row per report target machine in grading order. The 3.1 scope line is removed.
- **High-Level Summary findings table:** after the summary's prose slots, before 2.1 Recommendations. Columns: #, Host, Finding, Severity, Result. Rows: every finding on a report target, most severe first (the existing severity order), then by host grading order. **Result** is what the finding gave, from the phase the draft engine assigns it: entry phase → `Initial access` (`Foothold` when the machine was entered by a hop); privilege escalation → the grant level reached (`Root`, `SYSTEM`, `Administrator`); domain compromise → `Domain Admin`; Additional findings → `None`. Live, never stored.
- **AD attack-path table** opens the AD set, before its first machine (it replaces the closing attack-chain list). Columns: Step, From, Technique, To, Access gained. One row per hop and per access grant on the set's machines, in time order. From is `Kali` when the hop has no source host. Technique is the hop's or grant's `via`. Access gained is the grant's identity and level.

### 10.4 Appendices and free pages (replaces §5.6's "one letter per target" and §5.5's "no generated appendices")

- **Move to appendix** is visible: in an open chip's bar, and in every block's ⋯ menu (the block handle). It works as §5.6 describes (moved / split, live references).
- **Appendix tabs:** a target's moved content is its appendix (as built). Each appears as a tab, lettered in report order.
- **+ Page** offers **Appendix page** or **Free page**. Both are owner-written pages with an editable title. An appendix page is lettered with the other appendices (after the targets' appendices, in creation order, reorderable with ⌥←/⌥→). A free page sits after the targets and before the appendices, numbered as a body section. Stored as `report_sections` kind `page`, with `target_key` = a fresh id (keeps the unique index), and meta `{ title, placement: "appendix" | "body" }`. No migration, since `kind` is free text in the table; the Rust side adds `page` to its kind list (a key is required) and gains a section delete command. Delete is in the tab's ⋯ menu, with confirm and undo for the session.
- Auto appendices (proof table, tools list) do **not** return (owner, 2026-11-12).

### 10.5 Guide notes

Each section and sub-section shows a short **guide note** above it in the editor (never in the PDF), in the spirit of the mock report's "From your notes" callouts. It says what the part is for, what goes in it, where Raven filled it from, and a tip (neutral third-person voice; keep only the ports that mattered; list every exploit change). Guide notes are fixed text written into Raven. They never suggest wording for the owner's prose and are never generated (§3 anti-goal). Each has a dismiss button (hides that note, in every report) and a "Hide all guide notes" action; a Settings toggle brings them back. Stored in Settings (`reportGuidesHidden`: list of note ids, `"*"` = all).

### 10.6 New checks (adds to §6.5)

- **Step not replayable** (soft): a step with owner text but no evidence block. "Step N of <heading> has no command or output under it, so a reader can't replay it. Add it from the log column." A step holding only a screenshot passes.
- **Credential that moved you** (soft): a non-private credential found on one machine (`sourceHostId`) that gave access to another (an access grant for its username on a different host, or a hop logged with it), where no finding on either machine names the credential's username or has the grant's or hop's entry as a step. "<user>'s credential from <source> got you onto <host>, but no finding covers it. A credential that lets you move is a finding too."

### 10.7 Draft layout

`DRAFT_LAYOUT` becomes 4. Stored pages rebuild on next open, with the existing "Restore your previous page" path kept.

### 10.8 Owner feedback after the rework (2026-11-12, evening): binding, overrides §6.2

The owner tried the rework on real data. Their findings:
1. The "Nothing new to add" notice opened under the sidebar.
2. A finding's pasted git diff rendered as markdown garbage (diff `-`/`+` lines became bullets, `*` became italics), and the block couldn't be edited to fix it.
3. Blocks sat back to back with no space. Additional findings read as one wall, and only a selection outline showed where a block ended.

**Every placed block is the page's own copy (replaces §6.2 "evidence is referenced, not copied").** When a block is placed, its content is copied onto the page and is freely editable there. The log entry and the finding never change. Each block keeps its source (entry, finding, file or generated kind) and has **Refresh from log** (or "from finding" / "from Raven") in its menu. Refresh replaces the block with the source's current content, can be undone, and asks for confirmation when the block was edited. Later log edits don't reach the report unless refreshed. Blocks covered:
- **Finding blocks:** Explanation, Fix and Severity, as editable labelled paragraphs. Pasted terminal text (diff, commit, code lines) becomes a code block instead of markdown lists or italics.
- **Generated tables** (ports, scope, findings, attack path, Also tested, cleanup, references): real editable tables.
- **The Result line:** an editable paragraph.
- **Command output, HTTP, exploit code and flag proof:** editable text when the chip is open. Trim and highlight still work on the copy.
- **Screenshots:** the image stays a reference; the caption is already editable.

Checks read what the page prints (the copy). Gone or private sources still mark the block (§4.5).

**Existing pages upgrade in place** (layout 5): layout-4 pages are converted block by block into copies, keeping everything the owner wrote. They are not rebuilt.

**Rhythm:** consecutive blocks have visible space between them. Every finding under Additional findings is a numbered sub-heading (4.N.5.1 …) with space before it. Steps have space between them. A chip shows "N lines" when nothing is cut, and "K of N lines" only when lines are cut. Empty labelled fields show their hint only in the editor, never as "Not written yet." on the page.

**Notices** (TimedNotice) render above everything, in the bottom-left of the content area, clear of the sidebar in both its expanded and collapsed states.

## 11. Plain pages (2026-11-13): binding. Supersedes §10's page machinery and §10.8's container copies

**Why.** The owner rejected the page as an "assembly tool": chips, slots, guide cards, evidence atoms, finding and table containers. They approved the plain draft of garnet on `/__compare/garnet` ("SOOOO MUCH BETTER"). Hard requirement: **every block on the page is editable as ordinary content** (text, code blocks, tables, figure captions; screenshots deletable and movable), and the log, findings and files never change. Plan: `docs/superpowers/plans/2026-11-13-raven-reports-plain-rollout.md`.

### 11.1 Every page is a plain document

- **Targets and the AD set** are written by `buildPlainTarget`, shaped like a real OSCP report. A machine heading reads "<name> (<IP>)". Then come the Result line, Service enumeration (ports table, the trimmed scan), one heading per finding that enabled a phase with its labelled lines (Vulnerability explanation, fix, severity, affected, exploit code), numbered steps (a sentence, the command, its trimmed output, the screenshots), the flags closing their phase, Additional findings as bullets, and Also tested. The AD set opens with its attack-path table (§10.3).
- **Front matter and closing pages** are plain. An empty prose part is an empty paragraph whose `hint` shows as placeholder text and vanishes when typed in. Generated tables (scope, findings, clean-up, Also tested, references) are ordinary tables. When a table has no rows yet, it is an empty hint paragraph instead (nothing prints). The Metasploit line is a plain paragraph.
- **Owner pages** (+ Page) are unchanged and use the same schema.
- The only node types are `PAGE_NODE_TYPES`: doc, heading, paragraph, text, hardBreak, list, codeBlock, table, tableRow, tableHeaderCell, tableCell, blockquote, horizontalRule, figure (a screenshot plus its editable caption).
- Each generated block carries hidden attrs that never print: `source` (where it came from: `entry:<id>:<part>`, `finding:<id>:<part>`, `file:<id>`, `ports:<hostId>`, `result:<hostId>`, `tested:<hostId>`, `attack-path`, `table:<kind>`, `msf`, `facts:<hostId>`, `phase:<hostId>:<phase>`) and `gen` (a hash of its text when generated).
- Numbering is computed, never stored: a machine heading is numbered from the section order (4.N; 5.N in the AD set), so reordering targets renumbers. Sub-headings are unnumbered, as in the approved draft. The page prints no figure numbers.

### 11.2 Beside the page, not on it

The To do panel (checks), the log column, Export, and the **guide notes** (dismissable, top of the right-hand column; `Settings.reportGuidesHidden` still honoured).

### 11.3 Adding and refreshing

- **+ add** in the log column inserts the same plain blocks the draft would (sentence, command, trimmed output, figures). It inserts at the cursor, inside the step the cursor is in. With no cursor, it adds a new numbered step at the end of the entry's phase section, adding the phase heading and "Steps to reproduce:" if missing. **Add new evidence** does the same for every entry the draft would place that is not on the page and was not removed.
- **Refresh from log** (or "from finding", "from Raven") is in the block menu of every block with a live source. It regenerates that block's run of same-source siblings from the current data and nothing else. If the block was edited (its text no longer matches `gen`, or it has no `gen`), Raven asks first, and ⌘Z undoes. A block whose source is private or deleted offers no Refresh, and its check says why.

### 11.4 Layout 6 and old pages

`DRAFT_LAYOUT` is 6. A page stored under an older layout is rebuilt as the plain draft. Before the rebuild, the save queue is flushed so no older write lands after it. The old page is kept byte for byte in `meta.previousDoc`. **Restore your previous page** converts it with `flattenToPlain`: containers are unwrapped, slot text becomes paragraphs, evidence becomes code blocks and figures, generated blocks become their tables or text, and unknown atoms are dropped. Its owner text is kept. A page already at layout 6 is never rebuilt. A page (an owner page included) that still holds old nodes is flattened when it opens, and the original is kept in `previousDoc`.

### 11.5 Appendices are manual

Appendix pages (+ Page → Appendix page) stay. Moving blocks into automatic per-target appendices is gone: no Move to appendix, no "+ to appendix", no lettered target appendices. A code block over 60 lines gets a soft check suggesting the owner move it to an appendix page by hand.

### 11.6 Checks read the plain page

Each check keeps its intent and reads `source` attrs and headings. The reading rules are listed in the plan's Task 4. A step is a numbered list item, and its replay check still names "Step N of <heading>". The caption-step check is dropped (a figure prints only its own caption), and so is appendix-ref (there are no moved blocks).

### 11.7 Rhythm and notices

Consecutive blocks are 12px apart on the page and inside a numbered step. Notices portal above everything, 16px right of the sidebar whether it is expanded or collapsed (§10.8).
