import { Chip } from "../../ui";

export interface EvidenceLink {
  entryId: string;
  /** The log entry's title. */
  label: string;
  /** False when the entry was deleted. */
  exists: boolean;
}

/** Evidence chips: a live entry opens in the Story tab; a deleted one just says so. */
export function EvidenceLinks({ evidence, onOpen }: { evidence: EvidenceLink[]; onOpen: (entryId: string) => void }) {
  if (evidence.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {evidence.map((e) =>
        e.exists ? (
          <button key={e.entryId} type="button" onClick={() => onOpen(e.entryId)} className="cursor-default">
            <Chip className="hover:text-fg">↗ {e.label}</Chip>
          </button>
        ) : (
          <Chip key={e.entryId} className="text-faint">log entry removed</Chip>
        ),
      )}
    </div>
  );
}
