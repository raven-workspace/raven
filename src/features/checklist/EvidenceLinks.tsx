import { ArrowSquareOut } from "@phosphor-icons/react";
import { Button, ChipSet } from "../../ui";
import "./EvidenceLinks.scss";

export interface EvidenceLink {
  entryId: string;
  /** The log entry's title. */
  label: string;
  /** False when the entry was deleted. */
  exists: boolean;
}

/** Evidence as buttons: a live entry opens in the Log tab; a deleted one just says so. */
export function EvidenceLinks({ evidence, onOpen }: { evidence: EvidenceLink[]; onOpen: (entryId: string) => void }) {
  if (evidence.length === 0) return null;
  return (
    <ChipSet>
      {evidence.map((e) =>
        e.exists ? (
          <Button key={e.entryId} size="sm" className="evidence-links__link" title={e.label} onClick={() => onOpen(e.entryId)}>
            <ArrowSquareOut size={16} aria-hidden className="evidence-links__icon" />
            <span className="evidence-links__label">{e.label}</span>
          </Button>
        ) : (
          <span key={e.entryId} className="evidence-links__removed">log entry removed</span>
        ),
      )}
    </ChipSet>
  );
}
