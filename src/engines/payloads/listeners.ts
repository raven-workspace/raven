import { findPlaceholders, replacePlaceholders } from "../checklist/template";
import type { ListenerId } from "./types";

export interface ListenerDef {
  label: string;
  /** Placeholders ({LPORT} {LHOST} {TARGET_IP} {BIND_PORT} {MSF_PAYLOAD}) are filled by fillListener. */
  template: string;
  /** Kali connects out to a bind shell instead of waiting for a callback. */
  connect?: boolean;
  /** Shown with the payload; filled like the template. */
  note?: string;
}

export const LISTENERS: Record<ListenerId, ListenerDef> = {
  penelope: { label: "penelope", template: "penelope -O -p {LPORT}", note: "No penelope? rlwrap nc -lvnp {LPORT}" },
  "rlwrap-nc": { label: "rlwrap nc", template: "rlwrap nc -lvnp {LPORT}" },
  "socat-tty": {
    label: "socat (full TTY)", template: "socat file:`tty`,raw,echo=0 tcp-listen:{LPORT}",
    note: "Run `reset` if your terminal misbehaves after exit.",
  },
  "ncat-ssl": { label: "ncat --ssl", template: "ncat --ssl -lvnp {LPORT}" },
  "multi-handler": {
    label: "multi/handler",
    template: 'msfconsole -q -x "use exploit/multi/handler; set payload {MSF_PAYLOAD}; set LHOST {LHOST}; set LPORT {LPORT}; set ExitOnSession false; run -j"',
  },
  "connect-nc": { label: "rlwrap nc", template: "rlwrap nc -nv {TARGET_IP} {BIND_PORT}", connect: true },
  "connect-socat": { label: "socat (full TTY)", template: "socat file:`tty`,raw,echo=0 tcp:{TARGET_IP}:{BIND_PORT}", connect: true },
  "connect-penelope": { label: "penelope", template: "penelope -O -c {TARGET_IP} -p {BIND_PORT}", connect: true },
};

/** The `{NAME}` placeholders' names in a payload text, in order (repeats kept), as the template module's grammar reads them. */
export const placeholderNames = (text: string): string[] => findPlaceholders(text).map((p) => p.raw);

/** `text` with each `{NAME}` replaced by `fn(name, written)`; `written` is the placeholder as it stands. */
export const fillPlaceholders = (text: string, fn: (name: string, written: string) => string): string =>
  replacePlaceholders(text, (p) => fn(p.raw, text.slice(p.start, p.end)));

/** Fills a listener template; a blank or missing value stays visible as its {NAME}. */
export function fillListener(template: string, values: Record<string, string>): string {
  return fillPlaceholders(template, (name, m) => {
    const v = (values[name] ?? "").trim();
    return v === "" ? m : v;
  });
}
