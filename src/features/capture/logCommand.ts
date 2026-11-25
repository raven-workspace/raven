import type { QueryClient } from "@tanstack/react-query";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { saveCapture, type CaptureEdits } from "./saveCapture";

/**
 * Logs a command as a command entry against one host, through the capture save path, so the checklist auto-tick,
 * board, Metasploit lock, save summary and error reporting follow as they do for a pasted command.
 */
export async function logCommand(
  qc: QueryClient,
  args: { engagementId: string; host: Host; hosts: Host[]; title: string; command: string; ranOn: string;
    payloadId?: string; payloadValues?: Record<string, string> },
): Promise<LogEntry> {
  const { engagementId: id, host, command } = args;
  const content = { kind: "command" as const, blocks: [{ command, output: "" }] };
  const edits: CaptureEdits = {
    kind: "command", title: args.title, titleEdited: false, hostIds: [host.id], ranOn: args.ranOn,
    observations: "", returnedNothing: false, private: false, content,
    payloadId: args.payloadId, payloadValues: args.payloadValues,
  };
  const { entry } = await saveCapture(qc, {
    engagementId: id, hosts: args.hosts, image: null, edits,
    draft: { kind: "command", title: args.title, hostIds: [host.id], ranOn: args.ranOn, content, unknownScopeIps: [], scan: null },
  });
  return entry;
}
