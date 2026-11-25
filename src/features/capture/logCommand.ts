import type { QueryClient } from "@tanstack/react-query";
import type { Host } from "../../types/host";
import type { LogEntry } from "../../types/log";
import { storeChanged } from "../../lib/storeChange";
import { useSaveSummaryStore } from "./useSaveSummaryStore";
import { PartialSaveError, saveCapture, type CaptureEdits } from "./saveCapture";

/**
 * Logs a command as a command entry against one host, through the capture save path, so the checklist
 * auto-tick, board and cleanup follow-ups run as they do for a pasted command.
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
  // Known once the entry is stored; a save that failed before that stored nothing (no new hosts: the host is given).
  let entryId: string | null = null;
  try {
    const { entry, summary } = await saveCapture({
      engagementId: id, hosts: args.hosts, image: null, edits,
      draft: { kind: "command", title: args.title, hostIds: [host.id], ranOn: args.ranOn, content, unknownScopeIps: [], scan: null },
    });
    // A command logged with no output files nothing, so there is usually no summary to show.
    entryId = entry.id;
    useSaveSummaryStore.getState().show(entry.id, summary);
    return entry;
  } catch (e) {
    // A partial save may still have stored an extraction: show it, with its Undo.
    if (e instanceof PartialSaveError) {
      entryId = e.entry.id;
      useSaveSummaryStore.getState().show(e.entry.id, e.summary);
    }
    throw e;
  } finally {
    if (entryId !== null) void storeChanged(qc, { entity: "logEntry", id: entryId, change: "saved" });
  }
}
