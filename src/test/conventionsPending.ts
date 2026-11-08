export type RuleId =
  "tiny-type" | "feature-flex" | "joined-strings" | "hand-hint" | "esc-close" | "unknown-color" | "off-scale-spacing";

/** Files that still break a rule. Later tasks fix files and remove them from here. */
export const PENDING: Record<RuleId, string[]> = {
  "tiny-type": [],
  "feature-flex": [],
  "joined-strings": [],
  "hand-hint": [],
  "esc-close": [],
  "unknown-color": [],
  "off-scale-spacing": [],
};
