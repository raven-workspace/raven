import { DisclosureCaret } from "../../ui";

/** "Full checklist ▸": swaps the Next tab between the current stage's open steps and every stage. Sits in the tab row. */
export function FullChecklistToggle({ full, onChange }: { full: boolean; onChange: (full: boolean) => void }) {
  return (
    <button
      type="button"
      aria-expanded={full}
      onClick={() => onChange(!full)}
      className="grid min-h-7 cursor-default grid-flow-col items-center gap-1 text-meta text-fg-2 hover:text-fg"
    >
      Full checklist <DisclosureCaret open={full} />
    </button>
  );
}
