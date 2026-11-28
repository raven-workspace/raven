//! The terminal spike's proof (RAV-69): bytes from a real PTY, read back from libghostty-vt as
//! plain text and OSC 133 marks. Runs with `cargo test --features terminal`.
#![cfg(feature = "terminal")]

use raven_lib::terminal::{MarkKind, Screen, SemanticRow, login_shell, run_to_exit};

/// What a shell with Raven's OSC 133 integration (docs/specs/terminal.md §5.2) prints for one
/// command, an nmap scan, then the next prompt. The test prints it with `printf` instead, so it
/// depends on no shell integration and on nothing in the user's dotfiles. `%%` is printf for `%`.
const SESSION: &str = concat!(
    "\\033]133;A\\007kali$ \\033]133;B\\007",
    "nmap -sV 192.0.2.5\\n",
    "\\033]133;C;cmdline_url=nmap%%20-sV%%20192.0.2.5\\007",
    "22/tcp open  ssh\\n80/tcp open  http\\n",
    "\\033]133;D;0\\007",
    "\\033]133;A\\007kali$ \\033]133;B\\007",
);

#[test]
fn printf_through_a_pty_reads_back_as_plain_text_and_osc_133_marks() {
    // `printf "$1"` keeps the format out of the shell's own quoting.
    let mut command = login_shell();
    command.args(["-c", "printf \"$1\"", "raven", SESSION]);
    let (screen, status) = run_to_exit(command, 80, 24).expect("run printf in a pty");
    assert!(status.success(), "printf exited with {status:?}");

    let text = screen.plain_text().unwrap();
    // A login shell may print its own banner first, so look for the session at the end.
    assert!(
        text.ends_with("kali$ nmap -sV 192.0.2.5\n22/tcp open  ssh\n80/tcp open  http\nkali$"),
        "plain text was {text:?}"
    );

    let marks = screen.marks();
    let kinds: Vec<MarkKind> = marks.iter().map(|mark| mark.kind).collect();
    assert_eq!(
        kinds,
        [
            MarkKind::PromptStart,
            MarkKind::InputStart,
            MarkKind::OutputStart,
            MarkKind::CommandEnd,
            MarkKind::PromptStart,
            MarkKind::InputStart,
        ]
    );
    let output_start = &marks[2];
    assert_eq!(output_start.command, b"nmap -sV 192.0.2.5");
    assert_eq!(marks[3].exit_code, Some(0));

    // The prompt row, split by what OSC 133 tagged each cell as.
    let prompt_row = marks[0].row;
    assert_eq!(
        screen.semantic_row(prompt_row).unwrap(),
        SemanticRow {
            prompt: "kali$".into(),
            input: "nmap -sV 192.0.2.5".into(),
            output: String::new(),
        }
    );
    assert_eq!(
        screen.semantic_row(prompt_row + 1).unwrap(),
        SemanticRow { output: "22/tcp open  ssh".into(), ..SemanticRow::default() }
    );

    // The command's output alone, as Capture will file it.
    assert_eq!(
        screen.command_output(output_start.row).unwrap().as_deref(),
        Some("22/tcp open  ssh\n80/tcp open  http")
    );
}

#[test]
fn scrollback_keeps_what_scrolled_off_the_screen() {
    let mut screen = Screen::new(40, 5).unwrap();
    for line in 1..=500 {
        screen.feed(format!("line {line}\r\n").as_bytes());
    }
    assert!(screen.scrollback_rows().unwrap() >= 495);
    let text = screen.plain_text().unwrap();
    assert!(text.starts_with("line 1\nline 2\n"), "plain text began {:?}", &text[..40]);
    assert!(text.ends_with("line 499\nline 500"));
}
