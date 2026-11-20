import type { Host } from "../../types/host";

/** A stand-in host with nothing known: commands filled against it leave every host token unresolved. */
export const blankHost = (engagementId: string, id = ""): Host => ({
  id, engagementId, name: "", ip: null, os: null, boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 0, updatedAt: 0,
});
