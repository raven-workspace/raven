import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children, delayDuration = 300 }: { children: ReactNode; delayDuration?: number }) {
  return <RT.Provider delayDuration={delayDuration}>{children}</RT.Provider>;
}

/** Wraps one focusable child; opens on hover and on keyboard focus. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side="top"
          sideOffset={4}
          className="z-50 rounded-sm border border-line-strong bg-surface px-2 py-1 text-meta text-fg-2 whitespace-nowrap"
        >
          {text}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
