import * as RD from "@radix-ui/react-dialog";
import { useRef } from "react";
import type { Engagement } from "../../../types/engagement";
import { LogEntryForm } from "../LogEntryForm/LogEntryForm";
import { useLogEntryStore } from "../useLogEntryStore";
import "./LogEntrySheet.scss";

/**
 * The log entry sheet (`L`), in the engagement shell only: slides over the right of the engagement screen. Esc closes
 * it and keeps the draft; focus goes back to whatever had it when `L` was pressed. The workspace shell has the log
 * entry tab instead (design §2.5); the sheet goes with the engagement shell at the cutover (RAV-90).
 */
export function LogEntrySheet({ engagement }: { engagement: Engagement }) {
  const open = useLogEntryStore((s) => s.open && s.engagementId === engagement.id);
  const close = useLogEntryStore((s) => s.close);
  const pasteRef = useRef<HTMLElement | null>(null);

  return (
    <RD.Root open={open} onOpenChange={(o) => !o && close()}>
      <RD.Portal>
        <RD.Overlay className="log-entry-sheet__overlay" />
        <RD.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            pasteRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            const el = useLogEntryStore.getState().returnFocus;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
          className="log-entry-sheet"
        >
          <LogEntryForm engagement={engagement} pasteRef={pasteRef} />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
