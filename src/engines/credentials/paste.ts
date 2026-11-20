/**
 * Parses one pasted line of the form `user:secret`, `DOMAIN\user:secret` or `user@domain:secret` into a credential.
 * Returns null when the text is not a credential, so the paste falls through to the input as plain text.
 */

import { isNtShape } from "./matrix";

export interface ParsedCredentialPaste {
  username: string;
  domain: string | null;
  secret: string;
  type: "password" | "hash";
}

/** `user:RID:LM:NT:::`, the line secretsdump and pwdump print. */
const DUMP_RE = /^(.+?):\d+:([0-9a-f]{32}):([0-9a-f]{32}):::?$/i;
/** An IPv4 address or a dotted host name: what `host:port` has before its colon. */
const HOSTLIKE_RE = /^(\d{1,3}(\.\d{1,3}){3}|[^\s\\@]*\.[^\s\\@]*)$/;

export function parseCredentialPaste(text: string): ParsedCredentialPaste | null {
  const line = text.trim();
  if (line === "" || /[\r\n]/.test(line)) return null;
  // A URL, not a credential.
  if (line.includes("://")) return null;

  const dump = DUMP_RE.exec(line);
  const colon = dump ? dump[1]!.length : line.indexOf(":");
  if (colon < 0) return null;
  const account = line.slice(0, colon).trim();
  const secret = dump ? `${dump[2]}:${dump[3]}` : line.slice(colon + 1);
  // "Note: remember this" and "Some note: x" are sentences, not credentials: no whitespace in the account, none opening the secret.
  if (/\s/.test(account) || /^\s/.test(secret)) return null;
  if (secret === "") return null;
  // host:port, not a credential (an all-digit password is one when its account is a plain account name).
  if (/^\d+$/.test(secret) && HOSTLIKE_RE.test(account) && Number(secret) <= 65535) return null;

  let username = account;
  let domain: string | null = null;
  const backslash = account.lastIndexOf("\\");
  const at = account.lastIndexOf("@");
  if (backslash >= 0) {
    domain = account.slice(0, backslash).trim();
    username = account.slice(backslash + 1).trim();
  } else if (at >= 0) {
    username = account.slice(0, at).trim();
    domain = account.slice(at + 1).trim();
  }
  if (username === "") return null;

  const isHash = isNtShape(secret);
  return {
    username,
    domain: domain === "" ? null : domain,
    secret,
    type: isHash ? "hash" : "password",
  };
}
