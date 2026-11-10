import { isDialogOpen } from "../../lib/keys";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";

/** The note pane's id: `M` on the Manual focuses it. */
export const MANUAL_NOTE_ID = "manual-note";

/** An Arsenal, Payloads or Notes drawer (or a dialog) is over the page: the Manual's keys stand aside. */
export const manualKeysBlocked = () =>
  isDialogOpen() || useArsenalStore.getState().open || usePayloadsStore.getState().open || useNotesStore.getState().open;
