import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useState } from "react";
import { missingEntries, type ReportData, type ReportMeta, type ReportNode, type ReportTarget } from "../../engines/report";
import { Button, TimedNotice } from "../../ui";
import { insertEntry } from "./editor/pageActions";
import { removeExact } from "./editor/ReportEditor";

/** What the last run added: its words, and the blocks it put on the page (null when it added nothing). */
interface Added {
  text: string;
  nodes: PMNode[] | null;
}

/**
 * Add new evidence (spec §5): appends the entries the draft would place now that aren't on the page and weren't removed
 * (`missingEntries`), in time order, each as a new step at the end of its phase (`insertEntry`). It never removes or
 * rewrites anything; Undo takes off exactly what it added. Key it by section.
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
    const missing = missingEntries(editor.getDocJSON() as ReportNode, data, target, meta, removed);
    if (missing.length === 0) {
      setAdded({ text: "Nothing new to add", nodes: null });
      return;
    }
    const nodes = missing.flatMap((entry) => insertEntry(editor, data, target, entry, false));
    const n = missing.length;
    setAdded({ text: `Added ${n} ${n === 1 ? "entry" : "entries"}`, nodes });
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
