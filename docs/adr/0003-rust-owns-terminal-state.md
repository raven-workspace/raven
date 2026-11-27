# Rust owns the terminal; xterm.js only draws it

Each session is a PTY (`portable-pty`) whose bytes the Rust backend feeds through libghostty-vt, which holds the screen, cursor, scrollback and OSC 133 command marks headlessly. Everything Raven files from a terminal (Log entries, evidence text, flags) is read from that Rust-side state as plain text, and hostile output is filtered in Rust before it reaches the webview. xterm.js in the webview only renders the filtered stream it receives over a binary Tauri Channel. We chose this because target output is hostile and the webview is the weakest trust boundary in the app: a renderer's idea of the screen is not evidence, and once the webview can write to a shell, XSS is RCE. It also means a webview reload, a vault lock or a later popped-out window reattaches to state Rust already holds, and a future agent can read a session without a rewrite.

## Considered options

- **xterm.js as the source of truth** (capture read from its buffer or serialize addon): simplest, but puts evidence and filtering on the wrong side of the trust boundary.
- **libghostty-vt compiled to WebAssembly as the renderer:** one emulator instead of two, but rebuilds rendering, selection, input encoding, links, search and accessibility that xterm.js already has. Revisit only if xterm.js becomes a limit.

## Consequences

- Two emulators parse the same bytes and can disagree. Evidence follows libghostty-vt; a CI corpus of recorded tool output (nmap, linPEAS, msfconsole, vim, htop) fails the build on any difference.
- Building needs a pinned Zig toolchain for libghostty-vt, so the terminal sits behind a Cargo feature that a plain `tauri dev` does not need.
