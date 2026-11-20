import { DisclosureCaret } from "../../../ui/index";
import "./NextTab.scss";

/** "Full checklist ▸": swaps the Next tab between the current stage's open steps and every stage. Sits in the tab row. */
export function FullChecklistToggle({ full, onChange }: { full: boolean; onChange: (full: boolean) => void }) {
  return (
    <button
      type="button"
      aria-expanded={full}
      onClick={() => onChange(!full)}
      className="full-checklist-toggle"
    >
      Full checklist <DisclosureCaret open={full} />
    </button>
  );
}
