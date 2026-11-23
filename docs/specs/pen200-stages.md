# Raven: PEN-200 restructure (phase 2, project 1)

**Date:** 2026-11-05
**Amends:** `2026-11-03-raven-desktop-design.md`, §5.2 (Board) and §6.4 (Checklist, the host stage order). Everything else in that spec stands.
**Source of method:** the user's Field-Manual Obsidian vault at `~/Documents/Field Manual`.
- `01-Playbook/00 - Off-the-Bat.md` through `06 - Lateral Movement.md` are the method.
- `00-Home/Conventions.md` is the vault's contract with Raven.

## 1. Intent

Raven's methodology changes from its own stages (enumerate → foothold → stabilize → orient → privesc → loot → pivot → closeout) to the **PEN-200 methodology, as the user's Field Manual playbooks lay it out**. There are two reasons:

1. **Reports.** The OSCP report, and later client reports, must describe the methodology in PEN-200 terms. "Loot" can't go in a report. Raven should record work under the names the report uses, from the start.
2. **Timing.** Raven is being rebuilt and hasn't carried an exam sim yet. There's no muscle memory to protect, so this is the cheapest moment to change.

The vault owns the **method**: what to do, in what order, and why. Raven owns the **behaviour**: auto-ticks, filled commands, the domain admin cover, the stuck view and board movement. Raven's checklist mirrors the playbooks in wording and order, so working in Raven and following the vault in Obsidian are the same process.

This is project 1 of three in phase 2. The others:
- **Project 2, Arsenal and Field Manual import:** card import, placeholder auto-fill, Raven's commands in the Arsenal with source tags, steps linked to cards, and a drift check.
- **Project 3, client engagements, after the exam:** test type, scope allowlist, third parties, passive recon and the dossier.

Project 1 must leave a usable app and must not depend on either.

## 2. Goals, non-goals, anti-goals

**Goals**
- **Board:** six host columns in the vault's playbook order:
  1. Information gathering
  2. Vulnerability detection
  3. Initial foothold
  4. Privilege escalation
  5. Post-exploitation
  6. Reporting
- **Host checklist:** regrouped into those six stages, with steps reworded and reordered to mirror playbooks 01–05.
- **Missing steps:** steps the vault has and Raven doesn't are added.
- **Lateral movement:** moves off the host and onto the Engagement checklist (vault 06), next to hops and tunnels.
- **Engagement setup:** the setup goals mirror vault 00, Off-the-Bat.
- **Existing data:** engagements, hosts and checklist progress carry over through a migration, with a backup first.
- **Dependent features:** the domain admin cover, stuck view, "Now" panel, board movement, old-Raven import and capture use the new stages.

**Non-goals (this project)**
- The live vault import: reading cards from the vault, the Arsenal view, the drift check and placeholder changes. These are project 2. This project copies the needed card commands into Raven by hand (§4) so nothing waits on the import.
- Passive information gathering, test type and the dossier. These are project 3, after the exam.
- The report itself (phase 3). This project only makes the names right for it.

**Anti-goals**
- **Losing commands.** Every command Raven has today must still be reachable from the step it serves. None are removed. A step that's only renamed or moved keeps its commands.
- **Losing progress.** A step that survives under a new name keeps its status, notes and evidence.
- **A board that moves too early.** A host must never jump to Initial foothold just because every detection step is ticked.

## 3. Board (replaces §5.2's column list)

**Columns:** the column ids are the vault's stage values, plus `reporting`:

| Column | id |
|---|---|
| Information gathering | `information-gathering` |
| Vulnerability detection | `vulnerability-detection` |
| Initial foothold | `initial-foothold` |
| Privilege escalation | `privilege-escalation` |
| Post-exploitation | `post-exploitation` |
| Reporting | `reporting` |

There is **no Lateral movement column**. In the user's words: "the host doesn't move, I do". Lateral movement is engagement-level (§5).

**Automatic movement.** A host sits in the latest column whose rule it meets. The rules are checked from the bottom up, as in today's `derivedColumn`.

| Column | Rule | From |
|---|---|---|
| Reporting | proof captured, and every applicable Post-exploitation and Reporting step closed (done or N/A). The pivot steps shown at engagement level (§5) don't count. | Raven's closeout today |
| Post-exploitation | the proof.txt step is done | vault 04 exit |
| Privilege escalation | any of `h-foot-shell`, `h-foot-creds`, `h-stab-shell`, `h-foot-arrived` or `h-orient-proof` is done (today's `FOOTHOLD_GOALS` plus stabilise) | vault 03 exit |
| Initial foothold | **any Initial foothold step is done (ticked or auto-ticked from the log)**, including the "Before firing" prep steps, or the host's existing `access` field is above `none` | user's decision |
| Vulnerability detection | every applicable Information gathering step is closed, with at least one | vault 02 entry |
| Information gathering | otherwise | — |

Rules are checked from the bottom up, so Privilege escalation wins over Initial foothold when both hold.

The Initial foothold rule is the user's explicit choice. Prep steps count too: ticking "Listener running" or "exploit read end to end" means you've committed to a candidate, which is exactly vault 02's exit (my call). Closing every Vulnerability detection step does **not** move a host on, because "I still don't have a way in" is a real state. Only a foothold action does.

**Hand placement.** It works as today: a dragged card stays put until the derived column changes.

## 4. Host checklist (replaces §6.4's stage order)

**Stages, in order:**

| Stage | Raven stage id | Mirrors |
|---|---|---|
| Information gathering | `information-gathering` | vault 01 |
| Vulnerability detection | `vulnerability-detection` | vault 02 |
| Initial foothold | `initial-foothold` | vault 03 |
| Privilege escalation | `privilege-escalation` | vault 04 |
| Post-exploitation | `post-exploitation` | vault 05 |
| Reporting | `reporting` | Raven's closeout today |

**Inside a stage:**
- Steps keep the vault's sub-headings as groups. For example, Initial foothold has "Before firing", "Get the shell" and "Right after landing"; Privilege escalation has "Linux" and "Windows".
- Applicability works as now: OS, service, domain-joined, dual-homed and engagement kind.

**Wording and order.** Each step's title follows its vault item, without the `→ [[link]]` tail. Its "why" stays Raven's where the vault has none.

**Ids.**
- A surviving step **keeps its goal id**, even when its title changes or it moves stage. For example, `h-orient-proof` moves to Initial foothold with the same id. That keeps progress and library links intact without data migration.
- New steps get new ids in the same `h-` scheme.

**Commands: every step that has something to run ships with copy-ready commands in this project.** This is the user's requirement: project 1 must be usable on its own.
- **Existing steps** keep the library commands linked to them today, unchanged.
- **New steps whose vault item links a card** (`→ [[Card]]`) get that card's commands, copied into Raven's built-in library. Every linked card exists in the vault and has command blocks; for example, Listeners, Kerberos-Enumeration, Linux-PrivEsc-Enumeration and BloodHound-Collection-and-Analysis.
  - Copied entries use Raven's fill tokens, so `{TARGET_IP}`, `{LHOST}` and so on fill as today.
  - Each copied entry records its card id (`cardId`) and `source: 'field-manual'`, so project 2's import merges it with the card rather than duplicating it.
  - Each copied entry gets an auto-tick matcher where the command is distinctive enough, following the existing library conventions.
- **New steps with no card link but something obvious to run** get Raven-authored commands (`source: 'raven'`). For example:
  - "ARP cache, hosts file, established connections": `ip neigh`, `cat /etc/hosts`, `ss -tnp` on Linux; `arp -a`, `type C:\Windows\System32\drivers\etc\hosts`, `netstat -ano` on Windows.
  - "Kerberos keytabs and ccache files": `find / -name '*.keytab' -o -name 'krb5cc_*' 2>/dev/null`, `klist`.
  - "Re-dump LSASS": the existing LSASS dump commands.
  - "Web search for exploits": a filled search string `{PRODUCT} {VERSION} exploit`.
  - "Check the exploit's version gate": `searchsploit -x {EDB_ID}` to read it.
- **Only pure judgement steps stay command-free:** "Pick a port the target can reach out on" and "Order the candidates". The builder lists any others it finds in the plan, each with a reason.
- The same rule applies to the new engagement setup steps (§5, vault 00) and the Lateral movement goals (§5, vault 06).

### 4.1 Draft mapping (the user should check this)

This mapping is a draft; the builder finalises it against the vault text. Steps marked **new** come from the vault. Steps marked **Raven-only** have no vault item and stay. The project 2 drift check will list them, and the user decides whether the vault gains them.

**Information gathering (vault 01)**
- **Kept:**
  - `h-enum-full-tcp`
  - `h-enum-udp`
  - `h-enum-versions`, worded as "-sV -sC on the open ports"
- **New:**
  - "Every port has a confirmed product and version". Auto-ticks when every open service has a confirmed or nmap version with no `?` and no `tcpwrapped`.
  - "OS identified". Auto-ticks when the host's OS is set.
- **Per-service steps:**
  - **Kept:** `h-enum-web-stack`, `h-enum-web-content`, `h-enum-web-vhosts`, `h-enum-smb`, `h-enum-ftp`, `h-enum-nfs`, `h-enum-rpc`, `h-enum-ldap`, `h-enum-dns`, `h-enum-snmp`, `h-enum-smtp`, `h-enum-db`, `h-enum-remote`.
  - **New**, each shown only when its port is open: SSH, Kerberos (88), POP3/IMAP, TFTP, rsync, Docker API, Elasticsearch, MongoDB, Redis, and Tomcat/Jenkins.
  - **Database split:** a database the vault lists separately (MSSQL, MySQL, PostgreSQL) stays inside `h-enum-db` unless the builder finds the split worth its own steps. That's the builder's call.
  - **Raven-only:** `h-enum-web-source`.
- **"If there's a domain":** domain, DC and `/etc/hosts` recorded; usernames into users.txt; AS-REP roastable users. **New**, domain-joined only. Where the engagement AD playbook "No credentials" already has the same step, the host step doesn't duplicate it; it is left out.
- **"Collect as you go":** stays in the engagement credentials flow and is not repeated as host steps.

**Vulnerability detection (vault 02)**
- **Kept (moved from Information gathering):** `h-enum-exploits`, worded as "searchsploit every product and version".
- **New:**
  - "Web search for exploits and PoCs";
  - "Check the exploit's version gate against the real version";
  - "Targeted NSE vuln scripts".
- **Moved from Foothold:**
  - `h-foot-web-auth`, default credentials;
  - `h-foot-web-vulns`, testing the web app. It stays one step, because the vault's injection/LFI/upload sub-items are card links that project 2 attaches as commands.
  - `h-foot-brute`, login brute force, last resort.
- **Credentials as a vulnerability:** `h-foot-creds` stays in Initial foothold, because using a credential to log in is a foothold action. **New:** "Spray usernames and passwords across every login surface" and "Crack hashes".
- **Rank. New:**
  - "Order the candidates";
  - "Exam: decide on Metasploit", shown in exam sims only.

**Initial foothold (vault 03)**
- **Before firing:**
  - **New:** "Listener running";
  - **Kept:** `h-foot-payload`;
  - **New:** "Pick a port the target can reach out on";
  - **Kept:** `h-foot-exploit`, worded as "Public exploit read end to end, IPs, ports and paths changed".
- **Get the shell:**
  - **Kept:** `h-foot-shell` (RCE to a reverse shell), `h-foot-service` (misconfiguration to code execution), `h-foot-creds` (log in directly);
  - **New:** "Web shell only: upgrade to a reverse shell";
  - **New:** "Client-side delivery".
- **Right after landing:**
  - `h-stab-shell` (stabilise);
  - `h-orient-identity`, worded as "whoami, hostname, IP";
  - `h-orient-proof` (local.txt);
  - `h-foot-arrived` ("log how you got in").

**Privilege escalation (vault 04)**
- **Linux:**
  - **New:** "Manual enumeration first";
  - **Kept:** `h-pe-lin-sudo`, `-suid`, `-caps`, `-cron`, `-writable`, `-internal`, `-auto`, `-kernel`, in the vault's order;
  - **New:** "Passwords in history, configs, backups, databases"; "Dangerous groups (docker, lxd, disk)"; "NFS no_root_squash".
- **Windows:**
  - **New:** "Manual enumeration first";
  - **Kept:** `h-pe-win-privs`, `-groups` (worded as UAC/filtered admin), `-stored`, `-services`, `-tasks`, `-registry`, `-auto`, `-kernel`;
  - **New:** "Saved credentials (cmdkey)" if the builder doesn't fold it into `-stored`; "Non-default installed software and version".
- **The automated sweeps stay, with every command they have today:** `h-pe-lin-auto` (linPEAS, linPEAS from memory, lse) and `h-pe-win-auto` (winPEAS, winPEAS from memory, PrivescCheck, PowerUp). The user runs both on nearly every host. Their step titles follow the vault ("linpeas with output logged", "winPEAS / PowerUp with output logged"). Their position follows the vault, after the manual checks and before kernel exploits. Because the checklist isn't a forced order, they can still be run first and auto-tick as now.
- **Done:** `h-pe-proof`.

**Post-exploitation (vault 05)**
- **Kept:** `h-loot-hashes`, `h-loot-sweep`, `h-loot-domain`, `h-loot-record` (worded as "New Credential Routine for every new credential").
- **New:**
  - "Re-dump LSASS after a few minutes if an expected cred is missing" (Windows);
  - "Kerberos keytabs and ccache files" (Linux, domain-joined);
  - "ARP cache, hosts file, established connections";
  - "Collect BloodHound data from here" (domain-joined).
- **Moved from orient:** `h-orient-network` ("interfaces and routes: is it dual-homed?").

**Reporting**
- **Kept:**
  - `h-close-notes`;
  - `h-close-cleanup`, client only.
- **Raven-only:** this stage has no vault playbook. `05-Reporting/` is reference material.

**Shown elsewhere:** `h-pivot-tunnel` and `h-pivot-sweep` leave the host checklist view but stay host-owned. They appear in the engagement Lateral movement section (§5).

## 5. Engagement checklist

- **Setup:** mirrors vault 00, Off-the-Bat. It keeps `e-setup-kind`, `-scope`, `-hosts` and `-clock`, and adds the vault's steps:
  - "Logging on in every tab";
  - "VPN up, note tun0 as LHOST";
  - "Confirm you can reach a target";
  - "Exam: note start time, Metasploit allowance, proof rules" (exam sims only);
  - "Full TCP and UDP scans kicked off on every host";
  - "Assumed breach: spray the starting credentials".
- **Lateral movement:** a new section mirroring vault 06. It has three groups, "Reach the new network", "Use the credential" and "Land", and opens when either:
  - a host is dual-homed;
  - a credential exists that hasn't been tried everywhere.

  **Pivot steps stay host-owned and are shown here.** `h-pivot-tunnel` and `h-pivot-sweep` keep their ids, data, library commands, auto-tick matchers and fill (`viaHostId`, `SUBNET`). They're shown in this section as one group per dual-homed host ("Behind ms02"), not on the host checklist. That way no command, matcher or progress is lost (my call).

  The vault 06 steps that aren't about a specific pivot host, such as spraying a new credential or pass-the-hash, are engagement goals (`e-lat-…`). Like the AD playbook goals, they carry library commands where Raven has them.

  The stuck check line "dual-homed, no tunnel recorded" now opens this section, on that host's group.
- **AD playbooks:** No credentials, First domain user and Domain admin are unchanged.
- **Cleanup:** unchanged.

## 6. Features that follow the new stages

- **Domain admin cover:** it covers open **Privilege escalation** and **Post-exploitation** steps, where it covered privesc and loot before. Proof steps and anything set by hand are untouched, as now. **New exception, my call:** `h-orient-network` and the "ARP, hosts, connections" step are never covered, because finding new networks still matters after domain admin, just as pivot steps were untouched before.
- **Stuck view:**
  - "Before a foothold" and "after a foothold" keep their meaning, driven by access.
  - Command suggestions after a foothold come from Privilege escalation and Post-exploitation, not privesc, loot and pivot.
- **"Now" panel and stage chip:** they show the new stage names.
- **Import from old Raven:** old board columns and stages map onto the new ones (§7).
- **Exam rules:** unchanged. Banned commands stay hidden whatever stage they're in.

## 7. Migration (real data: backup first, through the migration system)

- **Goal ids:** unchanged where the step survives (§4), so checklist progress needs no id rewrite.
- **Host pivot steps:** existing `h-pivot-tunnel` and `h-pivot-sweep` rows stay as they are and show in the engagement Lateral movement section (§5).
- **Stage ids:** the only stage-like value stored in the database is `hosts.board_column` (and `board_derived`). Checklist stages are code-only.
- **Board columns:**

  | Old column | New column |
  |---|---|
  | `enumerate` | `information-gathering` |
  | `foothold` | `vulnerability-detection` |
  | `privesc` | `privilege-escalation` |
  | `loot` | `post-exploitation` |
  | `done` | `reporting` |

  The old `foothold` column meant "enumeration finished, looking for a way in", which is now Vulnerability detection. `board_derived` is reset, so derivation places every host afresh on next open. Hand-placed hosts get the same map and keep `board_manual`.
- **The CHECK constraint:** `0002` puts a CHECK constraint on `board_column`, so the migration rebuilds `hosts` (create new, copy with the map, drop, rename) with foreign keys handled. The new default is `information-gathering`. A rebuild-and-copy migration is acceptable, with the backup first as always.
- **Old-Raven import:** uses the same column map.

## 8. Left to the builder
- The final step list and wording against the vault text, within §4.1. Wording is copied by hand; nothing checks it by machine until project 2's drift check.
- Whether to split the database steps, and whether cmdkey is its own step.
- Group headings inside stages, and how a group with no applicable steps hides.
- Exact auto-tick rules for the new steps that tick from data, such as product/version confirmed or OS identified.
- When Lateral movement opens, within §5.

## 9. Calls I made (the user should check these)
1. **Surviving steps keep their old ids** even when renamed or moved, to avoid a progress migration.
2. **The old `foothold` column maps to Vulnerability detection**, not Initial foothold.
3. **The domain admin cover never covers the network-discovery steps** in Post-exploitation.
4. **Raven-only steps stay:** `h-enum-web-source`, and Reporting's notes and cleanup.
5. **Database steps:** `h-enum-db` stays one step unless the builder splits it.
6. **The Reporting column** requires post-exploitation and reporting steps closed, as Done does today.
7. **Prep steps count as foothold actions.** Ticking any Initial foothold step, including "Listener running", moves the host to Initial foothold.
8. **Pivot steps stay host-owned**, shown in the engagement Lateral movement section as one group per dual-homed host, so their commands, matchers and fill keep working.
