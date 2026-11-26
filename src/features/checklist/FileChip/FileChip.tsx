import { FilePicker } from "../../generators/FilePicker/FilePicker";
import { filePickFor, useFilePickStore } from "../filePick";
import type { FilledCommand } from "../../commands/filledCommand";
import "./FileChip.scss";

/** The {FILE}/{SCRIPT} chip of a checklist step: the Toolkit picker, scoped to the host the commands are filled for. */
export function FileChip({ commands }: { commands: FilledCommand[] }) {
  useFilePickStore((s) => s.file);
  const c = commands.find((x) => x.fileToken);
  if (!c?.fileToken) return null;
  const { hostId, os, token } = c.fileToken;
  return (
    <label className="file-chip">
      {token}
      <FilePicker name={token} os={os} className="file-chip__picker" value={filePickFor(hostId)} onChange={(v) => useFilePickStore.getState().set(hostId, v)} />
    </label>
  );
}
