import { isDialogOpen } from "../../lib/keys";
import { anyDrawerOpen } from "../drawers";

/** The note pane's id: `M` on the Manual focuses it. */
export const MANUAL_NOTE_ID = "manual-note";

/** An Arsenal, Payloads or Notes drawer (or a dialog) is over the page: the Manual's keys stand aside. */
export const manualKeysBlocked = () =>
  isDialogOpen() || anyDrawerOpen();
