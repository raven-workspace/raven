import { parseCredentialPaste, type ParsedCredentialPaste } from '../credentials/paste';
import type { LibraryCommand } from '../library/types';
import { detectKind } from './kind';

/** A pasted credential; `local` marks Windows local notation (`.\user:pass`): local to the host, no domain. */
export type PastedCredential = ParsedCredentialPaste & { local?: true };

/** Shell syntax in the account part: a command line, never a user name. */
const SHELL_ACCOUNT = /[|;&<>()`'"{}=*]|^[-/~]|^\.(?!\\)/;
/** Shell syntax anywhere in the line: substitution, or a pipe, chain or redirect between words. */
const SHELL_LINE = /\$\(|`|\s(?:\||\|\||&&|;|>>?|<)\s/;
/** A port number (1–5 digits, at most 65535) after a known host's name. */
const PORT = /^\d{1,5}$/;
/** A Windows drive path (`C:\\Users\\bob`): a single letter, then `:\\`. */
const DRIVE_PATH = /^[A-Za-z]:\\/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The credentials a capture paste is made of: every non-empty line must read as `user:secret`, `DOMAIN\user:secret`,
 * `user@domain:secret`, `.\user:secret` or `user:hash` (parseCredentialPaste). Empty when any line is something else, so
 * a note that merely contains a credential stays a note. Never offered: URLs (`scheme://`), `host:port` (an IP or a
 * dotted host name followed by a port number, or `name:<port>` where `name` is one of `hostNames`: a known host's name,
 * short name or IP), command lines (a command word, `library`'s included, a shell prompt or shell syntax), and notes: a secret with whitespace or starting with `\\` or `/`, or a drive path.
 */
export function credentialsInPaste(text: string, library: LibraryCommand[], hostNames: string[] = []): PastedCredential[] {
  const known = new Set(hostNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // A command, HTTP request or flag is that kind, whatever its colons.
  if (detectKind(text, false, library) !== 'note') return [];
  const found: PastedCredential[] = [];
  for (const line of lines) {
    if (line.includes('://') || SHELL_LINE.test(line) || detectKind(line, false, library) !== 'note') return [];
    const parsed = parseCredentialPaste(line);
    if (!parsed) return [];
    // A note, not a credential: a secret with whitespace or a path (`/var/www`, `\\share`), or a drive path.
    if (/\s/.test(parsed.secret) || /^[\\/]/.test(parsed.secret) || DRIVE_PATH.test(line)) return [];
    if (SHELL_ACCOUNT.test(line.slice(0, line.indexOf(':')))) return [];
    // `user@192.0.2.10:22` is a target, not an account.
    if (parsed.domain && IPV4.test(parsed.domain)) return [];
    if (!parsed.domain && PORT.test(parsed.secret) && Number(parsed.secret) <= 65535 && known.has(parsed.username.toLowerCase())) {
      return [];
    }
    found.push(parsed.domain === '.' ? { ...parsed, domain: null, local: true } : parsed);
  }
  return found;
}
