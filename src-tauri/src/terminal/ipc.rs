//! The terminal's IPC (docs/specs/terminal.md §5, SR-1): the webview's only way to reach a shell.
//!
//! `spawn`, `write`, `resize` and `close` are the four calls the spec names. `list` and `attach` let a reloaded
//! webview find its engagement's sessions and reattach to them; neither starts a process or reaches a shell's
//! input. The shell, its arguments, folder and environment all come from Rust and the vault, never the webview:
//! `spawn` takes only ids and a size. Output goes over a binary Tauri Channel, batched by the session thread.
//!
//! Each command is allowed by name in `capabilities/default.json`, through the app's ACL manifest in `build.rs`.

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Emitter, Manager};

use super::session::{
    HistorySink, OutputSink, PinnedHost, SessionEvents, SessionInfo, SessionManager, ShellConfig, SpawnRequest,
};
use super::TerminalError;
use crate::commands::{VaultState, off_main, with_vault};
use crate::error::{AppError, AppResult};
use crate::vault::Vault;
use crate::{engagements, hosts, settings, terminal_history};

/// The header naming the session a `terminal_write` body is for. The body itself is the raw bytes.
pub const SESSION_HEADER: &str = "raven-session";
/// The event a session's own exit sends, with an `ExitEvent`.
pub const EXIT_EVENT: &str = "terminal-exit";

impl From<TerminalError> for AppError {
    fn from(error: TerminalError) -> Self {
        match error {
            TerminalError::NoSession => AppError::NotFound,
            other => AppError::Io(other.to_string()),
        }
    }
}

/// The session manager, with the user's login shell, as the app runs it.
pub fn manager(app: &AppHandle, integration_dir: std::path::PathBuf) -> SessionManager {
    SessionManager::new(
        ShellConfig::login(integration_dir),
        Arc::new(VaultHistory::start(app.clone())),
        Arc::new(AppEvents(app.clone())),
    )
}

struct ChannelSink(Channel);

impl OutputSink for ChannelSink {
    fn send(&mut self, bytes: Vec<u8>) -> bool {
        self.0.send(InvokeResponseBody::Raw(bytes)).is_ok()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    session_id: String,
    engagement_id: String,
    exit_code: Option<i32>,
}

struct AppEvents(AppHandle);

impl SessionEvents for AppEvents {
    fn exited(&self, info: &SessionInfo, exit_code: Option<i32>) {
        let _ = self.0.emit(
            EXIT_EVENT,
            ExitEvent { session_id: info.id.clone(), engagement_id: info.engagement_id.clone(), exit_code },
        );
    }
}

/// Command lines waiting to be written to the vault, oldest first.
type Pending = Arc<Mutex<Vec<(String, String)>>>;

/// Records typed command lines in the vault from a thread of its own, so a session never waits on the vault
/// lock. While the vault is locked they wait in memory and are written once it is open again.
struct VaultHistory {
    pending: Pending,
    wake: Mutex<Sender<()>>,
}

impl VaultHistory {
    fn start(app: AppHandle) -> Self {
        let pending: Pending = Arc::default();
        let (wake, woken) = mpsc::channel::<()>();
        let queue = Arc::clone(&pending);
        app.manage(PendingHistory(Arc::clone(&pending)));
        let _ = std::thread::Builder::new().name("raven-terminal-history".into()).spawn(move || {
            while woken.recv().is_ok() {
                let state = app.state::<VaultState>();
                let vault = state.lock().unwrap_or_else(|e| e.into_inner());
                write_pending(&vault, &queue);
            }
        });
        VaultHistory { pending, wake: Mutex::new(wake) }
    }
}

impl HistorySink for VaultHistory {
    fn record(&self, engagement_id: &str, command: &str) {
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).push((engagement_id.into(), command.into()));
        let _ = self.wake.lock().unwrap_or_else(|e| e.into_inner()).send(());
    }
}

/// The same queue, for `spawn` to write out before it reads the engagement's history.
struct PendingHistory(Pending);

/// Write every waiting command line. Called with the vault lock held, and taking the queue's lock inside it, so a
/// line is either still queued or already in the vault for anyone else holding the vault lock.
fn write_pending(vault: &Vault, pending: &Pending) {
    let Ok(conn) = vault.conn() else { return };
    let lines = std::mem::take(&mut *pending.lock().unwrap_or_else(|e| e.into_inner()));
    for (engagement_id, command) in lines {
        // An engagement deleted since is the only way this fails: its history goes with it.
        let _ = terminal_history::record(conn, &engagement_id, &command);
    }
}

fn sessions(app: &AppHandle) -> tauri::State<'_, SessionManager> {
    app.state::<SessionManager>()
}

/// Open a session in `engagement_id`, pinned to `host_id` (the Target) or to the engagement alone.
#[tauri::command]
pub async fn terminal_spawn(
    app: AppHandle,
    engagement_id: String,
    host_id: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel,
) -> AppResult<SessionInfo> {
    if cols == 0 || rows == 0 {
        return Err(AppError::validation("cols", "a terminal needs at least one column and one row"));
    }
    let root = terminal_history::default_folder_root()?;
    let lookup = app.clone();
    let request = with_vault(app.clone(), move |v| {
        if let Some(pending) = lookup.try_state::<PendingHistory>() {
            write_pending(v, &pending.0);
        }
        let conn = v.conn()?;
        let engagement = engagements::get(conn, &engagement_id)?;
        let host = match host_id {
            Some(id) => {
                let host = hosts::get(conn, &id)?;
                if host.engagement_id != engagement.id {
                    return Err(AppError::validation("hostId", "that host belongs to another engagement"));
                }
                Some(PinnedHost { id: host.id, name: host.name, ip: host.ip })
            }
            None => None,
        };
        let lhost = Some(settings::get(conn)?.attacker_ip).filter(|ip| !ip.trim().is_empty());
        let folder = terminal_history::engagement_folder(conn, &root, &engagement.id)?;
        let history = terminal_history::recent(conn, &engagement.id, terminal_history::PRELOAD_LIMIT)?;
        Ok(SpawnRequest {
            engagement_id: engagement.id,
            engagement_name: engagement.name,
            host,
            lhost,
            folder,
            history,
            cols,
            rows,
        })
    })
    .await?;
    off_main(move || Ok(sessions(&app).spawn(request, Box::new(ChannelSink(on_output)))?)).await
}

/// The engagement's open sessions, oldest first: what a reloaded webview reattaches to.
#[tauri::command]
pub async fn terminal_list(app: AppHandle, engagement_id: String) -> AppResult<Vec<SessionInfo>> {
    Ok(sessions(&app).list(&engagement_id))
}

/// Send a session's output to `on_output` from now on, starting with a redraw of its screen and scrollback.
#[tauri::command]
pub async fn terminal_attach(app: AppHandle, session_id: String, on_output: Channel) -> AppResult<SessionInfo> {
    Ok(sessions(&app).attach(&session_id, Box::new(ChannelSink(on_output)))?)
}

/// Type bytes into a session. The body is the raw bytes; the `raven-session` header names the session.
#[tauri::command]
pub async fn terminal_write(app: AppHandle, request: Request<'_>) -> AppResult<()> {
    let session_id = request
        .headers()
        .get(SESSION_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::validation("session", "no session named"))?
        .to_owned();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::validation("body", "write takes raw bytes"));
    };
    let bytes = bytes.clone();
    off_main(move || Ok(sessions(&app).write(&session_id, &bytes)?)).await
}

#[tauri::command]
pub async fn terminal_resize(app: AppHandle, session_id: String, cols: u16, rows: u16) -> AppResult<()> {
    Ok(sessions(&app).resize(&session_id, cols, rows)?)
}

/// End a session: its shell is hung up and its state dropped.
#[tauri::command]
pub async fn terminal_close(app: AppHandle, session_id: String) -> AppResult<()> {
    Ok(sessions(&app).close(&session_id)?)
}
