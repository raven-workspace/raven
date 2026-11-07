/**
 * Parses one pasted line of the form `user:secret`, `DOMAIN\user:secret` or `user@domain:secret` into a credential.
 * Returns null when the text is not a credential, so the paste falls through to the input as plain text.
 */

export interface ParsedCredentialPaste {
  username: string;
  domain: string | null;
  secret: string;
  type: "password" | "hash";
}

const NTLM_RE = /^[0-9a-f]{32}$/i;
const LM_NT_RE = /^[0-9a-f]{32}:[0-9a-f]{32}$/i;

export function parseCredentialPaste(text: string): ParsedCredentialPaste | null {
  const line = text.trim();
  if (line === "" || /[\r\n]/.test(line)) return null;
  // A URL, not a credential.
  if (line.includes("://")) return null;

  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const account = line.slice(0, colon).trim();
  const secret = line.slice(colon + 1);
  // host:port, not a credential.
  if (secret === "" || /^\d+$/.test(secret)) return null;

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

  const isHash = NTLM_RE.test(secret) || LM_NT_RE.test(secret);
  return {
    username,
    domain: domain === "" ? null : domain,
    secret,
    type: isHash ? "hash" : "password",
  };
}
