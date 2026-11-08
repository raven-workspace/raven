import { FilePicker } from "../generators/FilePicker";
import { filePickFor, useFilePickStore } from "./filePick";
import type { FilledCommand } from "./CommandList";

/** The {FILE}/{SCRIPT} chip of a checklist step: the Toolkit picker, scoped to the host the commands are filled for. */
export function FileChip({ commands }: { commands: FilledCommand[] }) {
  useFilePickStore((s) => s.file);
  const c = commands.find((x) => x.fileToken);
  if (!c?.fileToken) return null;
  const { hostId, os, token } = c.fileToken;
  return (
    <label className="grid grid-cols-[max-content_176px] items-center justify-start gap-2 text-meta text-muted-2">
      {token}
      <FilePicker name={token} os={os} className="h-7 w-full" value={filePickFor(hostId)} onChange={(v) => useFilePickStore.getState().set(hostId, v)} />
    </label>
  );
}
