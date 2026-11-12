import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

export interface ProofFacts {
  showsIp: boolean;
  showsIdentity: boolean;
  showsHostname: boolean;
  usualPath: boolean;
  hasScreenshot: boolean;
}

const IP_COMMAND = /\b(?:ipconfig|ifconfig)\b|\bip\s+(?:-\S+\s+)*a(?:ddr(?:ess)?)?\b/i;
const WHOAMI = /\bwhoami\b/i;
/** `id` as a command: at a line start or right after a prompt or separator. */
const ID_COMMAND = /(?:^|[;&|$#>]\s*)id(?:\s|$)/m;
const HOSTNAME = /\bhostname\b/i;
const READ_COMMAND = /\b(?:cat|type)\s+(.+)/gi;
const CD_COMMAND = /\bcd\s+(?:\/d\s+)?(.+)/gi;
const USUAL_DIRS = [/^\/root\b/i, /^\/home\/[^/\s]+/i, /^"?C:\\Users\\[^\\]+\\Desktop/i];
const PROMPT_DIR = /^\s*(?:[^\s@]+@[^\s:]+:)?(\/\S*|[A-Za-z]:\\[^>]*)[>#$]/;
const USUAL_PATHS = [/\/root\//i, /\/home\/[^/\s]+\//i, /C:\\Users\\[^\\]+\\Desktop\\/i];

const hasIp = (text: string, ip: string) =>
  new RegExp(`(?<![\\d.])${ip.replace(/\./g, "\\.")}(?!\\d|\\.\\d)`).test(text);

/** A read whose prompt shows a usual directory on the same line, or that follows a `cd` into one. */
function readsFromUsualDir(text: string): boolean {
  let inUsual = false;
  for (const line of text.split(/\r?\n/)) {
    const dir = PROMPT_DIR.exec(line)?.[1];
    const usualPrompt = dir != null && USUAL_DIRS.some((re) => re.test(dir));
    if (usualPrompt && /\b(?:cat|type)\s+\S/i.test(line)) return true;
    for (const m of line.matchAll(CD_COMMAND)) inUsual = USUAL_DIRS.some((re) => re.test(m[1].trim()));
    if (inUsual && /\b(?:cat|type)\s+\S/i.test(line)) return true;
  }
  return false;
}

/** What the pasted proof text of a flag entry shows. Raven can't read the screenshot, only the text. */
export function proofFacts(entry: LogEntry, host: Host): ProofFacts {
  const content = entry.content;
  const flag = content.kind === "flag" ? content : null;
  const text = flag?.proof ?? "";
  const reads = [...text.matchAll(READ_COMMAND)].map((m) => m[1]);
  return {
    showsIp: host.ip != null && host.ip !== "" && IP_COMMAND.test(text) && hasIp(text, host.ip),
    showsIdentity: WHOAMI.test(text) || ID_COMMAND.test(text),
    showsHostname: HOSTNAME.test(text),
    usualPath: reads.some((arg) => USUAL_PATHS.some((re) => re.test(arg))) || readsFromUsualDir(text),
    hasScreenshot: Boolean(flag?.attachmentId),
  };
}
