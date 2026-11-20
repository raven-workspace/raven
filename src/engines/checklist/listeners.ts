import type { LogEntry } from '../../types/log';

/**
 * Ports a reverse-shell listener in the log is bound to, so a second shell on the same port can be warned about.
 * Only Kali-side listeners count: netcat/ncat/pwncat with a listen flag, socat TCP-LISTEN, and a Metasploit
 * multi/handler's LPORT. A plain `python3 -m http.server` is a file server, not a shell listener, and is ignored.
 */

const clampPort = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
};

/** The listener ports one command line binds (usually one; a resource script can hold several). */
function portsInLine(line: string): number[] {
  const l = line.trim();
  const out: number[] = [];
  // socat TCP-LISTEN:4444 (TCP, TCP4, TCP6).
  for (const m of l.matchAll(/\bTCP[46]?-LISTEN:(\d{1,5})/gi)) {
    const p = clampPort(m[1]);
    if (p) out.push(p);
  }
  // netcat / ncat / pwncat with a listen flag: nc -lvnp 4444, nc -l -p 4444, pwncat-cs -lp 4444.
  if (/\b(?:rlwrap\s+\S*\s+)?(?:nc(?:at|\.traditional)?|pwncat(?:-cs)?)\b/i.test(l) && /\s-[a-z]*l[a-z]*\b/i.test(l)) {
    // -p <port> if explicit, else the last plain number on the line (combined-flag forms put the port at the end).
    const explicit = /\s-[a-z]*p[a-z]*\s+(\d{1,5})\b/i.exec(l)?.[1];
    const trailing = l.match(/\b(\d{1,5})\b/g)?.pop();
    const p = clampPort(explicit) ?? clampPort(trailing);
    if (p) out.push(p);
  }
  // Metasploit handler: set LPORT 4444 on a multi/handler block.
  if (/multi\/handler/i.test(l)) {
    const p = clampPort(/\bset\s+LPORT\s+(\d{1,5})\b/i.exec(l)?.[1]);
    if (p) out.push(p);
  }
  return out;
}

/** Listener ports named anywhere in a command entry's blocks. */
export function listenerPortsInCommand(command: string): number[] {
  // multi/handler and its `set LPORT` may be on different lines of one block: scan the whole text, then per line.
  const text = command;
  const ports = new Set<number>();
  if (/multi\/handler/i.test(text)) {
    for (const m of text.matchAll(/\bset\s+LPORT\s+(\d{1,5})\b/gi)) {
      const p = clampPort(m[1]);
      if (p) ports.add(p);
    }
  }
  for (const line of text.split(/\r?\n/)) for (const p of portsInLine(line)) ports.add(p);
  return [...ports];
}

/** Every listener port in the engagement's logged commands. */
export function loggedListenerPorts(log: readonly LogEntry[]): Set<number> {
  const out = new Set<number>();
  for (const e of log) {
    if (e.content.kind !== 'command') continue;
    for (const b of e.content.blocks) for (const p of listenerPortsInCommand(b.command)) out.add(p);
  }
  return out;
}

/** The lowest free port above `from` not already a logged listener; `from` itself when `taken` is empty of it. */
export function nextFreePort(from: number, taken: ReadonlySet<number>): number {
  if (!taken.has(from)) return from;
  let p = from;
  while (taken.has(p) && p < 65535) p++;
  return p;
}
