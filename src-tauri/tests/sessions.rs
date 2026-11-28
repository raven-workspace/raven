//! The session manager through real PTYs and real shells (RAV-71, docs/specs/terminal.md §5.1–§5.3). Each test
//! gives the shell its own `HOME` with a small `.zshrc` / `.bash_profile`, so nothing depends on the machine's
//! dotfiles and nothing touches them. Runs with `cargo test --features terminal`; zsh and bash must be installed.
#![cfg(feature = "terminal")]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use raven_lib::terminal::Screen;
use raven_lib::terminal::session::{
    HistorySink, OutputSink, PinnedHost, SessionEvents, SessionInfo, SessionManager, ShellConfig, SpawnRequest,
};

#[derive(Clone, Default)]
struct Buffer(Arc<Mutex<Vec<Vec<u8>>>>);

impl Buffer {
    fn messages(&self) -> Vec<Vec<u8>> {
        self.0.lock().unwrap().clone()
    }
}

impl OutputSink for Buffer {
    fn send(&mut self, bytes: Vec<u8>) -> bool {
        self.0.lock().unwrap().push(bytes);
        true
    }
}

#[derive(Default)]
struct History(Mutex<Vec<(String, String)>>);

impl History {
    fn of(&self, engagement_id: &str) -> Vec<String> {
        let lines = self.0.lock().unwrap();
        lines.iter().filter(|(e, _)| e == engagement_id).map(|(_, c)| c.clone()).collect()
    }
}

impl HistorySink for History {
    fn record(&self, engagement_id: &str, command: &str) {
        self.0.lock().unwrap().push((engagement_id.into(), command.into()));
    }
}

#[derive(Default)]
struct Exits(Mutex<Vec<(String, Option<i32>)>>);

impl SessionEvents for Exits {
    fn exited(&self, info: &SessionInfo, exit_code: Option<i32>) {
        self.0.lock().unwrap().push((info.id.clone(), exit_code));
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    home: PathBuf,
    folder: PathBuf,
    manager: SessionManager,
    history: Arc<History>,
    exits: Arc<Exits>,
}

fn shell_path(name: &str) -> PathBuf {
    for dir in ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"] {
        let path = Path::new(dir).join(name);
        if path.exists() {
            return path;
        }
    }
    panic!("{name} is not installed; the session tests need it");
}

/// A manager running `shell` with its own HOME holding `files`.
fn rig(shell: &str, files: &[(&str, &str)]) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    // macOS temp folders sit behind a symlink; the shell's $PWD shows the real path.
    let root = dir.path().canonicalize().unwrap();
    let home = root.join("home");
    let folder = root.join("Raven").join("forge");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&folder).unwrap();
    for (name, body) in files {
        std::fs::write(home.join(name), body).unwrap();
    }
    let history = Arc::new(History::default());
    let exits = Arc::new(Exits::default());
    let config = ShellConfig {
        shell: shell_path(shell),
        integration_dir: root.join("integration"),
        env: vec![
            (OsString::from("HOME"), home.clone().into_os_string()),
            (OsString::from("ZDOTDIR"), home.clone().into_os_string()),
        ],
    };
    let manager = SessionManager::new(config, history.clone(), exits.clone());
    Rig { _dir: dir, home, folder, manager, history, exits }
}

impl Rig {
    fn spawn(&self, host: Option<PinnedHost>) -> (SessionInfo, Buffer) {
        let out = Buffer::default();
        let request = SpawnRequest {
            engagement_id: "e1".into(),
            engagement_name: "Forge".into(),
            host,
            lhost: Some("192.0.2.200".into()),
            folder: self.folder.clone(),
            history: self.history.of("e1"),
            cols: 100,
            rows: 30,
        };
        let info = self.manager.spawn(request, Box::new(out.clone())).expect("spawn a session");
        (info, out)
    }

    fn text(&self, session: &SessionInfo) -> String {
        self.manager.plain_text(&session.id).unwrap()
    }

    /// Wait until the session's screen satisfies `ok`, and return its text.
    fn wait_for(&self, session: &SessionInfo, what: &str, ok: impl Fn(&str) -> bool) -> String {
        let start = Instant::now();
        loop {
            let text = self.text(session);
            if ok(&text) {
                return text;
            }
            assert!(start.elapsed() < Duration::from_secs(15), "timed out waiting for {what}; screen:\n{text}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Wait for the prompt to be the screen's last line, ready for input.
    fn wait_prompt(&self, session: &SessionInfo) {
        self.wait_for(session, "a prompt", |text| text.trim_end().ends_with("test$"));
    }

    fn run(&self, session: &SessionInfo, line: &str) {
        self.manager.write(&session.id, format!("{line}\r").as_bytes()).unwrap();
    }

    /// The input line of the last prompt on screen.
    fn input_line(&self, session: &SessionInfo) -> String {
        let text = self.text(session);
        let last = text.lines().last().unwrap_or_default().to_string();
        last.strip_prefix("test$").unwrap_or(&last).trim().to_string()
    }

    fn wait_input(&self, session: &SessionInfo, want: &str) {
        let start = Instant::now();
        while self.input_line(session) != want {
            assert!(
                start.elapsed() < Duration::from_secs(15),
                "timed out waiting for input {want:?}; screen:\n{}",
                self.text(session)
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

fn forge() -> PinnedHost {
    PinnedHost { id: "h1".into(), name: "forge".into(), ip: Some("192.0.2.5".into()) }
}

/// A user's zsh setup like Kali's: a history file that zsh would normally read and append to.
const ZSHRC: &str = "HISTFILE=~/.zsh_history\nHISTSIZE=1000\nSAVEHIST=2000\nsetopt inc_append_history share_history\nPS1='test$ '\n";
const ZSH_HISTORY: &str = "echo from-user-history\n";
/// Debian and Ubuntu's /etc/zsh/zshrc runs compinit, which stops at a prompt on CI runners whose completion
/// folders it calls insecure. The user's own .zshenv can skip it; the tests do.
const ZSHENV: &str = "skip_global_compinit=1\n";

#[test]
fn zsh_sessions_run_independently_share_history_through_raven_and_never_write_the_history_file() {
    let r = rig("zsh", &[(".zshenv", ZSHENV), (".zshrc", ZSHRC), (".zsh_history", ZSH_HISTORY)]);

    let (one, _) = r.spawn(None);
    r.wait_prompt(&one);
    r.run(&one, "echo raven-$((40 + 2))");
    r.wait_for(&one, "the first command's output", |text| text.contains("\nraven-42\n"));
    // The command line arrives with the command's OSC 133 output mark.
    let start = Instant::now();
    while r.history.of("e1").is_empty() {
        assert!(start.elapsed() < Duration::from_secs(5), "no command line recorded");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(r.history.of("e1"), ["echo raven-$((40 + 2))"]);

    // A second session in the engagement, pinned to forge: its own shell, its own environment.
    let (two, _) = r.spawn(Some(forge()));
    r.wait_prompt(&two);
    r.run(&two, "echo \"rhost=$RHOST lhost=$LHOST eng=$RAVEN_ENGAGEMENT pwd=$PWD\"");
    let folder = r.folder.display().to_string();
    r.wait_for(&two, "the environment", |text| {
        text.contains(&format!("\nrhost=192.0.2.5 lhost=192.0.2.200 eng=Forge pwd={folder}\n"))
    });
    assert!(!r.text(&one).contains("rhost="), "the first session saw the second's command");
    r.wait_prompt(&one);
    r.run(&one, "echo \"rhost=[$RHOST]\"");
    r.wait_for(&one, "an unpinned session's RHOST", |text| text.contains("\nrhost=[]\n"));

    // A third session finds the first one's command on ↑, then the user's own history before it.
    let (three, _) = r.spawn(None);
    r.wait_prompt(&three);
    let recorded = r.history.of("e1");
    assert_eq!(recorded.len(), 3, "{recorded:?}");
    r.manager.write(&three.id, b"\x1b[A").unwrap();
    r.wait_input(&three, "echo \"rhost=[$RHOST]\"");
    r.manager.write(&three.id, b"\x1b[A\x1b[A\x1b[A").unwrap();
    r.wait_input(&three, "echo from-user-history");

    for session in [&one, &two, &three] {
        r.manager.close(&session.id).unwrap();
    }
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(std::fs::read_to_string(r.home.join(".zsh_history")).unwrap(), ZSH_HISTORY);
    let stray: Vec<_> = walk(&r.home.parent().unwrap().join("integration"))
        .into_iter()
        .filter(|path| path.file_name().is_some_and(|name| name.to_string_lossy().contains("history")))
        .collect();
    assert!(stray.is_empty(), "history files written: {stray:?}");
}

#[test]
fn a_reattached_renderer_is_redrawn_from_rust_and_gets_output_from_then_on() {
    let r = rig("zsh", &[(".zshenv", ZSHENV), (".zshrc", ZSHRC)]);
    let (session, first) = r.spawn(None);
    r.wait_prompt(&session);
    r.run(&session, "echo before-reload");
    r.wait_for(&session, "output", |text| text.contains("\nbefore-reload\n"));
    r.wait_prompt(&session);

    // The webview reloads: it lists the engagement's sessions and attaches a new channel.
    assert_eq!(r.manager.list("e1"), [session.clone()]);
    assert!(r.manager.list("e2").is_empty());
    let second = Buffer::default();
    r.manager.attach(&session.id, Box::new(second.clone())).unwrap();
    let start = Instant::now();
    while second.messages().is_empty() {
        assert!(start.elapsed() < Duration::from_secs(5), "no redraw");
        std::thread::sleep(Duration::from_millis(20));
    }
    // The redraw, played into a fresh terminal, shows what the session already showed.
    let mut replay = Screen::new(100, 30).unwrap();
    replay.feed(&second.messages()[0]);
    assert!(replay.plain_text().unwrap().contains("\nbefore-reload\n"));

    let before = first.messages().len();
    r.run(&session, "echo after-reload");
    r.wait_for(&session, "output", |text| text.contains("\nafter-reload\n"));
    std::thread::sleep(Duration::from_millis(100));
    let after: Vec<u8> = second.messages().concat();
    assert!(String::from_utf8_lossy(&after).contains("after-reload"));
    assert_eq!(first.messages().len(), before, "the old renderer still got output");
    r.manager.close(&session.id).unwrap();
}

#[test]
fn a_shell_that_exits_ends_its_session_and_says_so() {
    let r = rig("zsh", &[(".zshenv", ZSHENV), (".zshrc", ZSHRC)]);
    let (session, _) = r.spawn(None);
    r.wait_prompt(&session);
    r.run(&session, "exit 3");
    let start = Instant::now();
    while r.exits.0.lock().unwrap().is_empty() {
        assert!(start.elapsed() < Duration::from_secs(10), "no exit reported");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(*r.exits.0.lock().unwrap(), [(session.id.clone(), Some(3))]);
    assert!(r.manager.list("e1").is_empty());
    assert!(r.manager.write(&session.id, b"id\r").is_err());
}

#[test]
fn resize_reaches_the_shell() {
    let r = rig("zsh", &[(".zshenv", ZSHENV), (".zshrc", ZSHRC)]);
    let (session, _) = r.spawn(None);
    r.wait_prompt(&session);
    r.manager.resize(&session.id, 132, 40).unwrap();
    r.run(&session, "echo size=$COLUMNS:$LINES");
    r.wait_for(&session, "the new size", |text| text.contains("\nsize=132:40\n"));
    r.manager.close(&session.id).unwrap();
}

#[test]
fn output_arrives_in_batches_not_one_message_per_read() {
    let r = rig("zsh", &[(".zshenv", ZSHENV), (".zshrc", ZSHRC)]);
    let (session, out) = r.spawn(None);
    r.wait_prompt(&session);
    let before = out.messages().len();
    r.run(&session, "for i in {1..2000}; do echo line-$i; done");
    r.wait_for(&session, "the loop's end", |text| text.contains("\nline-2000\n"));
    std::thread::sleep(Duration::from_millis(50));
    let messages = out.messages().len() - before;
    let bytes: usize = out.messages()[before..].iter().map(Vec::len).sum();
    assert!(bytes > 2000 * 8, "only {bytes} bytes arrived");
    // 2000 lines would be hundreds of reads; batching every 8 ms makes them a handful of messages.
    assert!(messages < 200, "{messages} messages for {bytes} bytes");
    r.manager.close(&session.id).unwrap();
}

const BASH_PROFILE: &str = "HISTFILE=~/.bash_history\nHISTSIZE=1000\nshopt -s histappend\nPS1='test$ '\n";
const BASH_HISTORY: &str = "echo from-user-history\n";

#[test]
fn bash_sessions_record_and_preload_history_without_writing_the_history_file() {
    let r = rig("bash", &[(".bash_profile", BASH_PROFILE), (".bash_history", BASH_HISTORY)]);
    let (one, _) = r.spawn(Some(forge()));
    r.wait_prompt(&one);
    r.run(&one, "echo bash-$RHOST");
    r.wait_for(&one, "output", |text| text.contains("\nbash-192.0.2.5\n"));
    let start = Instant::now();
    while r.history.of("e1").is_empty() {
        assert!(start.elapsed() < Duration::from_secs(5), "no command line recorded");
        std::thread::sleep(Duration::from_millis(20));
    }
    r.wait_prompt(&one);
    r.run(&one, "echo second");
    r.wait_for(&one, "output", |text| text.contains("\nsecond\n"));
    let start = Instant::now();
    while r.history.of("e1").len() < 2 {
        assert!(start.elapsed() < Duration::from_secs(5), "second command line not recorded");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(r.history.of("e1"), ["echo bash-$RHOST", "echo second"]);

    // Every preloaded line is its own entry: none dropped, newest first on ↑, the user's own after them.
    let (two, _) = r.spawn(None);
    r.wait_prompt(&two);
    r.manager.write(&two.id, b"\x1b[A").unwrap();
    r.wait_input(&two, "echo second");
    r.manager.write(&two.id, b"\x1b[A").unwrap();
    r.wait_input(&two, "echo bash-$RHOST");
    r.manager.write(&two.id, b"\x1b[A").unwrap();
    r.wait_input(&two, "echo from-user-history");

    r.manager.close(&one.id).unwrap();
    r.manager.close(&two.id).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(std::fs::read_to_string(r.home.join(".bash_history")).unwrap(), BASH_HISTORY);
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walk(&path));
            } else {
                out.push(path);
            }
        }
    }
    out
}
