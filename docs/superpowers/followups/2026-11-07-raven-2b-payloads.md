# 2b Payloads: follow-ups

These are left over from the 2b-B Payloads build (branch `interpreters-payloads`, 2026-11-07). The reviews passed, and none of these blocks a merge. Each item names the file where it lives. Tick an item off or delete it once it's done.

## Do first

- [x] **The Transfer copy-guard hint names the wrong key.** It says "↵ again to copy anyway", but in Transfer the repeat key is ⌘↵ (or the Copy button). Let `useCopyGuard` take the repeat key as a parameter. Also, Transfer's Copy button and its ⌘↵ use two separate guards, so you can get the "not filled" step twice. (`copyGuard.ts:46`, `TransferGenerator.tsx`)
- [x] **Two old test files still use lab-style IPs.** `src/test/transferGenerator.test.tsx` uses 10.10.14.9 and `src/test/engines/interpret/peas.test.ts` uses 10.10.14.7. Switch both to 192.0.2.x, since fixtures must be fully made up.
- [ ] **Check the Kali paths in the Nishang and powercat prepare step on a real Kali box.** Still open for the owner's next lab. The parts now name the packages (`powercat`, `nishang`) and give a `dpkg -L` check if `cp` fails. (`reverseShells.ts`)
- [ ] **Open the app and use the drawer and the Workbench for real tasks.** So far they have only been tested and audited against fake data.

## Payload content

- [x] **The Java WAR shows twice when the OS is unknown** (2b-C made `os: "any"` possible for a def, so the duplicate can go now; one entry for Linux, one for Windows). When the OS is known, the other entry folds as "Wrong OS", which is wrong because a WAR runs on either. Allow `os: "any"` in `types.ts` and `fit.ts`. (`msfvenom.ts`) Done (pre-lab batch): one `msf-java-war` with `os: "any"`; failures and builds logged under the old ids still count (`memory.ts`).
- [x] **Two hints are unverified:** the WAR's "browse to /rev/" and the dll's `rundll32 rev.dll,<export>`. Also, hta-psh is labelled x64, but mshta may run as 32-bit. (`msfvenom.ts`) Done (pre-lab batch): the WAR note browses to FILE's stem (the owner's card confirms the path), the DLL note says any export works (DllMain), and the HTA note names the 64-bit mshta and says to check which one a double-click uses.
- [x] **The ps-b64 parts explain the flags but not the encoded script** (TCPClient, `iex`, the `PS >` prompt). (`reverseShells.ts`)
- [x] **The nc-exe part token breaks if FILE is renamed** (for example to `nc64.exe`). The Nishang note "quotes doubled" shows in every context, not only sql-string. (`reverseShells.ts`)
- [x] **Shell upgrade:**
  - The `export TERM` step isn't labelled as running on the target.
  - `Ctrl-Z` shows as a copyable "payload".
  - Step 3 runs on Kali, but ⌘↵ logs it as run on the target.
  - No test checks that every step has parts, or that `{USER}` is unresolved. (`upgrade.ts`)
- [x] **Unresolved payloads show unwrapped.** If you type the IP in by hand, the result is the wrong shape for its context. Wrap them anyway, and keep the stub only for the base64 PowerShell. (`build.ts`)
- [x] **URL encoding still leaves newlines and non-ASCII characters raw.** Uppercase `{…}` text in a custom SQL `cmd` (for example `${IFS}`) also stays raw, because placeholders are exempt from encoding. (`encode.ts`)
- [x] **The macro wrapper only doubles `"`.** `injected-linux` applies `bash -c` whatever `os` is passed. (`context.ts`)
- [ ] **msfvenom's baked note says "the served script"** ("LHOST and LPORT are baked into the served script"), but an msfvenom def is a file you make and upload. Name the file instead, as the upload.kali note does. (`build.ts`) Found in the pre-lab batch.

## SQL

- [ ] **`CONCAT(` also matches `GROUP_CONCAT(`,** which adds a spurious "CONCAT" part. (`sqlKeywords.ts`)
- [ ] **The keyword scan also reads embedded data,** so `NULL`/`AS`/`FROM` inside base64 or a custom cmd add spurious parts. Scan only the SQL skeleton. (`sql.ts`)
- [ ] **Some explanations assume a stacked injection** ("the leading ;") even in a client session.
- [ ] **Smaller correctness gaps:**
  - The LOAD_FILE "defaults to /etc/passwd" note shows even when a path is given.
  - INTO OUTFILE doesn't check the bounds of the reflected column.
  - `%2d` is skipped when nc.exe is passed through `cmd`.
- [ ] **Databases, tables and columns return many rows but the page shows one.** Add string_agg / LISTAGG / group_concat or a paging note.
- [ ] **Engine gaps:**
  - MySQL 5.7 needs `FROM DUAL` for `SELECT 1 WHERE 1=1`.
  - Oracle's `dbms_pipe` sleep needs an EXECUTE grant (mention it).
  - On strict engines, reflected-columns with no column count takes the old unknown-column path.
- [ ] **The SQL panel is long** (10 steps plus exec payloads), especially in the 560px drawer. Consider a compact mode, or collapsing finished steps.

## Fit and memory

- [ ] **More cases fit inference doesn't handle:**
  - a raw HTTP request (`GET /s.aspx?cmd=id`) isn't read as a web shell;
  - linPEAS output with ANSI colour codes defeats tool detection;
  - `OpenSSH for_Windows` isn't seen as Windows;
  - `which python3>/dev/null` (no space) reads the tool as `python`. (`fit.ts`)
- [ ] **`REQUIRE_TOOL` covers only six requirement ids, and this isn't documented.** Evidence uses the full nmap product string. (`fit.ts`)
- [ ] **A log entry's payload id can't be cleared once set.** The failure text "cannot find" is broad. `staleBaked` reports a false stale warning if a stored value lacks LHOST or LPORT. (`log.rs`, `memory.ts`)
- [ ] **Ranking doesn't wait for the engagement kind to load** (it isn't fail-closed like the Arsenal's). This is harmless while no payload is exam-banned. (`usePayloadFit.ts`)

## Drawer and Workbench

- [ ] **The drawer's Port chip only offers 443, 80 and the Settings port.** A custom LPORT needs the Workbench. (`ContextChips.tsx`)
- [ ] **Overrides are independent:** after you pick OS = Linux, an earlier `cmd` paste override still applies.
- [ ] **After a mouse pick, ↵ can reopen the chip instead of copying.** ⌥L copies `penelope -O -p {LPORT}` without the guard when no port is set. ⌘↵ on the Encode tab logs LHOST/LPORT, which don't apply there.
- [ ] **Tabbing past the drawer body goes through the page before reaching Full screen.** Shift+Tab gets there in a few presses, but nothing says so.
- [ ] **Paste-context labels truncate in the Workbench with no `title`.** The host chip has no minimum width.
- [ ] **Test gaps:**
  - `P` while typing in a field;
  - ↵ or Esc inside an open chip list;
  - ⌥1 against HostView's tabs;
  - Esc when `/payloads` is the first history entry;
  - the weak `nc.exe` `toHaveCount(0)` check in the audit.

## Owner decisions (2026-11-08)

- [x] **Never run a payload built with a stale LHOST.** Done in 2b-C: the build is remembered and the block opens with an amber "Rebuild first" line. A warning on logged payloads isn't enough. Raven should remember every copy of a payload that bakes in LHOST/LPORT (rev.ps1, msfvenom files), not only ⌘↵ copy-and-log. Once LHOST or LPORT changes, it should stop you using the old build until it's rebuilt, instead of only showing a warning line. (`memory.ts` `staleBaked`, `usePayloadSession.tsx`, the copy guard)
- [x] **No payload is banned on the exam.** Done in 2b-C: exam limits live at the tool level (the Meterpreter lock line). Only some tools are banned or restricted. Remove the "Not allowed in the exam" payload fold and its meterpreter/staged check, and handle exam limits at the tool level, as the existing Metasploit lock does. (`fit.ts`, `msfvenom.ts` notes, the spec's "exam rules" lines)

## Found in 2b-C (payloads breadth, 2026-11-09)

- [ ] **The CommandList multi-block Transfer test picks blocks by position,** so adding a block silently changes what it checks. Pick them by name.
- [ ] **Listener placeholders (`TARGET_IP`, `BIND_PORT`) are not reported as unresolved.** A bind-shell listener with no host IP copies with the placeholder in it and no warning.
- [ ] **The Filter chip shows on msfvenom in injection contexts,** though msfvenom never takes a filter. Show it only for Shell.
- [ ] **The "Listener" chip label under "Connect from Kali" reads oddly.** Rename it for bind shells.
- [ ] **Tools inferred from the log can be overridden but not cleared.** Add a way back to "from your log".
- [ ] **`listKey` uses `JSON.stringify(tools)`,** which depends on key order. Sort the entries first.
- [ ] **`fakeApi` `payloadBuildRecord` lacks the empty-`payloadId` check** the real command has, so the audit backend accepts a record the app would refuse.
- [x] **The WAR duplicate can now use `os: "any"`.** Merge the Linux and Windows WAR entries into one (see the Java WAR item above).
