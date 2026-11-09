import type { PayloadDef } from "./types";

const PENELOPE = "penelope upgrades on its own: skip all of these steps when you caught the shell with penelope.";

function step(
  id: string, title: string, template: string, token: string, explain: string,
  extra: Partial<PayloadDef> = {}, notes: string[] = [],
): PayloadDef {
  return {
    id, generator: "upgrade", title, os: "linux", contexts: ["bash-prompt"], requires: [],
    template, parts: [{ token, explain }], listeners: [], notes, ...extra,
  };
}

/**
 * Steps in the order to run them, on a netcat-style shell. Each says where it runs: on the target (inside the caught
 * shell) or in your own terminal on Kali (`runsOn: "kali"`); Ctrl-Z is a key to press, not text to copy.
 */
export const UPGRADE: PayloadDef[] = [
  step("upgrade-1-pty-python", "1. Spawn a PTY (python3)", `python3 -c 'import pty; pty.spawn("/bin/bash")'`, "pty.spawn",
    "Wraps bash in a pseudo-terminal, which gives you a prompt, job control and working su/sudo. Try python if python3 is missing.",
    {}, [PENELOPE, "No python? Use the script step instead."]),
  step("upgrade-1-pty-script", "1. Spawn a PTY (script)", "script -qc /bin/bash /dev/null", "script -qc",
    "-q: quiet; -c: run bash as the command; /dev/null: throw the typescript away. An alternative to python when it is absent.",
    {}, [PENELOPE]),
  step("upgrade-2-background", "2. Background the shell", "Ctrl-Z", "Ctrl-Z",
    "Suspends the netcat session and drops you at your own terminal. A keypress, not a command.", { runsOn: "kali", keypress: true }),
  step("upgrade-3-raw", "3. Raw terminal, foreground", "stty raw -echo; fg", "stty raw -echo",
    "Passes your keystrokes straight through (Tab, arrows, Ctrl-C reach the target) and stops local echo. fg brings the shell back. Press Enter twice if nothing shows.",
    { runsOn: "kali" }, ["Run this in YOUR terminal, not the target's, right after Ctrl-Z."]),
  step("upgrade-4-term", "4. Set TERM", "export TERM=xterm-256color", "TERM=xterm-256color",
    "Tells programs such as clear, nano and less what the terminal can do."),
  step("upgrade-5-size", "5. Match the window size", "stty rows {ROWS} cols {COLS}", "stty rows {ROWS} cols {COLS}",
    "Without this full-screen editors wrap wrongly. Read your own size with `stty size` in another terminal.",
    { defaults: { ROWS: "40", COLS: "160" } }),
  step("upgrade-6-home", "6. Fix HOME", "export HOME=/home/{USER}", "HOME=/home/{USER}",
    "Points HOME at the right account so ssh keys, history and dotfiles land in the right place.",
    {}, ["when the shell inherited root's HOME"]),
];
