//! Tells the frontend which OS it runs on, before any page script. The user agent can't: WebKitGTK
//! doesn't name Linux in it, so a check on it took Linux for macOS (RAV-67). The page reads
//! `window.__RAVEN_OS__` (src/lib/platform.ts), e.g. to drop the title bar's macOS inset on Linux.

use tauri::plugin::TauriPlugin;
use tauri::Runtime;

/// The script that sets `window.__RAVEN_OS__` to `std::env::consts::OS` ("macos", "linux", …).
pub fn init_script(os: &str) -> String {
    format!("window.__RAVEN_OS__ = {};", serde_json::to_string(os).expect("a str serializes"))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("raven-platform")
        .js_init_script(init_script(std::env::consts::OS))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_sets_the_os_as_a_js_string() {
        assert_eq!(init_script("linux"), r#"window.__RAVEN_OS__ = "linux";"#);
        assert_eq!(init_script("macos"), r#"window.__RAVEN_OS__ = "macos";"#);
    }
}
