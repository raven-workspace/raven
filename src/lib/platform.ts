/**
 * Whether the desktop draws Raven's title bar. On Linux the window keeps the desktop's own title bar
 * (tauri.linux.conf.json); on macOS Raven's chrome bar sits under the traffic lights (titleBarStyle Overlay).
 * WebKitGTK's user agent names Linux ("X11; Linux x86_64", "Linux aarch64"); WKWebView's names Macintosh.
 */
export function hasNativeTitleBar(userAgent: string = navigator.userAgent): boolean {
  return /\bLinux\b/.test(userAgent) && !/\bAndroid\b/.test(userAgent);
}
