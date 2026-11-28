//! The shell a session runs, and Raven's shell integration (docs/specs/terminal.md §5.2, §5.3).
//!
//! Raven never edits dotfiles. zsh gets a Raven-owned `ZDOTDIR` whose startup files source the user's own, then add
//! OSC 133 marks and Raven's history; bash gets `--rcfile` doing the same. Either way the shell writes no history
//! file (SR-4): it reads the user's own history file, then this engagement's command lines through an inherited pipe
//! (`/dev/fd/3`), so they exist only in the shell's memory. Engagement commands load last, so ↑ finds them first.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;

/// The file descriptor a session's shell reads its preloaded history from.
pub const HISTORY_FD: i32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Zsh,
    Bash,
    /// Any other shell: started as a login shell with no integration or preloaded history.
    Other,
}

impl ShellKind {
    pub fn of(shell: &Path) -> ShellKind {
        match shell.file_name().and_then(OsStr::to_str) {
            Some("zsh") => ShellKind::Zsh,
            Some("bash") => ShellKind::Bash,
            _ => ShellKind::Other,
        }
    }

    /// Whether this shell reads Raven's history pipe.
    pub fn preloads_history(self) -> bool {
        self != ShellKind::Other
    }
}

/// The user's login shell, `$SHELL`, or `/bin/sh` when it is unset. It always comes from Rust, never the webview.
pub fn login_shell_path() -> PathBuf {
    std::env::var_os("SHELL").filter(|shell| !shell.is_empty()).map(PathBuf::from).unwrap_or_else(|| "/bin/sh".into())
}

/// Everything a session's environment carries beyond what Raven inherited (docs/specs/terminal.md §5.1).
#[derive(Debug, Clone, Default)]
pub struct SessionEnv {
    /// `RAVEN_ENGAGEMENT`: the engagement's name.
    pub engagement: String,
    /// `RHOST`: the pinned host's address. Unset for a session pinned to the engagement alone.
    pub rhost: Option<String>,
    /// `LHOST`: Settings → Your IP. Unset while that is blank.
    pub lhost: Option<String>,
}

/// Build the command for `shell` starting in `cwd`. `integration_dir` holds the files `write_integration` wrote;
/// `overrides` are set last (tests use them to give the shell its own `HOME`).
pub fn command(
    shell: &Path,
    integration_dir: &Path,
    cwd: &Path,
    env: &SessionEnv,
    preload: bool,
    overrides: &[(OsString, OsString)],
) -> Command {
    let kind = ShellKind::of(shell);
    let mut cmd = Command::new(shell);
    cmd.current_dir(cwd);

    // Raven's own variables (RAVEN_DATA_DIR and the like) stay out of the shell.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("RAVEN_") {
            cmd.env_remove(&key);
        }
    }
    // A terminal-specific history setup must never run: macOS's Apple_Terminal one writes ~/.zsh_sessions.
    for key in ["TERM_SESSION_ID", "TERM_PROGRAM_VERSION", "SHELL_SESSION_HISTORY", "ITERM_SESSION_ID"] {
        cmd.env_remove(key);
    }
    cmd.env("TERM", "xterm-256color").env("COLORTERM", "truecolor").env("TERM_PROGRAM", "Raven");
    cmd.env("RAVEN_ENGAGEMENT", &env.engagement);
    match &env.rhost {
        Some(rhost) => cmd.env("RHOST", rhost),
        None => cmd.env_remove("RHOST"),
    };
    match &env.lhost {
        Some(lhost) => cmd.env("LHOST", lhost),
        None => cmd.env_remove("LHOST"),
    };
    for (key, value) in overrides {
        cmd.env(key, value);
    }
    if preload && kind.preloads_history() {
        cmd.env("RAVEN_HISTORY_FD", HISTORY_FD.to_string());
    }

    match kind {
        ShellKind::Zsh => {
            let lookup = |key: &str| {
                overrides
                    .iter()
                    .find(|(k, _)| k == key)
                    .map(|(_, value)| value.clone())
                    .or_else(|| std::env::var_os(key))
                    .filter(|value| !value.is_empty())
            };
            let user_zdotdir = lookup("ZDOTDIR").or_else(|| lookup("HOME")).unwrap_or_default();
            cmd.env("RAVEN_USER_ZDOTDIR", user_zdotdir);
            cmd.env("ZDOTDIR", integration_dir.join("zsh"));
            cmd.arg("-l");
        }
        ShellKind::Bash => {
            // bash ignores --rcfile in a login shell, so raven.bash runs the login files itself.
            cmd.arg("--rcfile").arg(integration_dir.join("bash").join("raven.bash")).arg("-i");
        }
        ShellKind::Other => {
            // No integration: at least don't hand the shell a history file to write.
            cmd.env("HISTFILE", "");
            cmd.arg("-l");
        }
    }
    cmd
}

/// Write Raven's shell integration files under `dir`, replacing older copies.
pub fn write_integration(dir: &Path) -> std::io::Result<()> {
    let zsh = dir.join("zsh");
    let bash = dir.join("bash");
    std::fs::create_dir_all(&zsh)?;
    std::fs::create_dir_all(&bash)?;
    for (name, body) in ZSH_FILES {
        std::fs::write(zsh.join(name), body)?;
    }
    std::fs::write(bash.join("raven.bash"), BASH_RC)?;
    Ok(())
}

/// The history a session's shell reads from the pipe, in its own history-file format: one command per entry,
/// oldest first.
pub fn history_bytes(kind: ShellKind, commands: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    for command in commands {
        let command = command.trim_end_matches('\n');
        if command.trim().is_empty() {
            continue;
        }
        match kind {
            // zsh history: a newline inside a command is escaped with a backslash, and the bytes are metafied.
            ShellKind::Zsh => {
                for &b in command.as_bytes() {
                    if b == b'\n' {
                        out.extend_from_slice(b"\\\n");
                    } else {
                        metafy(b, &mut out);
                    }
                }
            }
            // bash history: one line per entry.
            ShellKind::Bash | ShellKind::Other => {
                out.extend(command.bytes().map(|b| if b == b'\n' { b' ' } else { b }));
            }
        }
        out.push(b'\n');
    }
    out
}

/// zsh's metafication (zsh's `metafy`): NUL and the bytes from Meta (0x83) to Marker (0xa2) are written as Meta
/// followed by the byte XOR 32, as zsh writes them into its own history file.
fn metafy(b: u8, out: &mut Vec<u8>) {
    const META: u8 = 0x83;
    const MARKER: u8 = 0xa2;
    if b == 0 || (META..=MARKER).contains(&b) {
        out.push(META);
        out.push(b ^ 32);
    } else {
        out.push(b);
    }
}

/// zsh startup files. Each sources the user's file of the same name with `ZDOTDIR` pointing at the user's own
/// folder, then puts Raven's back for the next file; `.zlogin`, the last one, leaves the user's in place.
const ZSH_FILES: [(&str, &str); 5] = [
    (
        ".zshenv",
        r#"# Raven's shell integration (docs/specs/terminal.md §5.2). Raven points ZDOTDIR here and each file sources the
# user's own file of the same name. Nothing here writes a file.
__raven_zdotdir=$ZDOTDIR
if [[ -r ${RAVEN_USER_ZDOTDIR:-$HOME}/.zshenv ]]; then
  ZDOTDIR=${RAVEN_USER_ZDOTDIR:-$HOME}
  builtin source "$ZDOTDIR/.zshenv"
  # The user's .zshenv may move ZDOTDIR: their other files are there.
  RAVEN_USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$__raven_zdotdir
fi
"#,
    ),
    (
        ".zprofile",
        r#"if [[ -r $RAVEN_USER_ZDOTDIR/.zprofile ]]; then
  ZDOTDIR=$RAVEN_USER_ZDOTDIR
  builtin source "$ZDOTDIR/.zprofile"
  ZDOTDIR=$__raven_zdotdir
fi
"#,
    ),
    (
        ".zshrc",
        r#"if [[ -r $RAVEN_USER_ZDOTDIR/.zshrc ]]; then
  ZDOTDIR=$RAVEN_USER_ZDOTDIR
  builtin source "$ZDOTDIR/.zshrc"
  ZDOTDIR=$__raven_zdotdir
fi
builtin source "$__raven_zdotdir/raven-integration.zsh"
"#,
    ),
    (
        ".zlogin",
        r#"if [[ -r $RAVEN_USER_ZDOTDIR/.zlogin ]]; then
  ZDOTDIR=$RAVEN_USER_ZDOTDIR
  builtin source "$ZDOTDIR/.zlogin"
fi
# Never a history file, even if the user's .zlogin named one.
unset HISTFILE
ZDOTDIR=$RAVEN_USER_ZDOTDIR
unset RAVEN_USER_ZDOTDIR __raven_zdotdir
"#,
    ),
    (
        "raven-integration.zsh",
        r#"# History (SR-4): read the user's history file, never write it, then this engagement's commands from Raven's
# pipe. zsh loads and saves $HISTFILE itself only while it is set.
__raven_histfile=${HISTFILE:-$RAVEN_USER_ZDOTDIR/.zsh_history}
# macOS's /etc/zshrc names a file in ZDOTDIR, which was Raven's at the time: the user's is in theirs.
[[ $__raven_histfile == $__raven_zdotdir/* ]] && __raven_histfile=$RAVEN_USER_ZDOTDIR/${__raven_histfile:t}
unset HISTFILE
(( ${HISTSIZE:-0} < 10000 )) && HISTSIZE=10000
[[ -r $__raven_histfile ]] && builtin fc -R "$__raven_histfile"
if [[ -n $RAVEN_HISTORY_FD ]]; then
  builtin fc -R "/dev/fd/$RAVEN_HISTORY_FD"
  # Close the pipe so nothing the shell runs inherits it.
  builtin exec {RAVEN_HISTORY_FD}<&-
fi
unset __raven_histfile RAVEN_HISTORY_FD

# OSC 133 marks: A prompt, B input, C output with the command line, D finished with its exit code.
__raven_ran=0
__raven_urlencode() {
  emulate -L zsh
  local LC_ALL=C s=$1 out= c
  local -i i
  for (( i = 1; i <= ${#s}; i++ )); do
    c=${s[i]}
    if [[ $c == [A-Za-z0-9._~/-] ]]; then
      out+=$c
    else
      out+=%${(l:2::0:)$(( [##16] #c & 255 ))}
    fi
  done
  builtin print -rn -- $out
}
__raven_precmd() {
  local ret=$?
  (( __raven_ran )) && builtin print -n "\e]133;D;$ret\a"
  __raven_ran=0
}
__raven_prompt() {
  # A theme may rebuild PS1 before each prompt; put the marks back around it.
  [[ $PS1 == *$'\e]133;B'* ]] || PS1=$'%{\e]133;A\a%}'$PS1$'%{\e]133;B\a%}'
}
__raven_preexec() {
  builtin print -n "\e]133;C;cmdline_url=$(__raven_urlencode "$1")\a"
  __raven_ran=1
}
# D first, before anything else prints; the prompt marks last, after any theme.
precmd_functions=(__raven_precmd $precmd_functions __raven_prompt)
preexec_functions+=(__raven_preexec)
"#,
    ),
];

/// bash's `--rcfile`: the login startup files, as `bash -l` would read them, then history and OSC 133 marks.
const BASH_RC: &str = r#"# Raven's shell integration (docs/specs/terminal.md §5.2). Nothing here writes a file.
[[ -r /etc/profile ]] && . /etc/profile
for __raven_f in ~/.bash_profile ~/.bash_login ~/.profile; do
  if [[ -r $__raven_f ]]; then . "$__raven_f"; break; fi
done
unset __raven_f

# History (SR-4): read the user's history file, never write it, then this engagement's commands from Raven's pipe.
__raven_histfile=${HISTFILE:-~/.bash_history}
unset HISTFILE
[[ -r $__raven_histfile ]] && builtin history -r "$__raven_histfile"
if [[ -n $RAVEN_HISTORY_FD ]]; then
  # One entry per line. Not `history -r /dev/fd/N`: bash sizes the file first, and on Linux a pipe has size 0.
  while IFS= read -r __raven_line; do
    builtin history -s "$__raven_line"
  done <&"$RAVEN_HISTORY_FD"
  eval "exec $RAVEN_HISTORY_FD<&-"
  unset __raven_line
fi
unset __raven_histfile RAVEN_HISTORY_FD

# OSC 133 marks: A prompt, B input, C output with the command line, D finished with its exit code.
__raven_ran=
__raven_ready=
__raven_urlencode() {
  local LC_ALL=C s=$1 out= c i
  for (( i = 0; i < ${#s}; i++ )); do
    c=${s:i:1}
    case $c in
      [a-zA-Z0-9._~/-]) out+=$c ;;
      # A byte over 127 can print sign-extended (FFFFFFC3): its last two digits are the byte.
      *) printf -v c '%02X' "'$c"; out+=%${c: -2} ;;
    esac
  done
  printf '%s' "$out"
}
__raven_precmd() {
  local ret=$?
  [[ -n $__raven_ran ]] && printf '\033]133;D;%s\007' "$ret"
  __raven_ran=
  __raven_last=$(HISTTIMEFORMAT= builtin history 1)
  [[ $PS1 == *'133;B'* ]] || PS1='\[\033]133;A\007\]'"$PS1"'\[\033]133;B\007\]'
}
__raven_prompt_ready() {
  __raven_ready=1
}
__raven_preexec() {
  [[ -n $__raven_ready && -z $COMP_LINE ]] || return 0
  __raven_ready=
  local entry cmd=
  entry=$(HISTTIMEFORMAT= builtin history 1)
  # A command history doesn't keep (HISTCONTROL=ignorespace) leaves the last entry as it was: send no command line.
  if [[ $entry != "$__raven_last" && $entry =~ ^[[:space:]]*[0-9]+\*?[[:space:]]+(.*)$ ]]; then
    cmd=${BASH_REMATCH[1]}
  fi
  printf '\033]133;C;cmdline_url=%s\007' "$(__raven_urlencode "$cmd")"
  __raven_ran=1
}
PROMPT_COMMAND="__raven_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}; __raven_prompt_ready"
trap '__raven_preexec' DEBUG
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_zsh_and_bash_by_name() {
        assert_eq!(ShellKind::of(Path::new("/bin/zsh")), ShellKind::Zsh);
        assert_eq!(ShellKind::of(Path::new("/usr/local/bin/bash")), ShellKind::Bash);
        assert_eq!(ShellKind::of(Path::new("/usr/bin/fish")), ShellKind::Other);
    }

    #[test]
    fn zsh_history_escapes_newlines_and_metafies() {
        let commands = vec!["id".to_string(), "for i in 1 2\ndo echo $i; done".into(), "echo ă".into(), " ".into()];
        let bytes = history_bytes(ShellKind::Zsh, &commands);
        // "ă" is C4 83: 0x83 is Meta itself, written as 83 A3.
        assert_eq!(bytes, b"id\nfor i in 1 2\\\ndo echo $i; done\necho \xc4\x83\xa3\n");
    }

    #[test]
    fn bash_history_is_one_line_per_command() {
        let commands = vec!["id".to_string(), "a\nb".into()];
        assert_eq!(history_bytes(ShellKind::Bash, &commands), b"id\na b\n");
    }

    #[test]
    fn the_environment_carries_the_engagement_and_hosts_and_no_raven_internals() {
        let env = SessionEnv { engagement: "Forge".into(), rhost: Some("192.0.2.5".into()), lhost: None };
        let cmd = command(Path::new("/bin/zsh"), Path::new("/i"), Path::new("/w"), &env, true, &[]);
        let vars: Vec<(String, Option<String>)> = cmd
            .get_envs()
            .map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned())))
            .collect();
        let get = |key: &str| vars.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        assert_eq!(get("RHOST"), Some(Some("192.0.2.5".into())));
        assert_eq!(get("LHOST"), Some(None), "removed, not inherited");
        assert_eq!(get("RAVEN_ENGAGEMENT"), Some(Some("Forge".into())));
        assert_eq!(get("RAVEN_HISTORY_FD"), Some(Some("3".into())));
        assert_eq!(get("ZDOTDIR"), Some(Some("/i/zsh".into())));
        assert_eq!(get("TERM_PROGRAM"), Some(Some("Raven".into())));
        assert_eq!(cmd.get_current_dir(), Some(Path::new("/w")));
        assert_eq!(cmd.get_args().collect::<Vec<_>>(), ["-l"]);
    }
}
