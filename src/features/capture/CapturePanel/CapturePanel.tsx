import * as RD from "@radix-ui/react-dialog";
import { useRef } from "react";
import type { Engagement } from "../../../types/engagement";
import { CaptureForm } from "../CaptureForm/CaptureForm";
import { useCaptureStore } from "../useCaptureStore";
import "./CapturePanel.scss";

/**
 * The capture sheet (`L`): slides over the right of the engagement screen. Esc closes it and
 * keeps the draft; focus goes back to whatever had it when `L` was pressed.
 */
export function CapturePanel({ engagement }: { engagement: Engagement }) {
  const open = useCaptureStore((s) => s.open && s.engagementId === engagement.id);
  const close = useCaptureStore((s) => s.close);
  const pasteRef = useRef<HTMLElement | null>(null);

  return (
    <RD.Root open={open} onOpenChange={(o) => !o && close()}>
      <RD.Portal>
        <RD.Overlay className="capture-panel__overlay" />
        <RD.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            pasteRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            const el = useCaptureStore.getState().returnFocus;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
          className="capture-panel"
        >
          <CaptureForm engagement={engagement} pasteRef={pasteRef} />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
