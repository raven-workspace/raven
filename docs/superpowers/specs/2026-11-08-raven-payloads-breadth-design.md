# Raven Payloads: breadth, toggles and owner control (2b-C)

Date: 2026-11-08. Builds on 2b-B Payloads (merged as PR #11). Read the 2b design first: `docs/superpowers/specs/2026-11-07-raven-interpreters-and-payloads-design.md` §4. Its "works as pasted" contract, explanation rule and keyboard rules still apply unchanged.

## 1. Why

Payloads now has fewer payloads than the old pwndash generator. pwndash had about 130 shell entries, copied from revshells.com, and most had no explanation. Most of that volume was near-duplicates:

- ten PHP variants that differ only in the exec function;
- four bash variants of the same `/dev/tcp` idea;
- six PowerShell variants of the same TCPClient.

Collapsed into distinct situations, pwndash covered several that Raven doesn't.

The owner doesn't want volume for its own sake. They want **every situation they meet covered by reliable options**, while staying **in control**: Raven suggests, and the owner decides.

## 2. The control principle (owner's decision)

- **The reliables are always there.** The owner's go-to payloads are the current reverse-shell catalogue, which was written from their Field Manual card `02-Cards/Shells-and-Transfers/Reverse-Shells.md` and their PEN-200 lab notes:
  - Linux: `bash-tcp`, `mkfifo-nc`, `mkfifo-nc-bg`, `python3`, `php-exec`.
  - Windows: `ps-b64`, `powercat-cradle`, `nishang-cradle`, `nc-exe`.

  A toggle or inference never folds away a reliable that works in the chosen OS and paste context.
- **Everything else is an option.** New payloads add choices; they don't crowd the reliables.
- **Toggles are advanced filters the owner sets.** Raven never flips one on its own. When Raven sees a clue, the chip turns amber and shows the clue (for example "Callbacks failed here twice"), and the decision stays with the owner. The owner may set a toggle because of a clue Raven can't see.
- **Inference only pre-fills.** OS, paste context, port and the toggles start from what Raven saw. The owner overrides any of them, and the override sticks for that host, as overrides do today.
- **Organised by where you paste.** "Where you paste it" stays the main way to choose. Situations that are about *where* the payload runs are new paste contexts. Situations that are about the *network or box* are toggles.

## 3. Goals

### 3.1 New paste contexts

Each is a `PasteContext` with a label, an OS (or "any"), and payloads that work there as pasted:

| Context (label) | Payloads | Notes |
|---|---|---|
| **Uploaded file** | PHP `?cmd=` web shell; ASPX `?cmd=` web shell; JSP `?cmd=` web shell; PentestMonkey PHP reverse shell (full file, Linux); Ivan Sincek PHP reverse shell (full file, works on Windows and Linux) | Each shows the file to save (with its filename and extension), then the URL to trigger it (`http://<target>/<path>/<file>`, with the path as an editable placeholder). The full-file reverse shells take LHOST/LPORT and are `bakesIp`. |
| **Jenkins / Groovy console** | Groovy reverse shell (`String host=…; Process p=new ProcessBuilder(…)`), for Linux and for Windows (`cmd.exe`) | For the Jenkins script console and other Groovy evaluators. |
| **Node code** | Node.js `child_process` reverse shell | For Node RCE and SSTI in Node templates. |
| **Java code** | Java `Runtime.getRuntime().exec` reverse shell (bash `-c` array form for Linux, `cmd.exe` for Windows) | For deserialisation and expression-language RCE that runs Java. |

### 3.2 New reverse shells within the existing contexts

| Payload | Why it's here |
|---|---|
| Perl socket (`perl -e 'use Socket;…'`) | Almost every Linux box has perl when bash, python and nc are missing or restricted. |
| socat with a full TTY (`socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:…`) | Gives a proper TTY with no upgrade dance. Needs socat on the target, or a static binary transferred to it. |
| BusyBox nc `-e` | For BusyBox-only boxes, where `nc -e` exists through busybox. |
| awk (`awk 'BEGIN{s="/inet/tcp/0/…"…}'`) | For when gawk is present and nothing else is. |
| ConPtyShell (`Invoke-ConPtyShell`, served and run through an IEX cradle) | A fully interactive Windows shell. Needs the socat or `stty raw` listener, as noted. |
| PowerShell over TLS (`SslStream`) | For when traffic is inspected. Pairs with `ncat --ssl` or `openssl s_server`. |

### 3.3 Bind shells

`nc` (mkfifo, Linux), `nc.exe -e` (Windows, same build note as `nc-exe`), `socat` (TTY), `python3` and PowerShell (`TcpListener`). They work in the same paste contexts as their reverse counterparts. The "listener" step becomes **Connect from Kali**: `nc <target> <port>`, or the socat equivalent for socat. The target IP comes from the host, and the port is the bind port.

### 3.4 Toggles (advanced filters)

These are new chips next to OS, "where you paste it" and port, in both the drawer and the Workbench. Each is per host and sticks like the other overrides, and each has a ⌥ key.

- **Callbacks blocked** (`⌥B`). When on, bind shells come first in every context. Reverse shells are not folded: they move below the bind shells, each marked "needs a callback", and the reliables stay visible. Raven's clue (amber, never automatic): two or more payloads with a callback that failed on this host ("Callbacks failed here twice").
- **Filtered injection** (`⌥F`). Applies to the injection contexts: Injected command (Linux), URL / form parameter, and Web shell `?cmd=`. When on, it offers bypass wrappers on the current payload:
  - Linux: base64 wrapper (`echo <b64>|base64 -d|bash`), `${IFS}` for spaces, hex escapes (`$'\x..'`);
  - Windows: the base64 PowerShell form, which already avoids most characters.

  The owner picks the wrapper, and its parts explain what it avoids. It is a filter on the output, not a separate payload.
- **Tools on this box** (`⌥T`). The owner ticks tools they know are missing or present: bash, python3, perl, nc, nc with `-e`, socat, PowerShell, curl and wget. It pre-fills from output that proves a tool, as fit does today. Payloads whose required tool is ticked missing move down with "Needs X" and are not folded. If the missing tool is one a reliable needs, the reliable stays visible and marked.

### 3.5 Listeners

The listener choices are:

- penelope (the default);
- `rlwrap nc -lvnp`;
- socat TTY: `socat file:`tty`,raw,echo=0 tcp-listen:<port>`, for socat and ConPtyShell shells;
- `ncat --ssl -lvnp`, for the TLS PowerShell shell;
- `msfconsole -q -x "use multi/handler; set payload …; set LHOST …; set LPORT …; run"`, for staged and Meterpreter payloads.

The listener follows the payload: each payload names the listener it needs, and the owner can switch to any compatible one.

### 3.6 msfvenom: staged and Meterpreter return (owner's decision: no payload is banned on the exam)

Only some tools are banned or restricted on the exam. Metasploit is limited to one machine, and Raven already tracks that machine with the **Metasploit lock** (`Engagement.msfHostId`, exam-sim only).

- **Add:**
  - Windows x64: Meterpreter staged, Meterpreter stageless and shell staged (exe).
  - Linux x64: Meterpreter staged and Meterpreter stageless (elf).
  - PHP Meterpreter (raw).

  No macOS, Android or iOS payloads.
- **Listener:** these use `multi/handler` (§3.5).
- **Owner decision (2026-11-09): only Meterpreter is limited.** msfvenom, multi/handler and raw shells (staged or stageless, including `windows/x64/shell/reverse_tcp`) are unrestricted on the exam and never get a warning. Only Meterpreter payloads (`meterpreter: true`) touch the Metasploit lock, via `msfLockLine`:
  - no lock yet: an info line (not a warning), "Using Meterpreter here makes this your Metasploit machine";
  - locked to another host: a breach warning, "Metasploit is locked to <host>", and copying goes through the copy guard;
  - locked to this host, or outside exam-sim: no line.
- **Remove** the current "Not allowed in the exam" misfit reason and its meterpreter/staged id check (`fit.ts`). Update the 2b spec's "exam rules" lines to match.

### 3.7 Owner decisions carried from the follow-ups

- **Never use a payload built with a stale LHOST/LPORT.**
  - Raven remembers every copy of a `bakesIp` payload: ↵, Copy button and ⌘↵ alike. It stores which payload, on which host, with which LHOST/LPORT, and when. Payloads are not logged, so this is a small separate record (see §5).
  - When LHOST or LPORT has changed since that build, the payload view replaces the trigger with **"Rebuild first: built with 192.0.2.10:443, now 192.0.2.20:443"**. The rebuild command is on top. The trigger and serve commands are behind the copy guard until the rebuild command has been copied.
  - "Rebuild" means copying the build step (the msfvenom command, or the Nishang/powercat prepare step) with the current values.
- **The exam fold is gone:** see §3.6.

### 3.8 "Do first" fixes from the follow-ups

- The Transfer copy-guard hint says "↵ again"; it should name the key that copies there (⌘↵ or the Copy button). Make the guard's repeat key a parameter.
- `src/test/transferGenerator.test.tsx` (10.10.14.9) and `src/test/engines/interpret/peas.test.ts` (10.10.14.7) move to 192.0.2.x.
- The Nishang and powercat prepare paths need checking on Kali. The owner checks them in their next lab; the builder adds a note to the prepare step's parts naming the package they come from.

## 4. Non-goals and anti-goals

**Non-goals**
- The rest of `docs/superpowers/followups/2026-11-07-raven-2b-payloads.md` beyond §3.7–3.8. That is a later cleanup round.
- Web-attack payload families (XSS, LFI, SSTI detection, SQLi beyond the SQL generator). They belong to the Arsenal or a later round.
- HoaxShell, macOS, Android and iOS payloads, and the long tail of languages (Crystal, Dart, Vlang, Haskell, Lua, Rust, zsh).

**Anti-goals**
- Volume for its own sake: every added payload must name the situation it serves (§3).
- Raven deciding for the owner: a toggle flipping itself, or a reliable folded away by inference.
- A payload added without an explanation of each part, or without exact-output tests for each context it declares.
- Any fixture or test value taken from the owner's labs. All data stays synthetic (RFC 5737 IPs, example.test names).

## 5. Constraints

- **Stack and structure:** payload content stays in code under `src/engines/payloads/`, and UI stays in `src/features/payloads/`. CSS grid first, Ink theme, amber `--warn`, no red. The Arsenal still never ranks by host and never imports payload ranking code.
- **Keys:** new ⌥ chords must not clash with existing bindings (`⌥L`, `⌥H`, `⌥C`, `⌥O`, `⌥W`, `⌥1`–`⌥6`, global single letters). Check first; `⌥B`, `⌥F` and `⌥T` are the intent. The hint line lists them for the ranked generators.
- **Data safety:** the copy memory in §3.7 is new persistent data. A Rust migration (0013) adds it, and the backup runs before migrating, as for every schema change. It holds no payload text, only the payload id, host id, values and time.
- **Offline,** with no network calls.
- **Tests:**
  - Every new payload has exact-output tests for each context it declares.
  - Toggles and the stale-build block have UI tests.
  - The visual audit covers the new chips and the Uploaded file view at 900, 1100, 1280 and 1440.

## 6. Decided in conversation (owner)

- Breadth: cover situations, not volume. The seven situations in §3 are the list.
- Organise by "where you paste it". Network and box facts (like egress) are toggles.
- The owner controls everything. Toggles are advanced filters, Raven never flips them, and the reliables are always shown.
- The reliables are the current reverse-shell catalogue (§2).
- No payload is banned on the exam; only tools are restricted. Staged and Meterpreter come back, tied to the Metasploit lock.
- A payload built with a stale LHOST/LPORT must not be used until it is rebuilt.

## 7. My calls (the owner can overrule)

- Under the toggles, reverse shells are moved down and marked rather than folded, so nothing feels taken away.
- In exam-sim, Meterpreter on a non-locked host is shown with a warning and the copy guard, not hidden.
- The toggle keys are `⌥B`, `⌥F` and `⌥T`.
- The Uploaded file context shows the file, then the trigger URL, with an editable upload path.
- The copy memory for stale builds is its own small table, not log entries.

## 8. Left to the builder

- The exact one-liners and their parts, written from the Field Manual cards (`Reverse-Shells.md`, `Bind-Shells.md`, `Web-Shells.md`, `Listeners.md`, `Payload-Generation-msfvenom.md`) and checked against the "works as pasted" rules.
- How the Uploaded file view lays out the file and the URL in the drawer and the Workbench.
- How the Tools chip edits its list (a checklist popover is fine).
- Table and column names for the copy memory.
