import { useCallback, useRef } from "react";
import { Input } from "../../ui";
import { TransferGenerator } from "../generators/TransferGenerator";
import type { PayloadFit } from "./usePayloadFit";
import { lhostPlaceholder } from "./usePayloadSession";
import { usePayloadsStore } from "./usePayloadsStore";

/**
 * Transfer in Payloads (drawer and Workbench): the Arsenal's "Transfer a file" generator, moved here. It fills for the
 * host the Payloads host chip picked (there is no second host control), with Payloads' OS and LHOST, and keeps its own
 * keys (⌘↵ copies and logs the target half). Keyed by engagement, as it was in the Arsenal: the file and method stay
 * when you pick another host. `lhostField`: show an LHOST field here (the drawer; the Workbench has one on the left),
 * so the copy guard has somewhere to send a blank IP. Otherwise `focusToken` finds the view's own.
 */
export function TransferPanel({ engagementId, hostId, fit, lhostField, focusToken, autoFocus }: {
  engagementId: string; hostId: string | null; fit: PayloadFit; lhostField?: boolean; focusToken: (token: string) => void; autoFocus?: boolean;
}) {
  const lhostRef = useRef<HTMLInputElement>(null);
  const focus = useCallback((t: string) => (t === "LHOST" && lhostRef.current ? lhostRef.current.focus() : focusToken(t)), [focusToken]);
  return (
    <div className="grid content-start gap-4">
      {lhostField && (
        <label className="grid grid-cols-[max-content_minmax(0,14rem)] items-center gap-3">
          <span className="font-mono text-code text-muted">LHOST</span>
          <Input
            mono aria-label="LHOST" ref={lhostRef} value={fit.lhostInput} placeholder={lhostPlaceholder(fit.settingsLhost)}
            onChange={(e) => usePayloadsStore.getState().setLhost(e.target.value)}
          />
        </label>
      )}
      <TransferGenerator
        key={engagementId} engagementId={engagementId} hostId={hostId} os={fit.os} lhost={fit.lhost} focusToken={focus} autoFocus={autoFocus}
      />
    </div>
  );
}
