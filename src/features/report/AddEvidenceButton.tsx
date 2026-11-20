import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useState } from "react";
import { draftedEntryBlocks, draftOf, entryIdsIn, joinsAStep, machinesInOrder, missingEntries, missingTested, type ReportData, type ReportMeta, type ReportNode, type ReportTarget } from "../../engines/report";
import { Button, TimedNotice } from "../../ui";
import { collectInserted, insertBlocksAt, insertEntry } from "./editor/pageActions";
import { removeExact } from "./editor/ReportEditor";
import "./AddEvidenceButton.scss";

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
    // The draft is built once for the whole run, never per entry.
    const drafted = draftOf(data, target, meta);
    const missing = missingEntries(page(), data, target, meta, removed, drafted);
    // An entry another missing one shows in its own blocks (a flag its output prints) comes with it, whatever the order.
    const absorbed = new Set(
      missing.flatMap((e) => [...entryIdsIn({ type: "doc", content: draftedEntryBlocks(data, target, meta, e, drafted) })].filter((id) => id !== e.id)),
    );
    // Leads first: an absorbed entry is looked at once the entry that shows it is in, and a screenshot that comes along
    // with a step once that step is on the page.
    const joining = new Set(missing.filter((e) => joinsAStep(data, target, meta, e, drafted)).map((e) => e.id));
    const rank = (e: (typeof missing)[number]) => (absorbed.has(e.id) ? 1 : joining.has(e.id) ? 2 : 0);
    const order = [...missing].sort((a, b) => rank(a) - rank(b));
    let n = 0;
    let tested = false;
    const nodes = collectInserted(editor, () => {
      for (const entry of order) {
        // Placed by an earlier insert (in its `also`): not added twice.
        if (entryIdsIn(page()).has(entry.id)) continue;
        insertEntry(editor, data, target, entry, false, meta, drafted);
        n++;
      }
      for (const hostId of machinesInOrder(data, target)) {
        const run = missingTested(page(), data, target, meta, hostId, removed, drafted);
        if (!run) continue;
        insertBlocksAt(editor, run.index, run.blocks);
        tested = true;
      }
    });
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
          <p className={added.nodes ? "add-evidence__result add-evidence__result--added" : "add-evidence__result"}>{added.text}</p>
        </TimedNotice>
      )}
    </>
  );
}
