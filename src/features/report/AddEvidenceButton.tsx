import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useState } from "react";
import { entryIdsIn, machinesInOrder, missingEntries, missingTested, type ReportData, type ReportMeta, type ReportNode, type ReportTarget } from "../../engines/report";
import { Button, TimedNotice } from "../../ui";
import { insertBlocksAt, insertEntry } from "./editor/pageActions";
import { removeExact } from "./editor/ReportEditor";

/** What the last run added: its words, and the blocks it put on the page (null when it added nothing). */
interface Added {
  text: string;
  nodes: PMNode[] | null;
}

/**
 * Add new evidence (spec §5): appends the entries the draft would place now that aren't on the page and weren't removed
 * (`missingEntries`), in time order, each where `insertEntry` places it with no cursor, and a machine's Also tested
 * list when the page has none and the draft has one (`missingTested`). It never removes or rewrites anything; Undo
 * takes off exactly what it added. Key it by section.
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
    const page = () => editor.getDocJSON() as ReportNode;
    const nodes: PMNode[] = [];
    let n = 0;
    for (const entry of missingEntries(page(), data, target, meta, removed)) {
      // An entry an earlier insert already placed (a flag its output prints) is not added again.
      if (entryIdsIn(page()).has(entry.id)) continue;
      nodes.push(...insertEntry(editor, data, target, entry, false, meta));
      n++;
    }
    let tested = false;
    for (const hostId of machinesInOrder(data, target)) {
      const run = missingTested(page(), data, target, meta, hostId);
      if (!run) continue;
      nodes.push(...insertBlocksAt(editor, run.index, run.blocks));
      tested = true;
    }
    if (nodes.length === 0) {
      setAdded({ text: "Nothing new to add", nodes: null });
      return;
    }
    const parts = [...(n > 0 ? [`${n} ${n === 1 ? "entry" : "entries"}`] : []), ...(tested ? ["the Also tested list"] : [])];
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
