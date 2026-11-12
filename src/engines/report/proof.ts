import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";

export interface ProofFacts {
  showsIp: boolean;
  showsIdentity: boolean;
  showsHostname: boolean;
  usualPath: boolean;
  hasScreenshot: boolean;
}

const IP_COMMAND = /\b(?:ipconfig|ifconfig|ip\s+a(?:ddr)?)\b/i;
const WHOAMI = /\bwhoami\b/i;
/** `id` as a command: at a line start or right after a prompt or separator. */
const ID_COMMAND = /(?:^|[;&|$#>]\s*)id(?:\s|$)/m;
const HOSTNAME = /\bhostname\b/i;
const READ_COMMAND = /\b(?:cat|type)\s+(.+)/gi;
const USUAL_PATHS = [/\/root\//i, /\/home\/[^/\s]+\//i, /C:\\Users\\[^\\]+\\Desktop\\/i];

/** What the pasted proof text of a flag entry shows. Raven can't read the screenshot, only the text. */
export function proofFacts(entry: LogEntry, host: Host): ProofFacts {
  const content = entry.content;
  const flag = content.kind === "flag" ? content : null;
  const text = flag?.proof ?? "";
  const reads = [...text.matchAll(READ_COMMAND)].map((m) => m[1]);
  return {
    showsIp: host.ip != null && host.ip !== "" && IP_COMMAND.test(text) && text.includes(host.ip),
    showsIdentity: WHOAMI.test(text) || ID_COMMAND.test(text),
    showsHostname: HOSTNAME.test(text),
    usualPath: reads.some((arg) => USUAL_PATHS.some((re) => re.test(arg))),
    hasScreenshot: Boolean(flag?.attachmentId),
  };
}
