import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useState } from "react";
import { addNewEvidence, type ReportData, type ReportMeta, type ReportNode, type ReportTarget } from "../../engines/report";
import { Button, TimedNotice } from "../../ui";
import { insertAdded, removeExact } from "./editor/ReportEditor";

/** What the last run added: its words, and the blocks it put on the page (null when it added nothing). */
interface Added {
  text: string;
  nodes: PMNode[] | null;
}

/**
 * Add new evidence (spec §5): appends entries that now qualify, aren't on the page and weren't removed, each at the
 * end of its phase. It never removes or rewrites anything; Undo takes off exactly what it added. Key it by section.
 */
export function AddEvidenceButton({
  editor,
  data,
  target,
  meta,
  removed,
  onAdded,
}: {
  editor: Editor | null;
  data: ReportData;
  target: ReportTarget;
  meta: ReportMeta;
  removed: string[];
  /** The page changed: write it now rather than after the autosave delay. */
  onAdded(): void;
}) {
  const [added, setAdded] = useState<Added | null>(null);
  const close = useCallback(() => setAdded(null), []);
  const run = () => {
    if (!editor) return;
    const before = editor.getDocJSON() as ReportNode;
    const result = addNewEvidence(before, data, target, meta, removed);
    if (result.added.length === 0 && result.addedTested.length === 0) {
      setAdded({ text: "Nothing new to add", nodes: null });
      return;
    }
    const nodes = insertAdded(editor, before, result.doc);
    const n = result.added.length;
    const parts = [...(n > 0 ? [`${n} ${n === 1 ? "entry" : "entries"}`] : []), ...(result.addedTested.length > 0 ? ["the Also tested list"] : [])];
    setAdded({ text: `Added ${parts.join(" and ")}`, nodes });
    onAdded();
  };
  const undo = () => {
    if (editor && added?.nodes) {
      removeExact(editor, added.nodes);
      onAdded();
    }
    setAdded(null);
  };
  return (
    <>
      <Button size="sm" disabled={!editor} onClick={run}>
        Add new evidence
      </Button>
      {added && (
        <TimedNotice
          timerKey={added}
          onClose={close}
          action={
            added.nodes ? (
              <Button size="sm" onClick={undo}>
                Undo
              </Button>
            ) : undefined
          }
        >
          <p className={added.nodes ? "m-0 text-accent" : "m-0 text-muted"}>{added.text}</p>
        </TimedNotice>
      )}
    </>
  );
}
