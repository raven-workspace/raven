# Raven: built-in terminal and the IDE relayout (v1)

> **In progress** (written 2026-11-26). This spec records the decisions and reasoning for v1 of the terminal and the layout built around it. It is frozen once v1 ships. For how Raven works now, read `PRODUCT.md`, `DESIGN.md` and the code; where this spec and the app differ, the app wins.

Date: 2026-11-26.
Linear: the Terminal Emulator project (RAV-69 to RAV-90), with its foundations in Raven Workspace CE (RAV-65 to RAV-68).
Source documents: the Notion pages "Raven Terminal: Feature Spec" (requirements FR-1 to FR-18, SR-1 to SR-7) and "Raven Workspace IDE layout" (the design spec, with every measurement read off the artboards). This file carries the decisions and reasoning, so an agent can work without Notion; the two pages hold the full tables of sizes, colours and states. Requirement ids (FR-n, SR-n) and section numbers (design §n) below refer to them.
Figma: the artboards the design spec was measured from are in the [Raven Workspace](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace) file (key `Z49qXmfYnFfPxk3qhECLme`). Open the frame for the area before building it; the frame map follows.
Decision record: `docs/adr/0003-rust-owns-terminal-state.md`. Vocabulary: `GLOSSARY.md`, sections Layout and Terminal.

### Frame map

Both artboards are 1440×900. There is no 1100px artboard, so the narrow-window rules (section 8 below) have no frame.

| Area | Design spec | Node |
|---|---|---|
| Host View artboard (whole window) | §1, §2.2 | [1-2612](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2612) |
| Chrome bar (Engagement, Target, search, Build report) | §1.3 | [1-2613](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2613) |
| Rail | §1.2 | [1-2642](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2642) |
| Explorer | §1.4 | [1-2701](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2701) |
| Editor tab strip | §2.1 | [1-2797](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2797) |
| Host page | §2.2 | [1-2814](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2814) |
| Terminal panel | §3 | [1-2911](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2911) |
| Status bar | §1.5–§1.7 | [1-2998](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2998) |
| Log entry tab artboard | §2.5 | [1-2187](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2187) |
| Log entry tab form | §2.5 | [1-2396](https://www.figma.com/design/Z49qXmfYnFfPxk3qhECLme/Raven-Workspace?node-id=1-2396) |

Read a frame through the Figma MCP: `create_session` with the file key, then `get_design_context` (sizes, colours, text) and `get_screenshot` (layout) on the node id. The Host View artboard (1-2612) renders with some text missing: the host name "forge" in the Explorer and in the host header, and the Next work tab. Many of its text layers have zero height, so this is a fault in the file, not in the Figma MCP. Take text from the design context rather than from Host View screenshots. The Log entry tab artboard (1-2187) renders completely and shows the same chrome bar, rail, Explorer, terminal panel and status bar, so use it as a second reference for those areas.

## 1. Intent

Today a tester runs commands in a separate terminal, copies the output into Raven, then rewrites it into a report. Each hop loses context (which host, when, which command) and costs time. Competitors start at the report; Raven starts at the shell.

v1 puts the shell inside Raven, scoped to the engagement, and turns every finished command into a Log entry on the host it touched. Raven's layout becomes IDE-shaped to make room for it: a chrome bar, a rail, an Explorer, editor tabs, a terminal panel under the editor and a status bar.

**The bar for v1: nobody should miss their external terminal.** If Raven's terminal does less than the one it replaces (history, completions, their own `.zshrc`), people won't bother with it, and Capture never gets the chance to help.

## 2. Goals, non-goals

**Goals**
- Shells run inside Raven, belonging to the engagement in view (FR-1, FR-2).
- Every finished command and its output becomes a Log entry automatically, on the right host, with no copy and paste (FR-11).
- Raven's "local and encrypted" promise holds for everything Raven itself writes (SR-6, §6).
- Raven runs on Kali Linux and on macOS (§3).

**Non-goals**
- Writing a terminal emulator or VT parser.
- A built-in multiplexer: tmux runs inside the terminal.
- v2 and later: Send to evidence, screen-state capture, pane screenshots, proof capture, IP and host links, listener counts (FR-5, FR-6, FR-10, FR-12, FR-13, FR-17); Arsenal suggestions, file-watch parsing, pop-out windows (FR-7, FR-8, FR-16); Windows and ConPTY (FR-9).

## 3. Platforms

**v1 targets Linux first.** The owner can't test the terminal live until Raven runs on Kali, where the tools are. Raven ships as a `.deb` for amd64 (PCs, lab boxes) and arm64 (Kali in a VM on Apple Silicon). macOS stays at parity.

- **Window chrome.** macOS keeps `titleBarStyle: Overlay`, with its native controls in the chrome bar. Linux keeps the desktop's own title bar above the chrome bar, and the chrome bar drops its 312px controls track. Custom-drawn window controls break under tiling window managers and Xfce themes, and are effort that doesn't help a tester.
- **Keys.** Every shortcut is defined once with a key per OS, and tooltips and the Shortcuts popover read from that definition. On Linux, Ctrl belongs to the shell and Ctrl+Shift+C/V is copy and paste in every terminal, so ⌘ can't simply become Ctrl:

| Where | macOS | Linux |
|---|---|---|
| Outside a terminal pane | ⌘ chords | Ctrl replaces ⌘ |
| Inside a terminal pane | ⌘ chords reach Raven; everything else goes to the shell | Plain Ctrl goes to the shell; Raven's chords are Ctrl+Shift; Ctrl+Shift+C/V copy and paste |
| Chords that already have Shift (⌘⇧C, ⌘⇧S, ⌘⇧W, ⌘⇧L) | as drawn | Ctrl+Alt+key, everywhere |
| ^\`, ^⇧\`, ^⇧M | as drawn | the same |

This matches VS Code and GNOME Terminal on Linux, so it feels normal on Kali.

## 4. How the work reaches the app

Branches go feature → `develop` → `main`, always; nothing is committed on `main`, hotfixes included. The owner and a second developer both run Raven from source with `npm run tauri dev`, and use it for real lab work while the overhaul is in progress. A half-built layout must never be what that command shows.

- **A startup switch, not a long-lived branch.** Overhaul PRs land on `develop` in small pieces. The new workspace shell renders only when started with `npm run tauri:overhaul`, which also turns on the `terminal` Cargo feature. Plain `npm run tauri dev` shows today's app. A long-lived integration branch was rejected: the relayout touches every page, so every fix to the old layout would conflict, and the final merge would be enormous. A release freeze was rejected because hotfixes have to pass through `develop`.
- **The `terminal` Cargo feature** keeps Zig and libghostty-vt out of a plain `tauri dev`, so a developer fixing a bug needs no extra toolchain.
- **Separate vaults.** Every debug run used to share one data folder (`raven-dev`), and older code refuses a vault that newer code has migrated. `tauri:overhaul` uses its own data folder (`raven-overhaul`), so a draft migration never touches the owner's lab vault.
- **The migration rule** (in CONTRIBUTING). A migration counts as released once it merges to `develop` and is never edited afterwards; a mistake gets a new migration. Until the old shell is removed, overhaul migrations only add tables or nullable columns. With this rule, plain `tauri dev` on `develop` is safe for real data for the whole overhaul.
- **Two shells for a while.** Shared pages (the host page, for one) must look right in both until the cutover issue (RAV-90) removes the old shell and the switch.

## 5. Terminal architecture

Recorded in ADR 0003. **Rust owns each terminal; xterm.js only draws it.**

- **PTY:** `portable-pty` 0.9.
- **State:** libghostty-vt, the MIT C library from Ghostty with a stable C ABI since 1.0. It is used through `libghostty-vt-sys` (the libghostty-rs repo), pinned to a git commit that supports vt-1.0.2, because the crates.io release (0.2.2) predates 1.0. Building it needs Zig 0.17, pinned and cached per target in CI. libghostty-vt holds the screen, scrollback and OSC 133 marks, and everything Raven files is read from it as plain text.
- **Renderer:** xterm.js with the `webgl`, `fit`, `search`, `serialize` and `web-links` addons, fed the filtered byte stream over a binary Tauri Channel batched every 5–16 ms. Options and the ANSI palette are in design §2.4. Red is allowed inside the terminal only, and green is kept distinct from Raven's accent, so tool output never reads as something Raven confirmed.
- **IPC:** `spawn(engagement_id)`, `write(session_id, bytes)`, `resize(session_id, cols, rows)` and `close(session_id)`, and nothing else. The shell comes from Rust (the user's login `$SHELL`), never from the frontend.
- **Two emulators can disagree.** Evidence follows libghostty-vt. CI plays recorded tool output (nmap, linPEAS, msfconsole menus, vim, htop) through both and fails on any difference.

### 5.1 Sessions

A **session** is one shell and its terminal state, owned by Rust and belonging to one engagement. Switching pages, tabs or engagements, hiding the panel or locking the vault never ends one; only closing it does. A webview reload reattaches to state Rust already holds.

- **Pinned host.** A session is pinned to the host that was Target when it opened, or to the engagement alone. The pin sets `$RHOST` and the tab label, and nothing else (Capture doesn't use it; see §7). Changing Target later doesn't retarget open sessions, so the shell's own `$RHOST` never goes stale.
- **Environment.** Shells start in the **engagement folder** with `RHOST`, `LHOST` and `RAVEN_ENGAGEMENT` set (FR-3).
- **Panes.** The split pane always shows a different session from the main pane, never a second view of the same one.

### 5.2 Shell integration

Raven injects OSC 133 itself, without editing dotfiles. zsh gets a Raven-owned `ZDOTDIR` that sources the user's real `.zshrc` and then adds the hooks; bash gets `--rcfile` doing the same. The user's prompt, plugins, autosuggestions and syntax highlighting all still load. This is how VS Code and Ghostty do it. PowerShell waits for the Windows phase.

### 5.3 History

Sessions never write a history file, so typed credentials never reach `~/.zsh_history` (SR-4). Turning history off alone would break ↑ across sessions and leave Kali's zsh autosuggestions empty, which fails the §1 bar. Instead:

- Every command line typed in a Raven session (never its output) is stored encrypted, per engagement, in the vault, whether Capture is on or off.
- A new session's history is preloaded through an inherited pipe (zsh `fc -R /dev/fd/N`, bash `history -r`), so it exists only in the shell's memory. First come this engagement's commands, then the user's own `~/.zsh_history` / `~/.bash_history`, read-only.
- Two sessions open at once don't share history live. A command typed in one appears in sessions opened after it.

This loosens FR-11's "the Log is the only record of terminal work": command lines now have a second, encrypted record. Output still has only the Log.

## 6. Security

- **SR-1:** XSS becomes RCE once the webview can write to a shell. Strict CSP, only the IPC calls in §5, locked down in Tauri capabilities.
- **SR-2:** target output is hostile. Rust filters it before the webview: OSC 52 clipboard writes are off or behind a prompt, and OSC 8 links and title changes are untrusted.
- **SR-3:** captured text is plain text from libghostty-vt, never ANSI.
- **SR-5 and SR-7, lock:** shells keep running behind the lock, because a lock must never kill a caught shell. The webview drops all terminal state. Rust keeps the last 1,000 lines per session in memory only, locked against swapping (`mlock`) and zeroised on close, on quit or on **Lock and clear**, and replays them on unlock. A per-engagement setting clears them on every lock, for engagements whose rules require it.
- **SR-6, narrowed:** Raven itself never writes terminal output or scrollback to disk outside the vault. The **engagement folder** is an ordinary, unencrypted directory where tools write their own files (`nmap -oA`, loot, linPEAS output). It sits outside Raven's encryption promise, and the UI says so. The original wording ("no terminal output reaches disk outside the vault") couldn't be kept while also starting shells in a real directory.

## 7. Capture

**Capture** means Raven filing each finished command and its output as a Log entry. It is per engagement and on by default, toggled with ⌘⇧C (Ctrl+Alt+C on Linux). The hand-entry tab is the **log entry tab**, and "capture" never names it.

- **Which host.** Capture uses Raven's existing attribution rules (`src/engines/attribution.ts`, `buildDraft` in `src/engines/capture/draft.ts`). The shell prompt's host comes first (`www-data@forge`; a `kali` prompt means the owner's own machine). Otherwise it is the hosts named in the command line, where a CIDR range, an IP range, an `--exclude` or a filename names no host. One addition: `$RHOST` / `${RHOST}` counts as naming the session's host, because `gobuster -u http://$RHOST` contains no IP. The session's host is never a fallback, so `nxc smb 10.10.11.0/24` from a forge session stays engagement-level instead of being misfiled on forge. Pasted and terminal commands follow one set of rules.
- **Noise.** The Log feeds the report's placement plan, so noise makes the report worse. Skipped: empty command lines, housekeeping builtins (`cd`, `pwd`, `clear`, `exit`, `history`, `export`, `alias`, `source`) and exit code 127 (command not found). `ls` and `cat` are kept, because they're often what proves something.
- **Interpreters** run on captured entries just as on pasted ones, and file what each proves.
- **Caught shells.** OSC 133 marks only come from Raven's local shell. In a caught shell (`nc -lvnp`, `ssh`, `evil-winrm`), everything is the output of one command that never ends, yet that is where proof happens. v1 splits the nested shell's output by prompt, using the same rules `splitPaste` already uses for pasted terminal text, and files each command when the next prompt appears. Injecting OSC 133 into caught shells through the Payloads shell-upgrade steps comes later.
- **Feedback.** A 2px accent mark sits beside each filed output line, and an inline notice reads "3 services captured to forge", with Undo (design §2.3).

## 8. Layout

Measurements, states and motion are in design §1 to §3. These are the decisions behind them.

- **Rail:** Explorer, Terminals, then the six sections in Raven's own order (so 1–6 count down the rail; Report keeps 7, as the chrome bar's Build report button), then Field notes, Arsenal, Payloads and Manual. Payloads wasn't drawn on the artboard; it was added so it keeps a home once its drawer goes. Terminals shows and hides the terminal panel like ^\`. A sessions page was rejected, because the panel's own tabs already list the sessions.
- **Editor tabs:** the active tab is the URL route, and the open tabs are a list of routes, so deep links, Esc-back and the ⌘K palette keep working. A page is open in at most one tab. Each engagement remembers its open tabs; only route ids go in localStorage, never names, so no engagement data sits on disk unencrypted.
- **Drawers retired.** Arsenal, Manual, Payloads and Field notes open as editor tabs inside an engagement, and as full pages from the Dashboard. The Arsenal, Payloads and Notes drawers go away.
- **Outside an engagement:** the Dashboard shows the chrome bar and the engagement list only, with no rail, Explorer or terminal, because a session always belongs to an engagement. Settings stays a full page.
- **Target** is the host in view, set both by the Target picker and by selecting a host. On a page with no host it keeps the last host picked.
- **Letter keys stay:** A Arsenal, M Manual, P Payloads, N Field notes, L the log entry tab, and 1–7 the sections. None of them fire while a terminal pane has focus.
- **Narrow windows:** 1100px minimum. The split pane gives way before the main pane drops below 480px. Status bar cells drop in the strip's existing order, and Timebox and LHOST never drop.

## 9. Keys inside the terminal

Rule (FR-18): while a terminal pane has focus, every key without ⌘ goes to the shell, except ^\` and ^⇧\`.

- Esc never blurs the terminal. `useEscapeTo` and `useEscapeBack` return early inside `[data-terminal]`. Esc only ever escapes; it never selects or acts.
- ⌘ chords reach Raven. ⌘C copies the selection, ⌘V pastes as bracketed paste, and ^C goes to the shell.
- The terminal root carries `data-hint-surface`, so `?` types a question mark.
- Send to terminal (⌘↵) types a command block's filled command into the focused session **without Enter**, so the owner reads it before it runs.
- The Linux variants follow §3.

## 10. Order of work

1. **Foundations, shipped to `main` first** (RAV-65 to RAV-68): separate dev vault and the CONTRIBUTING rules, the CI build and test matrix, the Linux `.deb`, and the per-OS key map. The owner then runs the current app on Kali for labs before any terminal work lands.
2. **Terminal core** (RAV-69 spike, then RAV-71 to RAV-73, RAV-81 to RAV-85). The spike comes first because libghostty-vt plus Zig is v1's biggest unknown.
3. **Relayout** (RAV-70, RAV-74 to RAV-80), in parallel with step 2.
4. **Terminal in the layout** (RAV-86 to RAV-89), after steps 2 and 3.
5. **Cutover** (RAV-90): the new shell becomes the default, the old shell and the switch are removed, and DESIGN.md, PRODUCT.md, CONTRIBUTING and README are updated.

## 11. Success measure

Add the terminal to the planned timed task: five OSCP or CPTS students, their current setup against Raven, measuring the time from root to a finished write-up.
