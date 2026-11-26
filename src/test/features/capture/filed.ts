import type { ExtractionRecord, Filed } from "../../../types/log";

/** A record that lists nothing. */
export const emptyRecord = (): ExtractionRecord => ({
  createdHostIds: [], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [], createdCredentialIds: [],
  credentialsBefore: [], createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [], createdTriedPairIds: [], createdVectorIds: [],
  outputTicks: [], reprovedCredentialIds: [], reprovedUsernameIds: [], promotedTriedPairs: [],
});

/** What the store answers to `extractionFile` for entry l1: the record and the lists default to empty. */
export const filed = (over: Partial<Omit<Filed, "extraction">> & { record?: Partial<ExtractionRecord> } = {}): Filed => {
  const { record, ...rest } = over;
  return {
    extraction: { logEntryId: "l1", engagementId: "e1", summary: { wins: [], counts: [], ticks: [] }, record: { ...emptyRecord(), ...record }, createdAt: 1, undoneAt: null },
    hostIds: {}, scans: [], identityChanged: false, attempts: [], credentials: [], triedPairsAdded: 0, cracked: [], vectors: [], ...rest,
  };
};
