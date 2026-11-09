/** UTF-16LE then base64: the form `powershell -e` expects. */
export function utf16leBase64(script: string): string {
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bytes[i * 2] = c & 0xff;
    bytes[i * 2 + 1] = c >> 8;
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeUtf16leBase64(b64: string): string {
  const bin = atob(b64);
  let out = "";
  for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
  return out;
}

const SHELL_ENCODED: Record<string, string> = {
  " ": "+", "&": "%26", ">": "%3E", "<": "%3C", "|": "%7C", ";": "%3B", "#": "%23", "'": "%27", '"': "%22",
  "/": "%2F", "%": "%25", "+": "%2B", "=": "%3D", "?": "%3F",
  // curl treats [] {} as globs, and strict servers reject \ ^ ` raw.
  "\\": "%5C", "[": "%5B", "]": "%5D", "{": "%7B", "}": "%7D", "^": "%5E", "`": "%60",
};

/**
 * Encodes only what breaks a shell command inside a URL; `-` and `.` stay raw so the command stays readable. Line breaks,
 * tabs, other control characters and non-ASCII are percent-encoded as UTF-8. `keep` names the placeholders still unfilled:
 * each `{NAME}` among them stays as it is, so the gap is still visible and detectable; any other `{…}` (a custom
 * command's `${IFS}`) is encoded like any text.
 */
export function urlEncodeShell(s: string, keep: readonly string[] = []): string {
  return s.replace(/\{([A-Z][A-Z0-9_]*)\}|[ &><|;#'"/%+=?\\[\]{}^`]|[^\x20-\x7e]/gu, (c, name?: string) => {
    if (name !== undefined) return keep.includes(name) ? c : `%7B${name}%7D`;
    // A lone surrogate (one code unit) has no UTF-8 form; a whole astral character (emoji) is two units and encodes.
    return SHELL_ENCODED[c] ?? (c.length === 1 && /[\uD800-\uDFFF]/.test(c) ? "%EF%BF%BD" : encodeURIComponent(c));
  });
}

export function urlEncodeFull(s: string): string {
  return encodeURIComponent(s);
}

/** Doubles single quotes for use inside a SQL string literal. */
export function sqlQuote(s: string): string {
  return s.replace(/'/g, "''");
}
