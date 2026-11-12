import type { ReactNodeViewProps } from "prosekit/react";
import { REPRODUCE_LABEL } from "../../../../engines/report";
import { Tooltip } from "../../../../ui";
import { addStep } from "../commands";

/** The decoration spec key that carries a step's number in its list (`stepNumbers` in extension.ts). */
export const STEP_NUMBER = "stepNumber";

/**
 * A numbered Steps to reproduce list (§10.2): its bold label, the steps, then "+ Step" to add one at the end (or after
 * the step the cursor is in, as ⌘⇧↵ does). The label and the button are the page's, never the owner's text.
 */
export function StepsView({ contentRef, view, getPos }: ReactNodeViewProps) {
  const add = () => {
    const pos = getPos();
    if (pos === undefined) return;
    addStep(pos)(view.state, view.dispatch, view);
    view.focus();
  };
  return (
    <div className="report-steps">
      <p className="report-steps-label" contentEditable={false}>
        {REPRODUCE_LABEL}
      </p>
      <div ref={contentRef} className="report-steps-list" />
      <div className="report-steps-end" contentEditable={false}>
        <Tooltip content="Add a step (⌘⇧↵)">
          <button type="button" className="report-add-step" onClick={add}>
            + Step
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * One step: its number in a column of its own (the step's drag handle), then its sentence and evidence. The number
 * comes from the page as it is now, so it follows every insertion, removal and move.
 */
export function StepView({ contentRef, decorations }: ReactNodeViewProps) {
  const number = decorations.map((d) => (d.spec as Record<string, unknown>)[STEP_NUMBER]).find((n) => typeof n === "number") as number | undefined;
  return (
    <div className="report-step">
      {/* Dragging the number moves the whole step (the node is draggable; ProseMirror finds it from here). */}
      <span className="report-step-num" contentEditable={false} draggable>
        {number ?? ""}
      </span>
      <div ref={contentRef} className="report-step-body" />
    </div>
  );
}
