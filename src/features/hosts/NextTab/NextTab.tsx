import { Button, DisclosureCaret } from "../../../ui/index";
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

/**
 * The workspace shell's "Full checklist" (design §2.2): a small button beside Stuck?, doing what FullChecklistToggle
 * does. No caret, so the tab row fits the work column at 1100px; while the full checklist shows, it sits on the surface
 * tint.
 */
export function FullChecklistButton({ full, onChange }: { full: boolean; onChange: (full: boolean) => void }) {
  return (
    <Button size="sm" aria-expanded={full} onClick={() => onChange(!full)} className="full-checklist-button">
      Full checklist
    </Button>
  );
}
