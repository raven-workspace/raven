import type { ReactNodeViewProps } from "prosekit/react";
import { PHASE_TITLES, phaseKey, type PhaseAttrs } from "../../../../engines/report";
import { usePageLayout } from "../ReportDataContext";
import { Block } from "./parts";

/** A machine's sub-section heading as OffSec's sample words it ("4.1.2 Initial Access – <vulnerability>"), numbered
 *  from the page at render time. Also tested is a plain label with no number; a finding under Additional findings is
 *  a smaller heading with its title. */
export function PhaseView({ node, selected }: ReactNodeViewProps) {
  const { heading } = usePageLayout();
  const attrs = node.attrs as PhaseAttrs;
  const label = heading(phaseKey(attrs.hostId, attrs.phase, attrs.findingId));
  const text = label?.text ?? PHASE_TITLES[attrs.phase] ?? attrs.phase;
  return (
    <Block selected={selected} kind="phase">
      {attrs.phase === "tested" ? (
        <p className="report-label">{text}</p>
      ) : attrs.phase === "additional" && attrs.findingId ? (
        <h4 className="report-h4">{text}</h4>
      ) : (
        <h3 className="report-h3">
          {label?.number && <span className="report-num">{label.number}</span>}
          {text}
        </h3>
      )}
    </Block>
  );
}
