# Raven PEN-200 Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Raven's board, host checklist and engagement checklist onto the PEN-200 methodology as the user's Field Manual playbooks lay it out. Every step carries copy-ready commands, and all existing data carries over.

**Architecture:**
- **Board columns** become the vault's stage ids plus `reporting`. Migration 0008 rebuilds `hosts`, and the migration runner gains a foreign-keys-off mode for it.
- **Checklist data** is rewritten in place. Surviving goal ids are kept, and goals gain an optional `group`. The pivot goals move to a stage placed on the engagement view.
- **Commands for new steps** are copied from the vault's cards into a new built-in library file, each tagged with its card id.
- **Data-driven steps** ("every port identified", "OS identified") tick through a guarded store write, modelled on the domain admin cover.

**Tech Stack:** Tauri 2 (Rust, rusqlite with SQLCipher), React 19, TypeScript, TanStack Query, Vitest with jsdom.

**Spec:** `docs/superpowers/specs/2026-11-05-raven-pen200-restructure-design.md`. It amends §5.2 and §6.4 of `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`.

**Vault (read-only reference for Task 3):** `~/Documents/Field Manual/`.
- `01-Playbook/00…06` are the step wording.
- `02-Cards/<Category>/<Card>.md` are the commands.
- `00-Home/Conventions.md` is the format contract:
  - each command has a `###` title and a `**Why:**` line;
  - its fence is titled `title:"Kali"` (runs from the attacker) or `title:"Target — …"` (runs on the target);
  - the frontmatter `id` is the card id.

## Global Constraints

- **Secrets:** never open, read, cat, grep, head, stat or copy `a file outside the repo`, any `raven-workspace-*.json`, or any file whose name contains `backup`. They hold real secrets.
- **Commits:** add explicit paths only, never `git add -A` or `git add .`.
- **Tests** use synthetic fixtures only.
- **Never:** run `npm run tauri dev`, touch localhost:3000, or write to the vault.
- **Schema changes** go through `src-tauri/migrations` and `MIGRATIONS`. The runner's hook backs up an existing database before any change. Never edit a shipped migration.
- **Board column ids, exactly:** `information-gathering`, `vulnerability-detection`, `initial-foothold`, `privilege-escalation`, `post-exploitation`, `reporting`.
- **Column labels, exactly:** "Information gathering", "Vulnerability detection", "Initial foothold", "Privilege escalation", "Post-exploitation", "Reporting".
- **Host stage ids:** the same six as the columns, plus `lateral-movement`, which is placed on the engagement view and never on the host.
- **Existing goal ids are never renamed or removed.** Every goal id in today's `hostChecklist.ts` and `engagementChecklist.ts` still exists after this plan.
- **No existing library command is removed or edited.** The one allowed change is adding a goal id to its `goals` array.
- **Every step with something to run has commands.** The only command-free steps are the judgement steps listed in Task 2, plus goals that already had no command before this plan.
- **Verification before each commit:**
  - `npx vitest run` for the touched tests;
  - `npm run typecheck`;
  - `npm run lint`;
  - for Rust tasks, also `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.

## Review Focus

1. **A real v7 database migrates intact.** Every child table that references hosts keeps every row: services, log links, tunnels, hops, checklist rows, credentials and cleanup. `PRAGMA foreign_key_check` is empty afterwards. Test: Task 1.
2. **Hand-placed hosts stay put.** A host hand-placed in the old `foothold` column becomes `vulnerability-detection` and stays `board_manual = 1`. The next derivation doesn't move it unless the derived column changes. Test: Task 1.
3. **Progress survives moves and renames.** A host with progress on goals that moved stage or were renamed shows the same statuses, notes and evidence afterwards. Examples: `h-orient-proof` done, `h-enum-exploits` noted, `h-orient-network` done. Test: Task 2, which pins every old goal id.
4. **"Tick from log" keeps derived marks.** Rebuilding every auto-tick must not wipe fact-ticked steps or domain admin cover marks, and a fact tick must revert when its fact stops holding. Test: Task 6.
5. **Exam sims hide Metasploit as before.** Newly copied Field Manual commands that use Metasploit or meterpreter carry the same exam rule as Raven's own, so they're hidden or locked exactly as today. Test: Task 3.

---

### Task 1: Board columns become the PEN-200 stages (migration 0008 and every column consumer)

**Files:**
- Create: `src-tauri/migrations/0008_pen200_columns.sql`
- Modify:
  - `src-tauri/src/migrations/mod.rs`: append `(8, …)`, and add a foreign-keys-off mode;
  - `src-tauri/src/hosts.rs:212,238`: the column validators, plus test updates;
  - `src/types/host.ts:1`;
  - `src/features/hosts/columns.ts`, `src/features/hosts/HostGlyph.tsx`, `src/features/board/Board.tsx:11-17`;
  - `src/features/capture/resolve.ts:19-23,104,165`;
  - `src/engines/capture/titles.ts:28`;
  - `src/engines/import/plan.ts:197`;
  - `src/features/checklist/EngagementChecklist.tsx:69`;
  - `src/engines/checklist/board.ts`: return values only; the rules change in Task 2;
  - `docs/superpowers/specs/2026-11-03-raven-desktop-design.md`: §5.2 and §6.4 each get one line, "Superseded by 2026-11-05-raven-pen200-restructure-design.md".
- Test:
  - `src-tauri/src/migrations/mod.rs` and `src-tauri/src/hosts.rs` tests;
  - `src/test/board.test.tsx`, `src/test/engines/import/plan.test.ts`, `src/test/engines/capture/draft.test.ts`;
  - any test asserting old column ids or labels.

**Interfaces:**
- Produces:
  - `type BoardColumn = "information-gathering" | "vulnerability-detection" | "initial-foothold" | "privilege-escalation" | "post-exploitation" | "reporting"`;
  - `COLUMN_LABELS: Record<BoardColumn, string>`, with the labels from Global Constraints.
- Rust: `hosts::move_to` and `hosts::sync_board` accept exactly the six ids.

- [ ] **Step 1: Write the failing Rust migration tests in `src-tauri/src/migrations/mod.rs`**

  **`v7_hosts_rebuild_maps_columns_and_keeps_children`.** Setup:
  - Migrate a file DB to version 7 with `migrate_with(&MIGRATIONS[..7])`.
  - Insert one engagement and five hosts, one per old column: `enumerate`, `foothold` (with `board_manual = 1`), `privesc`, `loot` and `done`. Set `board_derived` on each.
  - Give the hosts child rows in `services`, `log_entry_hosts`, `tunnels` (via `via_host_id`), `hops`, `checklist_items` (`host_id`), `credentials` (`source_host_id`), `cleanup_items` and `engagements.msf_host_id`.
  - Migrate to latest.

  Assert:
  - the columns are now `information-gathering`, `vulnerability-detection` (still `board_manual = 1`), `privilege-escalation`, `post-exploitation` and `reporting`;
  - `board_derived IS NULL` on every host;
  - every child row count is unchanged;
  - `PRAGMA foreign_key_check` returns no rows, and `PRAGMA foreign_keys` is 1 after `migrate` returns;
  - inserting a host with `board_column = 'enumerate'` fails;
  - a host inserted without `board_column` gets `information-gathering`;
  - deleting a host still cascades to its services.

  **`fk_off_migration_failure_rolls_back`.** A list whose foreign-keys-off migration's SQL errors leaves `user_version` and the data unchanged, with `PRAGMA foreign_keys` back at 1.

- [ ] **Step 2: Run them and check they fail.** `cargo test --manifest-path src-tauri/Cargo.toml migrations`. Expected: FAIL, because there's no version 8 yet.

- [ ] **Step 3: Implement the runner mode and migration 0008**

  **Runner.** In `migrate_with`, when any pending migration's SQL starts with the marker line `-- raven:foreign-keys-off`:
  1. run `PRAGMA foreign_keys = OFF` before opening the shared transaction;
  2. run every pending migration in that one transaction;
  3. run `PRAGMA foreign_key_check` before commit, and return `AppError::Db` if it reports any row;
  4. commit;
  5. restore `PRAGMA foreign_keys = ON` on every exit path, including errors.

  Update the module doc comment, which currently says this needs a separate step.

  **0008** is the SQLite table rebuild of `hosts`:
  1. `CREATE TABLE hosts_new` with every current column, in order and with the constraints from 0002, 0003, 0004 and 0005. `board_column` gets `DEFAULT 'information-gathering'` and a CHECK on the six ids. Keep `UNIQUE (engagement_id, ip)`.
  2. `INSERT … SELECT`, mapping columns with a `CASE`:

     | Old column | New column |
     |---|---|
     | `enumerate` | `information-gathering` |
     | `foothold` | `vulnerability-detection` |
     | `privesc` | `privilege-escalation` |
     | `loot` | `post-exploitation` |
     | `done` | `reporting` |

     Set `board_derived` to NULL.
  3. `DROP TABLE hosts`, then `ALTER TABLE hosts_new RENAME TO hosts`.

  No other table is touched.

- [ ] **Step 4: Update the Rust validators and tests.** `hosts.rs:212,238` match the six new ids. Rewrite the column literals in the existing `hosts.rs` tests with the same map.

- [ ] **Step 5: Update the TypeScript column consumers**
  - **Glyphs**, in column order: `○ ◔ ◑ ◕ ◉ ●`. Only `reporting` gets the accent colour.
  - **`resolve.ts`:** flag kind `proof` applies when the column index is at least that of `privilege-escalation`.
  - **Capture title stage words**, with `info` as the default when there's no column:

    | Column | Word |
    |---|---|
    | `information-gathering` | `info` |
    | `vulnerability-detection` | `vulns` |
    | `initial-foothold` | `foothold` |
    | `privilege-escalation` | `privesc` |
    | `post-exploitation` | `post-ex` |
    | `reporting` | `report` |

  - **Old-Raven import status map**, with `information-gathering` as the fallback:

    | Old status | New column |
    |---|---|
    | `backlog`, `recon` | `information-gathering` |
    | `foothold` | `initial-foothold` |
    | `root` | `post-exploitation` |
    | `completed` | `reporting` |

  - **`board.ts`:** return the new ids with today's logic, remapped by the Step 3 table. Task 2 replaces the rules.
  - **Tests:** update every TypeScript test literal that uses old column ids or labels.

- [ ] **Step 6: Verify.** `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && npx vitest run && npm run typecheck && npm run lint`. Expected: all green.

- [ ] **Step 7: Commit**

  ```bash
  git add src-tauri/migrations/0008_pen200_columns.sql src-tauri/src/migrations/mod.rs src-tauri/src/hosts.rs src/types/host.ts src/features/hosts/columns.ts src/features/hosts/HostGlyph.tsx src/features/board/Board.tsx src/features/capture/resolve.ts src/engines/capture/titles.ts src/engines/import/plan.ts src/features/checklist/EngagementChecklist.tsx src/engines/checklist/board.ts docs/superpowers/specs/2026-11-03-raven-desktop-design.md <each test file touched>
  git commit -m "feat(board): PEN-200 columns, migration 0008 rebuilds hosts"
  ```

---

### Task 2: Host checklist restructured onto the PEN-200 stages (data and engine rules)

**Files:**
- Modify:
  - `src/engines/checklist/types.ts`: add `group?: string` to `ChecklistGoal`, and `placement?: 'engagement'` to `ChecklistStage`;
  - `src/engines/checklist/data/hostChecklist.ts`: the full rewrite below;
  - `src/engines/checklist/facts.ts:166-167`: empty hints by the new stage ids;
  - `src/engines/checklist/board.ts`: the new rules;
  - `src/engines/checklist/daCover.ts:23-25`;
  - `src/engines/stuck/hostStuck.ts:32`;
  - `src/engines/stuck/engagementStuck.ts:61,72`: stage lookups by the new ids. The `area` labels stay unchanged.
- Test:
  - `src/test/engines/checklist/data.test.ts`, `board.test.ts`, `daCover.test.ts`, `applicability.test.ts`;
  - `src/test/engines/stuck/*`.

**Interfaces:**
- Consumes `BoardColumn` from Task 1.
- Produces:
  - `HOST_STAGES`, with ids in this order: `information-gathering`, `vulnerability-detection`, `initial-foothold`, `privilege-escalation`, `post-exploitation`, `reporting`, then `lateral-movement` (`placement: 'engagement'`);
  - the new goal ids listed below, which Tasks 3–6 use;
  - `FACT_GOALS = ['h-enum-identified', 'h-enum-os'] as const`, exported from `hostChecklist.ts`;
  - `hostViewStages(applicable)`, exported from `facts.ts`, which drops stages with `placement: 'engagement'`.

**Stage content.** Steps are listed in order, with their `group` in quotes. **new** marks a new id.
- Titles follow the vault item, without its `→ [[…]]` tail.
- A kept id keeps its `why`. A new id gets a one-sentence `why` in Raven's existing voice.

- **`information-gathering`:**
  - "Every host":
    - `h-enum-full-tcp`;
    - `h-enum-versions` ("-sV -sC on just the open ports");
    - `h-enum-udp`;
    - `h-enum-identified` **new** ("Every port has a confirmed product and version", SCANNED);
    - `h-enum-os` **new** ("OS identified (TTL, SMB, banners)", SCANNED).
  - "Per service", in the vault's port order:
    - `h-enum-ftp`;
    - `h-enum-ssh` **new** (22/ssh);
    - `h-enum-smtp`, `h-enum-dns`;
    - `h-enum-web-stack`, `h-enum-web-content`, `h-enum-web-vhosts`, `h-enum-web-source`;
    - `h-enum-kerberos` **new** (88/kerberos);
    - `h-enum-rpc`, `h-enum-smb`, `h-enum-snmp`, `h-enum-ldap`, `h-enum-db`, `h-enum-nfs`, `h-enum-remote`;
    - `h-enum-mail` **new** (110/143/993/995, pop3/imap);
    - `h-enum-tftp` **new** (69/tftp);
    - `h-enum-rsync` **new** (873/rsync);
    - `h-enum-docker` **new** (2375/2376/docker);
    - `h-enum-tomcat` **new** ("Tomcat / Jenkins / NiFi"; services `tomcat`, `jenkins` and `nifi`, plus port 8080).
  - "If there's a domain" (domainJoined):
    - `h-enum-ad-users` **new** ("Usernames from every source into users.txt");
    - `h-enum-asrep` **new** (AS-REP roastable users).

    Either one is left out if the `AD_PLAYBOOKS` "No credentials" playbook already has an equivalent goal. Record that ruling in the task report.
- **`vulnerability-detection`:**
  - "Every product and version":
    - `h-enum-exploits` ("searchsploit every product and version");
    - `h-vuln-websearch` **new** ("Web search for exploits and PoCs");
    - `h-vuln-version-gate` **new** ("Check the exploit's version gate against the real version");
    - `h-foot-web-auth` ("Default credentials for the product and its logins");
    - `h-vuln-nse` **new** ("Targeted NSE vuln scripts", SCANNED).
  - "Web apps" (WEB): `h-foot-web-vulns`, `h-foot-brute`.
  - "Credentials as a vulnerability":
    - `h-vuln-spray` **new** (CRED_LOGIN);
    - `h-vuln-crack` **new** ("Crack the hashes you hold").
  - "Rank":
    - `h-vuln-rank` **new** ("Order the candidates");
    - `h-vuln-msf` **new** ("Exam: decide whether a candidate needs Metasploit", `kinds: ['exam-sim']`).
- **`initial-foothold`:**
  - "Before firing":
    - `h-foot-listener` **new**;
    - `h-foot-payload`;
    - `h-foot-port` **new** ("Pick a port the target can reach out on");
    - `h-foot-exploit` ("Public exploit read end to end, IPs/ports/paths changed").
  - "Get the shell":
    - `h-foot-shell`;
    - `h-foot-webshell` **new** (WEB; "Web shell only: upgrade to a reverse shell");
    - `h-foot-service`, `h-foot-creds`;
    - `h-foot-client` **new** ("Client-side: a user opens a file").
  - "Right after landing":
    - `h-stab-shell`;
    - `h-orient-identity` ("whoami, hostname, IP: confirm where you are");
    - `h-orient-proof`;
    - `h-foot-arrived` ("Log how you got in").
- **`privilege-escalation`:**
  - "Linux" (LIN), in this order:
    - `h-pe-lin-manual` **new**;
    - `-sudo`, `-suid`, `-caps`, `-cron`, `-writable`;
    - `h-pe-lin-creds` **new** ("Passwords in history, configs, backups, databases");
    - `h-pe-lin-groups` **new** ("Dangerous groups (docker, lxd, disk)");
    - `h-pe-lin-nfs` **new** ("NFS shares with no_root_squash");
    - `-internal`;
    - `-auto` ("linPEAS with output logged");
    - `-kernel`.
  - "Windows" (WIN), in this order:
    - `h-pe-win-manual` **new**;
    - `-privs`;
    - `-groups` ("Already an admin but filtered?");
    - `-stored`;
    - `h-pe-win-saved` **new** ("Saved credentials (cmdkey /list)");
    - `-services`, `-tasks`, `-registry`;
    - `h-pe-win-software` **new** ("Non-default installed software and version");
    - `-auto` ("winPEAS / PowerUp with output logged");
    - `-kernel`.
  - "Done": `h-pe-proof`.
- **`post-exploitation`:**
  - "Credentials and files":
    - `h-loot-hashes`;
    - `h-post-redump` **new** (WIN; "No expected cred? Re-dump LSASS after a few minutes");
    - `h-loot-domain`, `h-loot-sweep`;
    - `h-post-keytabs` **new** (LIN, domainJoined; "Kerberos keytabs and ccache files").
  - "Network":
    - `h-orient-network` ("Interfaces and routes: is this host dual-homed?");
    - `h-post-neighbours` **new** ("ARP cache, hosts file, established connections").
  - "Domain" (domainJoined): `h-post-bloodhound` **new** ("Collect BloodHound data from here").
  - "Every new credential": `h-loot-record` ("Add it to the creds list and run the New Credential Routine").
- **`reporting`:** `h-close-notes`, `h-close-cleanup`.
- **`lateral-movement`** (`placement: 'engagement'`): `h-pivot-tunnel`, `h-pivot-sweep`, both unchanged.

**Judgement steps (no commands, by design):**
- `h-foot-port`;
- `h-vuln-rank`;
- `h-vuln-msf`: a decision about the exam allowance. Its commands live on the foothold steps.

**Board rules (`derivedColumn`).** Check in this order and take the first match:

| Order | Condition | Column |
|---|---|---|
| 1 | `h-pe-proof` done, and every applicable `post-exploitation` and `reporting` goal is closed | `reporting` |
| 2 | `h-pe-proof` done | `post-exploitation` |
| 3 | any of `h-foot-shell`, `h-foot-creds`, `h-stab-shell`, `h-foot-arrived`, `h-orient-proof` done | `privilege-escalation` |
| 4 | any applicable `initial-foothold` goal done, or `host.access !== 'none'` | `initial-foothold` |
| 5 | every applicable `information-gathering` goal closed, with at least one | `vulnerability-detection` |
| 6 | otherwise | `information-gathering` |

**Related rules:**
- No rule reads `vulnerability-detection` or `lateral-movement` goals.
- `currentStage` skips stages with `placement: 'engagement'`.
- **Domain admin cover:** `COVERED_STAGES` is `privilege-escalation` and `post-exploitation`. `NEVER_COVERED` is `h-pe-proof`, `h-orient-network` and `h-post-neighbours`.
- **`hostStuck`:** `AFTER_STAGES` is `privilege-escalation`, `post-exploitation` and `lateral-movement`, so pivot commands still appear after a foothold, as today.

- [ ] **Step 1: Write the failing tests**
  - `data.test.ts`:
    - `every pre-restructure goal id still exists`: a literal array of every current host goal id from today's `hostChecklist.ts` and every current engagement goal id. Each must be found in `HOST_GOALS` or the engagement data.
    - `stage ids and order`: `HOST_STAGES.map(s => s.id)` equals the seven ids above.
    - `goal ids are unique`.
    - `every goal in a stage with groups has a group`.
    - `h-orient-proof is in initial-foothold and h-orient-network in post-exploitation`.
    - `h-enum-exploits is in vulnerability-detection`.
  - `board.test.ts`:
    - `all detection steps closed stays in vulnerability-detection`;
    - `listener ticked moves to initial-foothold`;
    - `access user with nothing ticked is initial-foothold`;
    - `h-stab-shell done is privilege-escalation even with foothold steps open`;
    - `proof done with post-exploitation open is post-exploitation`;
    - `proof done, post-ex and reporting closed is reporting`;
    - `open pivot goals do not block reporting`.
  - `daCover.test.ts`: `covers post-exploitation goals but never h-orient-network or h-post-neighbours`.
  - Stuck engine tests: `after a foothold, commands come from privilege-escalation, post-exploitation and lateral-movement`.

- [ ] **Step 2: Run them and check they fail.** `npx vitest run src/test/engines/checklist src/test/engines/stuck`. Expected: FAIL.

- [ ] **Step 3: Implement the data and engine changes.** Add any new applicability constants (SSH, KERBEROS, MAIL, TFTP, RSYNC, DOCKER, TOMCAT) beside the existing ones.

- [ ] **Step 4: Update existing tests** that assert old stage ids or titles, keeping their intent.

- [ ] **Step 5: Verify.** `npx vitest run && npm run typecheck && npm run lint`. Expected: green. UI tests that read stage headings may fail until Task 4; fix their literals here, so every commit is green.

- [ ] **Step 6: Commit** the explicit paths with the message `feat(checklist): host stages follow the PEN-200 playbooks`.

---

### Task 3: Commands for every new step (Field Manual cards copied into the built-in library)

**Files:**
- Create: `src/engines/library/data/fieldManual.ts`, exporting `FIELD_MANUAL_COMMANDS: LibraryCommand[]`.
- Modify:
  - `src/engines/library/types.ts`: `source` gains `'field-manual'`; add `cardId?: string`;
  - `src/engines/library/data/index.ts`: include the new list in `BUILTIN_LIBRARY`;
  - existing data files: **only add** new goal ids to the `goals` arrays of existing commands that serve a new step. For example, the existing nxc spray commands gain `h-vuln-spray` and `e-lat-spray`.
- Test: `src/test/engines/library/commandLibrary.test.ts`.

**Interfaces:**
- Consumes:
  - the goal ids from Task 2;
  - Task 5's engagement ids: `e-setup-logging`, `e-setup-vpn`, `e-setup-reach`, `e-setup-exam-rules`, `e-setup-scans`, `e-setup-assumed-breach`, `e-lat-spray`, `e-lat-password`, `e-lat-hash`, `e-lat-ticket`.
- Produces entries with:
  - `id: 'fm-<cardId>-<n>'`;
  - `source: 'field-manual'`;
  - `cardId`: the card's frontmatter id.

**Card for each step.** Read each card's frontmatter `id` and its command blocks. Never write to the vault.

| Step | Card |
|---|---|
| `h-enum-identified` | Unknown-Port-Identification |
| `h-enum-os` | Host-Discovery |
| `h-enum-ssh` | SSH-Enumeration |
| `h-enum-kerberos` | Kerberos-Enumeration |
| `h-enum-mail` | POP3-IMAP-Enumeration |
| `h-enum-tftp` | TFTP-Enumeration |
| `h-enum-rsync` | Rsync-Enumeration |
| `h-enum-docker` | Docker-API-Enumeration |
| `h-enum-tomcat` | Tomcat-Attacks, Jenkins-Attacks, Apache-NiFi-RCE |
| `h-enum-asrep` | AS-REP-Roasting |
| `h-vuln-websearch`, `h-vuln-version-gate`, `h-pe-win-software` | Public-Exploit-Research |
| `h-vuln-nse` | Vulnerability-Scanning |
| `h-vuln-crack` | Hash-Cracking-Hashcat |
| `h-foot-listener` | Listeners |
| `h-foot-webshell` | Web-Shells |
| `h-foot-client` | Office-Macro-Payloads, Windows-Library-File-Attack |
| `h-pe-lin-manual` | Linux-PrivEsc-Enumeration |
| `h-pe-lin-creds` | Credential-Hunting-Linux |
| `h-pe-lin-groups` | Container-Escape |
| `h-pe-lin-nfs` | NFS-No-Root-Squash |
| `h-pe-win-manual` | Windows-PrivEsc-Enumeration |
| `h-pe-win-saved` | Saved-Credentials-and-Runas |
| `h-post-redump` | LSASS-Credential-Dumping |
| `h-post-bloodhound` | BloodHound-Collection-and-Analysis |
| `e-setup-scans` | Port-Scanning |
| `e-lat-password` | Remote-Execution-Methods |
| `e-lat-hash` | Pass-the-Hash, Overpass-the-Hash |
| `e-lat-ticket` | Pass-the-Ticket |

**Raven-authored commands** (`source: 'raven'`):

| Step | Commands |
|---|---|
| `h-post-neighbours` | Linux: `ip neigh`, `cat /etc/hosts`, `ss -tnp`. Windows: `arp -a`, `type C:\Windows\System32\drivers\etc\hosts`, `netstat -ano` |
| `h-post-keytabs` | `find / \( -name '*.keytab' -o -name 'krb5cc_*' \) 2>/dev/null`, `klist` |
| `h-vuln-websearch` | the template `{PRODUCT} {VERSION} exploit`, if Public-Exploit-Research has no equivalent |
| `h-vuln-version-gate` | `searchsploit -x {EDB_ID}` |
| `e-setup-logging` | `script -a session.log` |
| `e-setup-vpn` | `ip -4 addr show tun0` |
| `e-setup-reach` | `ping -c 2 {TARGET_IP}` |
| `e-setup-assumed-breach` | link the existing spray commands |

`e-setup-exam-rules` has no command: it's a judgement step.

**Copy rules:**
- **Title and why:** the block's `###` title becomes `title`, and its `**Why:**` line becomes `why`.
- **Run from:** a `Kali` fence title becomes `runFrom: 'attacker'`; `Target — …` becomes `runFrom: 'target'`.
- **OS:** from the card's `os` frontmatter, falling back to `any`.
- **Templates:** keep the vault's `{UPPER_SNAKE}` tokens verbatim. Raven's fill already resolves its own, and others show as tokens.
- **Multi-line blocks** stay one template. Skip comment-only lines.
- **Duplicates:** skip a block whose template, with whitespace normalised, equals an existing built-in already linked to that goal.
- **Auto-tick:** add `match` and `matchExamples` (at least one hit and one miss) only where the command's binary and arguments are distinctive. Follow the style of the existing entries in `linux.ts`.
- **Exam rules:** any template invoking `msfconsole`, `meterpreter`, `use exploit/` or `msfvenom … meterpreter` gets the same `exam` value Raven's own equivalent entries use. Look up the convention in `foothold.ts` and `examRules.ts`.

- [ ] **Step 1: Write the failing tests in `commandLibrary.test.ts`**
  - `every non-judgement host and engagement goal has at least one command`. It iterates over:
    - `HOST_GOALS`;
    - `ENGAGEMENT_SETUP`;
    - the engagement lateral goals from Task 5 (a literal id list until Task 5 lands);
    - the `AD_PLAYBOOKS` goals.

    The exceptions are the new judgement steps `['h-foot-port', 'h-vuln-rank', 'h-vuln-msf', 'e-setup-exam-rules', 'e-lat-record-hop']`, plus every pre-existing goal that had no command before this plan. Compute that list once from the pre-change data and paste it in as a commented literal.
  - `field-manual entries have a cardId and an fm- id`.
  - `field-manual metasploit templates carry the exam rule`.
  - `no built-in id is duplicated`.

  The existing matcher-example tests cover the new entries automatically.

- [ ] **Step 2: Run them and check they fail.** `npx vitest run src/test/engines/library`. Expected: FAIL, because the new goals have no commands.

- [ ] **Step 3: Write `fieldManual.ts` and the goal-array additions,** following the tables and copy rules above.

- [ ] **Step 4: Verify.** `npx vitest run && npm run typecheck && npm run lint`. Expected: green.

- [ ] **Step 5: Commit** with the message `feat(library): Field Manual commands for every new step`.

---

### Task 4: Host view follows the new stages (groups, hidden engagement stage, labels)

**Files:**
- Modify:
  - `src/features/checklist/HostChecklist.tsx:75-110`: render `hostViewStages(...)`, with a group sub-heading before the first goal of each group;
  - `src/features/checklist/NowPanel.tsx`: uses `currentStage`, which already skips engagement-placed stages;
  - `src/features/stuck/StuckView.tsx`: any stage or column label text.
- Test: `src/test/hostChecklist.test.tsx`, `src/test/nowPanel.test.tsx`, `src/test/stuck.test.tsx`, `src/test/hostView.test.tsx`.

**Interfaces:** consumes `hostViewStages` and `ChecklistGoal.group` from Task 2.

**Group headings:**
- A group heading is an `h4`, one step quieter than the stage `h3`.
- A group with no applicable goals renders nothing.
- Goals with no group render before the first group.

- [ ] **Step 1: Write the failing tests**
  - `hostChecklist.test.tsx`:
    - `stages render in PEN-200 order`: the region names are "Information gathering", "Vulnerability detection", "Initial foothold", "Privilege escalation", "Post-exploitation" and "Reporting", with no "Lateral movement" region on a dual-homed host.
    - `group headings show only when a goal in them applies`: a Linux host shows a "Linux" heading and no "Windows" heading.
    - `existing commands still render under h-pe-lin-auto`: a linPEAS copy button is present.
  - `nowPanel.test.tsx`: `Now shows the first open host-view stage, never lateral-movement`.

- [ ] **Step 2: Run them and check they fail.** `npx vitest run src/test/hostChecklist.test.tsx src/test/nowPanel.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the rendering.**

- [ ] **Step 4: Verify.** `npx vitest run && npm run typecheck && npm run lint`. Expected: green.

- [ ] **Step 5: Commit** with the message `feat(host): checklist groups and PEN-200 stage headings`.

---

### Task 5: Engagement checklist mirrors Off-the-Bat and gains Lateral movement

**Files:**
- Modify:
  - `src/engines/checklist/data/engagementChecklist.ts`: the new setup goals, plus `LATERAL_MOVEMENT_GOALS`;
  - the module holding `playbookTriggers`: a `lateral` trigger;
  - `src/features/checklist/EngagementChecklist.tsx`: the Lateral movement section;
  - `src/engines/stuck/engagementStuck.ts:145` and `src/features/stuck/StuckView.tsx`: the dual-homed line's target.
- Test: `src/test/engagementChecklist.test.tsx`, `src/test/stuck.test.tsx`, `src/test/engines/stuck/*`.

**Interfaces:**
- Consumes the `lateral-movement` stage (Task 2) and the commands (Task 3).
- Produces:
  - `LATERAL_MOVEMENT_GOALS: ChecklistGoal[]`, with ids `e-lat-spray`, `e-lat-password`, `e-lat-hash` and `e-lat-ticket` (group "Use the credential"), and `e-lat-record-hop` (group "Land"; "Record the hop: from host, via, to host, access level");
  - `playbookTriggers(...).lateral: boolean`.

**Setup.** `ENGAGEMENT_SETUP` becomes, in this order:
- "Workspace":
  - `e-setup-logging` **new** ("Session logging on in every tab").
- "Network":
  - `e-setup-vpn` **new** ("VPN up; note tun0 as LHOST");
  - `e-setup-reach` **new** ("Confirm you can reach a target").
- "Scope":
  - `e-setup-kind`, `e-setup-scope`, `e-setup-hosts`, `e-setup-clock`;
  - `e-setup-exam-rules` **new** (`kinds: ['exam-sim']`; "Note the start time, the Metasploit allowance and the proof rules").
- "Kick off scans":
  - `e-setup-scans` **new** ("Full TCP and UDP scans running on every host");
  - `e-setup-assumed-breach` **new** ("Assumed breach: spray the starting credentials (N/A if none)").

**Lateral movement section.** It sits after Active Directory and before Tunnels:
- **Container:** a `PlaybookSection` titled "Lateral movement", with `opensWhen` "A host is dual-homed, or a credential hasn't been tried everywhere".
- **Open by default** when `lateral` is true: any host has `dualHomed`, or any credential lacks an attempt on some host with a sprayable service. Use `hostSprayServices` and `isSprayable` from `engines/credentials`.
- **"Reach the new network":** one group per dual-homed host, headed "Behind <host name>". Each group renders that host's `h-pivot-tunnel` and `h-pivot-sweep` rows:
  - state comes from `byOwner.get(host.id)`;
  - `FillInput.host` is set to that host;
  - status and notes writes use `ownerId: host.id`.
- **Then** the `LATERAL_MOVEMENT_GOALS` rows, owned by the engagement.

**Stuck line.** "<host> — dual-homed, no tunnel recorded" now navigates to the engagement checklist and focuses that host's `h-pivot-tunnel` row in the Lateral movement section, which opens.

- [ ] **Step 1: Write the failing tests**
  - `engagementChecklist.test.tsx`:
    - `setup follows Off-the-Bat order with groups`;
    - `exam-rules step shows only in exam sims`;
    - `lateral movement lists pivot steps behind each dual-homed host with filled commands`: two dual-homed hosts produce two "Behind …" groups, each with a tunnel command copy button;
    - `ticking a pivot step writes the host as owner`: `checklistPut` is called with `ownerId` equal to the host id;
    - `lateral movement is closed with no dual-homed host and no untried credential`.
  - `stuck.test.tsx`: `a Stuck check line opens its host on the goal` becomes `the dual-homed line opens the Lateral movement section on that host's tunnel step`.

- [ ] **Step 2: Run them and check they fail.** `npx vitest run src/test/engagementChecklist.test.tsx src/test/stuck.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the setup goals, the trigger, the section and the stuck navigation.

- [ ] **Step 4: Point Task 3's test at the real list.** Replace its literal lateral id list with an import of `LATERAL_MOVEMENT_GOALS`.

- [ ] **Step 5: Verify.** `npx vitest run && npm run typecheck && npm run lint`. Expected: green.

- [ ] **Step 6: Commit** with the message `feat(engagement): Off-the-Bat setup and a Lateral movement section`.

---

### Task 6: Fact ticks for "every port identified" and "OS identified"

**Files:**
- Modify:
  - `src-tauri/src/checklist.rs`: `apply_facts`, modelled on `apply_cover`;
  - `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs`: register `checklist_apply_facts`;
  - `src/lib/api.ts`: `checklistApplyFacts(engagementId, done: GoalRef[], revert: GoalRef[]) => Promise<ChecklistItem[]>`;
  - `src/engines/checklist/`: new `factTicks.ts`;
  - `src/features/checklist/ticks.ts`: wire it into `resyncBoards`, and stop the rebuild from wiping fact ticks.
- Test: Rust tests in `checklist.rs`, `src/test/engines/checklist/factTicks.test.ts`, `src/test/checklistTicks.test.tsx`.

**Interfaces:**
- Consumes `FACT_GOALS` from Task 2.
- Produces:
  - `factTickGoals(input: { engagement; hosts; servicesByHost; byOwner }): { done: GoalRef[]; revert: GoalRef[] }`;
  - `isFactMarked(goalId, item): boolean`, which is true when the goal is in `FACT_GOALS`, `auto` is true, `status` is `done` and the evidence is empty.

**Facts:**
- **`h-enum-identified`** holds when the host has at least one open service and every open service has a version (`confirmedVersion` or `nmapVersion`). A service's `nmapService` must also not end in `?` and must not be `tcpwrapped`, unless a confirmed product is set.
- **`h-enum-os`** holds when `host.os !== null`.

**Store write.** `apply_facts` runs in one transaction, with the same ownership checks as `apply_cover`:
- **`done`:** insert a row, or update an untouched `todo` (`auto = 0`, `status_manual = 0`), setting `status = 'done'`, `auto = 1`, `auto_from = NULL`, `completed_at = now`.
- **`revert`:** set back to `todo` only where `status = 'done' AND auto = 1 AND status_manual = 0 AND evidence = '[]'`.

**Order inside `resyncBoards`:** `afterAutoTick` → `applyFacts` → `applyDaCover` → `syncBoards`.

- [ ] **Step 1: Write the failing tests**
  - Rust:
    - `apply_facts_sets_done_on_untouched_and_leaves_manual`;
    - `apply_facts_reverts_only_fact_marked`.
  - TypeScript engine:
    - `identified holds with confirmed versions and not with a ? service`;
    - `os fact follows host.os`;
    - `reverts when a new unidentified service appears`.
  - `checklistTicks.test.tsx`:
    - `Tick from log keeps fact ticks and DA cover marks`;
    - `setting the OS ticks OS identified, and clearing it reverts`.

- [ ] **Step 2: Run them and check they fail.** `cargo test --manifest-path src-tauri/Cargo.toml checklist`, then `npx vitest run src/test/engines/checklist/factTicks.test.ts src/test/checklistTicks.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the Rust write, the API binding, `factTicks.ts` and the resync wiring. Guard the log rebuild path so it leaves `isFactMarked` items alone, extending the same check that already spares `isCoverMarked` items.

- [ ] **Step 4: Verify.** `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && npx vitest run && npm run typecheck && npm run lint`. Expected: green.

- [ ] **Step 5: Commit** with the message `feat(checklist): data-driven ticks for identified ports and OS`.
