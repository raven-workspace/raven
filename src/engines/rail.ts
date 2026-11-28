/**
 * The rail (design §1.2): which of its views a route shows, so its current-view bar follows the route. Explorer,
 * Terminals, the six sections, then Field notes, Arsenal, Payloads and Manual. Report has no rail item (the chrome bar's
 * Build report opens it), so its route lights none.
 */
import type { TabPage } from "./tabs";

/** The sections on the rail, in Raven's own order, so their keys count 1–6 down it. Report keeps 7 off the rail. */
export const RAIL_SECTIONS = ["board", "log", "credentials", "findings", "network", "checklist"] as const;

export type RailSection = (typeof RAIL_SECTIONS)[number];

export type RailView = "explorer" | RailSection | "notes" | "arsenal" | "payloads" | "manual";

/**
 * The rail view a page belongs to, or null when none is current. A host or a finding is opened from the Explorer, so
 * its page lights Explorer (as the artboard does on a host page).
 */
export function railViewOf(page: TabPage | null): RailView | null {
  if (!page) return null;
  switch (page.kind) {
    case "section":
      // An unknown section shows the board (SectionRoute), so the board is current.
      if (page.section === "report") return null;
      return (RAIL_SECTIONS as readonly string[]).includes(page.section) ? (page.section as RailSection) : "board";
    case "host":
    case "finding":
      return "explorer";
    case "notes":
      return "notes";
    case "reference":
      return page.page;
  }
}
