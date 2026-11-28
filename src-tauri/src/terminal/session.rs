//! The session manager (docs/specs/terminal.md §5.1). A **session** is one shell and its terminal state, owned by
//! Rust, belonging to one engagement and pinned to a host or to the engagement alone. Sessions are keyed by id and
//! listed per engagement; a webview reload reattaches to one with `attach`, which redraws it from Rust's state.
//!
//! Threads, per session: a reader moves the PTY's bytes onto a channel; the session thread owns the libghostty-vt
//! `Screen` (which can't leave the thread that made it), feeds it, records command lines and sends output to the
//! webview in batches; a reaper waits for the shell to exit. Writes and resizes go straight to the PTY.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use portable_pty::{MasterPty, PtySize};
use serde::Serialize;

use super::shell::{self, SessionEnv, ShellKind};
use super::{MarkKind, Screen, TerminalError, TerminalResult, pty};

/// Output is held this long after its first byte, then sent as one message (spec: every 5–16 ms).
pub const BATCH_INTERVAL: Duration = Duration::from_millis(8);
/// A batch this big goes out at once, without waiting.
const BATCH_MAX_BYTES: usize = 256 * 1024;
/// After the shell exits, how long to wait for the rest of its output.
const EXIT_DRAIN: Duration = Duration::from_millis(200);

/// Where a session's output goes: the webview's binary channel, or a test's buffer. `false` means it is gone.
pub trait OutputSink: Send + 'static {
    fn send(&mut self, bytes: Vec<u8>) -> bool;
}

/// Where typed command lines go: the vault (SR-4). Called on the session thread, so it must not block for long.
pub trait HistorySink: Send + Sync + 'static {
    fn record(&self, engagement_id: &str, command: &str);
}

/// Told when a session's shell exits by itself.
pub trait SessionEvents: Send + Sync + 'static {
    fn exited(&self, info: &SessionInfo, exit_code: Option<i32>);
}

/// What the webview knows about a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub engagement_id: String,
    /// The host that was Target when it opened; `None` for the engagement alone.
    pub host_id: Option<String>,
    /// The pinned host's name, for the terminal tab.
    pub host_name: Option<String>,
    /// The engagement folder the shell started in.
    pub cwd: String,
    /// The shell, as a path.
    pub shell: String,
}

/// The host a new session is pinned to.
#[derive(Debug, Clone)]
pub struct PinnedHost {
    pub id: String,
    pub name: String,
    /// Its address, for `RHOST`.
    pub ip: Option<String>,
}

/// Everything Raven looked up in the vault to open a session.
#[derive(Debug, Clone)]
pub struct SpawnRequest {
    pub engagement_id: String,
    pub engagement_name: String,
    pub host: Option<PinnedHost>,
    /// Settings → Your IP, for `LHOST`.
    pub lhost: Option<String>,
    /// The engagement folder, already created.
    pub folder: PathBuf,
    /// This engagement's command lines, oldest first.
    pub history: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Which shell sessions run and where Raven's integration files live.
#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub shell: PathBuf,
    pub integration_dir: PathBuf,
    /// Set last in every session's environment. Tests give the shell its own `HOME` with them.
    pub env: Vec<(OsString, OsString)>,
}

impl ShellConfig {
    /// The user's login shell, with integration files under `integration_dir`.
    pub fn login(integration_dir: PathBuf) -> ShellConfig {
        ShellConfig { shell: shell::login_shell_path(), integration_dir, env: Vec::new() }
    }
}

enum Message {
    Output(Vec<u8>),
    Eof,
    Exited(Option<i32>),
    Attach(Box<dyn OutputSink>),
    Resize(u16, u16),
    PlainText(Sender<String>),
    Close,
}

struct Session {
    info: SessionInfo,
    to_thread: Sender<Message>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pid: u32,
    /// Opening order, for `list`.
    seq: u64,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct SessionManager {
    config: ShellConfig,
    sessions: Sessions,
    history: Arc<dyn HistorySink>,
    events: Arc<dyn SessionEvents>,
    integration_written: Mutex<bool>,
    next_seq: AtomicU64,
}

impl SessionManager {
    pub fn new(config: ShellConfig, history: Arc<dyn HistorySink>, events: Arc<dyn SessionEvents>) -> Self {
        SessionManager {
            config,
            sessions: Arc::default(),
            history,
            events,
            integration_written: Mutex::new(false),
            next_seq: AtomicU64::new(0),
        }
    }

    /// Open a session: start the shell in the engagement folder and send its output to `sink`.
    pub fn spawn(&self, request: SpawnRequest, sink: Box<dyn OutputSink>) -> TerminalResult<SessionInfo> {
        {
            let mut written = locked(&self.integration_written);
            if !*written {
                shell::write_integration(&self.config.integration_dir)
                    .map_err(|e| TerminalError::Pty(format!("could not write the shell integration: {e}")))?;
                *written = true;
            }
        }
        let kind = ShellKind::of(&self.config.shell);
        let env = SessionEnv {
            engagement: request.engagement_name.clone(),
            rhost: request.host.as_ref().and_then(|host| host.ip.clone()),
            lhost: request.lhost.clone(),
        };
        let preload = kind.preloads_history().then(|| shell::history_bytes(&request.history));
        let cmd = shell::command(
            &self.config.shell,
            &self.config.integration_dir,
            &request.folder,
            &env,
            preload.is_some(),
            &self.config.env,
        );

        let info = SessionInfo {
            id: uuid::Uuid::new_v4().to_string(),
            engagement_id: request.engagement_id.clone(),
            host_id: request.host.as_ref().map(|host| host.id.clone()),
            host_name: request.host.as_ref().map(|host| host.name.clone()),
            cwd: request.folder.to_string_lossy().into_owned(),
            shell: self.config.shell.to_string_lossy().into_owned(),
        };

        // The session thread makes the Screen first: a libghostty-vt terminal stays on the thread that made it.
        let (to_thread, from_outside) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        {
            let info = info.clone();
            let sessions = Arc::clone(&self.sessions);
            let history = Arc::clone(&self.history);
            let events = Arc::clone(&self.events);
            let (cols, rows) = (request.cols, request.rows);
            std::thread::Builder::new()
                .name("raven-session".into())
                .spawn(move || {
                    let screen = match Screen::new(cols, rows) {
                        Ok(screen) => screen,
                        Err(error) => {
                            let _ = ready_tx.send(Err(error));
                            return;
                        }
                    };
                    let _ = ready_tx.send(Ok(()));
                    run(SessionThread { info, screen, sink: Some(sink), rx: from_outside, sessions, history, events });
                })
                .map_err(|e| TerminalError::Pty(e.to_string()))?;
        }
        ready_rx.recv().map_err(|_| TerminalError::Pty("the session thread stopped".into()))??;

        let spawned = match pty::spawn(cmd, request.cols, request.rows, preload) {
            Ok(spawned) => spawned,
            Err(error) => {
                let _ = to_thread.send(Message::Close);
                return Err(error);
            }
        };
        let pty::Spawned { master, mut child } = spawned;
        let pid = child.id();
        let reader = master.try_clone_reader().map_err(|e| TerminalError::Pty(e.to_string()));
        let writer = master.take_writer().map_err(|e| TerminalError::Pty(e.to_string()));
        let (mut reader, writer) = match (reader, writer) {
            (Ok(reader), Ok(writer)) => (reader, writer),
            (Err(error), _) | (_, Err(error)) => {
                hang_up(pid);
                let _ = child.wait();
                let _ = to_thread.send(Message::Close);
                return Err(error);
            }
        };

        let output = to_thread.clone();
        std::thread::Builder::new()
            .name("raven-session-reader".into())
            .spawn(move || {
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if output.send(Message::Output(buf[..n].to_vec())).is_err() {
                                return;
                            }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        // Linux reports EIO, not end of file, once the child side closes.
                        Err(_) => break,
                    }
                }
                let _ = output.send(Message::Eof);
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;
        let exited = to_thread.clone();
        std::thread::Builder::new()
            .name("raven-session-reaper".into())
            .spawn(move || {
                let code = child.wait().ok().and_then(|status| status.code());
                let _ = exited.send(Message::Exited(code));
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        locked(&self.sessions).insert(
            info.id.clone(),
            Session {
                info: info.clone(),
                to_thread,
                writer: Arc::new(Mutex::new(writer)),
                master: Arc::new(Mutex::new(master)),
                pid,
                seq: self.next_seq.fetch_add(1, Ordering::Relaxed),
            },
        );
        Ok(info)
    }

    /// The engagement's open sessions, oldest first.
    pub fn list(&self, engagement_id: &str) -> Vec<SessionInfo> {
        let sessions = locked(&self.sessions);
        let mut list: Vec<(u64, SessionInfo)> = sessions
            .values()
            .filter(|session| session.info.engagement_id == engagement_id)
            .map(|session| (session.seq, session.info.clone()))
            .collect();
        drop(sessions);
        list.sort_by_key(|(seq, _)| *seq);
        list.into_iter().map(|(_, info)| info).collect()
    }

    /// Send the session's output to `sink` from now on, starting with a redraw of everything Rust holds. The
    /// previous sink, from a webview that reloaded, gets nothing more.
    pub fn attach(&self, session_id: &str, sink: Box<dyn OutputSink>) -> TerminalResult<SessionInfo> {
        let sessions = locked(&self.sessions);
        let session = sessions.get(session_id).ok_or(TerminalError::NoSession)?;
        session.to_thread.send(Message::Attach(sink)).map_err(|_| TerminalError::NoSession)?;
        Ok(session.info.clone())
    }

    /// Type `bytes` into the session's shell.
    pub fn write(&self, session_id: &str, bytes: &[u8]) -> TerminalResult<()> {
        let writer = {
            let sessions = locked(&self.sessions);
            Arc::clone(&sessions.get(session_id).ok_or(TerminalError::NoSession)?.writer)
        };
        let mut writer = locked(&writer);
        writer.write_all(bytes).and_then(|()| writer.flush()).map_err(|e| TerminalError::Pty(e.to_string()))
    }

    /// Resize the session's PTY and screen.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> TerminalResult<()> {
        if cols == 0 || rows == 0 {
            return Err(TerminalError::Pty("a terminal needs at least one column and one row".into()));
        }
        let (master, to_thread) = {
            let sessions = locked(&self.sessions);
            let session = sessions.get(session_id).ok_or(TerminalError::NoSession)?;
            (Arc::clone(&session.master), session.to_thread.clone())
        };
        locked(&master)
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;
        let _ = to_thread.send(Message::Resize(cols, rows));
        Ok(())
    }

    /// End the session: hang up its shell and drop its state.
    pub fn close(&self, session_id: &str) -> TerminalResult<()> {
        let session = locked(&self.sessions).remove(session_id).ok_or(TerminalError::NoSession)?;
        hang_up(session.pid);
        let _ = session.to_thread.send(Message::Close);
        Ok(())
    }

    /// The session's screen and scrollback as plain text, read from libghostty-vt.
    pub fn plain_text(&self, session_id: &str) -> TerminalResult<String> {
        let (tx, rx) = mpsc::channel();
        {
            let sessions = locked(&self.sessions);
            let session = sessions.get(session_id).ok_or(TerminalError::NoSession)?;
            session.to_thread.send(Message::PlainText(tx)).map_err(|_| TerminalError::NoSession)?;
        }
        rx.recv_timeout(Duration::from_secs(5)).map_err(|_| TerminalError::NoSession)
    }
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        for (_, session) in locked(&self.sessions).drain() {
            hang_up(session.pid);
            let _ = session.to_thread.send(Message::Close);
        }
    }
}

/// SIGHUP to the shell, as a closing terminal sends; the shell passes it on to its jobs.
fn hang_up(pid: u32) {
    if let Ok(pid) = libc::pid_t::try_from(pid) {
        // SAFETY: kill() with a pid this manager started and has not yet reaped.
        unsafe {
            libc::kill(pid, libc::SIGHUP);
        }
    }
}

struct SessionThread {
    info: SessionInfo,
    screen: Screen,
    sink: Option<Box<dyn OutputSink>>,
    rx: Receiver<Message>,
    sessions: Sessions,
    history: Arc<dyn HistorySink>,
    events: Arc<dyn SessionEvents>,
}

fn run(mut s: SessionThread) {
    let mut pending: Vec<u8> = Vec::new();
    let mut batch_started: Option<Instant> = None;
    let mut eof = false;
    let mut exit: Option<(Option<i32>, Instant)> = None;
    loop {
        let now = Instant::now();
        let deadlines = [batch_started.map(|t| t + BATCH_INTERVAL), exit.map(|(_, t)| t + EXIT_DRAIN)];
        let wait = deadlines.into_iter().flatten().min().map(|t| t.saturating_duration_since(now));
        let message = match wait {
            Some(wait) => s.rx.recv_timeout(wait),
            None => s.rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match message {
            Ok(Message::Output(bytes)) => {
                s.screen.feed(&bytes);
                for mark in s.screen.take_marks() {
                    if mark.kind == MarkKind::OutputStart && !mark.command.is_empty() {
                        s.history.record(&s.info.engagement_id, &String::from_utf8_lossy(&mark.command));
                    }
                }
                pending.extend_from_slice(&bytes);
                batch_started.get_or_insert_with(Instant::now);
            }
            Ok(Message::Eof) => eof = true,
            Ok(Message::Exited(code)) => exit = Some((code, Instant::now())),
            Ok(Message::Attach(mut sink)) => {
                // The redraw already holds whatever was waiting to go out.
                pending.clear();
                batch_started = None;
                let snapshot = s.screen.vt_snapshot().unwrap_or_default();
                if sink.send(snapshot) {
                    s.sink = Some(sink);
                }
            }
            Ok(Message::Resize(cols, rows)) => {
                let _ = s.screen.resize(cols, rows);
            }
            Ok(Message::PlainText(reply)) => {
                let _ = reply.send(s.screen.plain_text().unwrap_or_default());
            }
            Ok(Message::Close) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }

        let due = batch_started.is_some_and(|t| t.elapsed() >= BATCH_INTERVAL) || pending.len() >= BATCH_MAX_BYTES;
        if due || (exit.is_some() && eof) {
            flush(&mut s.sink, &mut pending);
            batch_started = None;
        }
        if let Some((code, at)) = exit
            && (eof || at.elapsed() >= EXIT_DRAIN)
        {
            flush(&mut s.sink, &mut pending);
            // Gone already if the session was closed: then nobody needs telling.
            let removed = locked(&s.sessions).remove(&s.info.id).is_some();
            if removed {
                s.events.exited(&s.info, code);
            }
            return;
        }
    }
}

fn flush(sink: &mut Option<Box<dyn OutputSink>>, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    let bytes = std::mem::take(pending);
    if let Some(out) = sink
        && !out.send(bytes)
    {
        // The webview is gone; output keeps landing in the Screen until one reattaches.
        *sink = None;
    }
}
