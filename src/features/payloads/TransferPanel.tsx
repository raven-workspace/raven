import { TransferGenerator } from "../generators/TransferGenerator";

/**
 * Transfer in Payloads (drawer and Workbench): the Arsenal's "Transfer a file" generator, moved here. It fills for the
 * host the Payloads host chip picked (there is no second host control) and keeps its own keys (⌘↵ copies and logs the
 * target half). Keyed by engagement, as it was in the Arsenal: the file and method stay when you pick another host.
 */
export function TransferPanel({ engagementId, hostId, autoFocus }: { engagementId: string; hostId: string | null; autoFocus?: boolean }) {
  return <TransferGenerator key={engagementId} engagementId={engagementId} hostId={hostId} autoFocus={autoFocus} />;
}
