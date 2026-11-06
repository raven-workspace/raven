import type { QueryClient } from "@tanstack/react-query";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { credAttemptsKey, credentialsKey, usernamesKey } from "../credentials/queries";
import { saveCapture, type CaptureEdits } from "./saveCapture";

/**
 * Logs a command as a command entry against one host, through the capture save path, so the checklist
 * auto-tick, board and cleanup follow-ups run as they do for a pasted command.
 */
export async function logCommand(
  qc: QueryClient,
  args: { engagementId: string; host: Host; hosts: Host[]; title: string; command: string; ranOn: string },
): Promise<LogEntry> {
  const { engagementId: id, host, command } = args;
  const content = { kind: "command" as const, blocks: [{ command, output: "" }] };
  const edits: CaptureEdits = {
    kind: "command", title: args.title, titleEdited: false, hostIds: [host.id], ranOn: args.ranOn,
    observations: "", returnedNothing: false, private: false, content,
  };
  try {
    return await saveCapture({
      engagementId: id, hosts: args.hosts, addIps: [], image: null, edits,
      draft: { kind: "command", title: args.title, hostIds: [host.id], ranOn: args.ranOn, content, unknownScopeIps: [], scan: null },
    });
  } finally {
    for (const key of [["log", id], ["hosts", id], ["services"], ["services", "engagement", id], ["checklist", id], ["progress"], ["engagement", id], ["engagements"], credentialsKey(id), usernamesKey(id), credAttemptsKey(id)]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  }
}
