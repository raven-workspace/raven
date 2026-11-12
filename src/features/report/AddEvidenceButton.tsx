import { XIcon } from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import type { Node as PMNode } from "prosekit/pm/model";
import { useCallback, useEffect, useState } from "react";
import { addNewEvidence, type ReportData, type ReportMeta, type ReportNode, type ReportTarget } from "../../engines/report";
import { Button, IconButton } from "../../ui";
import { insertAdded, removeExact } from "./editor/ReportEditor";

const CLOSE_MS = 5000;

/** What the last run added: its words, and the blocks it put on the page (null when it added nothing). */
interface Added {
  text: string;
  nodes: PMNode[] | null;
}

/** Bottom-left, as the capture save summary: closes itself; the timer waits while hovered or focused. */
function AddedNotice({ added, onUndo, onClose }: { added: Added; onUndo(): void; onClose(): void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = hover || focus;
  useEffect(() => {
    if (held) return;
    const t = setTimeout(onClose, CLOSE_MS);
    return () => clearTimeout(t);
  }, [added, held, onClose]);
  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className="fixed bottom-4 left-4 z-30 grid w-[min(400px,calc(100vw-2rem))] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-md border border-line-2 bg-surface px-3 py-3 text-meta shadow-lg"
    >
      <p className={added.nodes ? "row-span-2 m-0 text-accent" : "m-0 text-muted"}>{added.text}</p>
      <IconButton icon={XIcon} label="Close" onClick={onClose} className="justify-self-end" />
      {added.nodes && (
        <Button size="sm" className="justify-self-end" onClick={onUndo}>
          Undo
        </Button>
      )}
    </div>
  );
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
    if (result.added.length === 0) {
      setAdded({ text: "Nothing new to add", nodes: null });
      return;
    }
    const nodes = insertAdded(editor, before, result.doc);
    const n = result.added.length;
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
      {added && <AddedNotice added={added} onUndo={undo} onClose={close} />}
    </>
  );
}
