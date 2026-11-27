declare global {
  interface Window {
    /** The OS the desktop app runs on (Rust's `std::env::consts::OS`), set before any page script (src-tauri/src/platform.rs). */
    __RAVEN_OS__?: string;
  }
}

/**
 * Whether the desktop draws the window's title bar. On Linux the window keeps the desktop's own (tauri.linux.conf.json),
 * or none at all under a tiling compositor such as Hyprland; on macOS Raven's chrome bar sits under the traffic lights
 * (titleBarStyle Overlay). Read from the Rust side, not the user agent: WebKitGTK's user agent doesn't name Linux.
 * Outside the app (audit mode, tests) it's undefined, and the bar keeps the macOS layout.
 */
export function hasNativeTitleBar(os: string | undefined = window.__RAVEN_OS__): boolean {
  return os === "linux";
}
