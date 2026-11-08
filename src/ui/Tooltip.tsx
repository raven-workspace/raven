import * as RT from "@radix-ui/react-tooltip";
import { createContext, useContext, useState, type ReactNode } from "react";

/** True under a TooltipProvider, so tooltips share it (and its skip delay) instead of bringing their own. */
const HasProvider = createContext(false);

/** One per app (App.tsx): moving from one tooltip to the next within the skip delay opens it at once. */
export function TooltipProvider({ children, delayDuration = 300 }: { children: ReactNode; delayDuration?: number }) {
  return (
    <HasProvider.Provider value={true}>
      <RT.Provider delayDuration={delayDuration}>{children}</RT.Provider>
    </HasProvider.Provider>
  );
}

/**
 * Wraps one focusable child; opens on hover and on keyboard focus. Uses the app's TooltipProvider; with none above it
 * (a component rendered on its own, as in a unit test) it brings its own.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Keeps the trigger mounted but shows nothing (the expanded sidebar, where the label is already visible). */
  disabled?: boolean;
}) {
  const shared = useContext(HasProvider);
  const [open, setOpen] = useState(false);
  const root = (
    // Controlled, so a disabled tooltip never opens (and never points aria-describedby at nothing).
    <RT.Root open={open && !disabled} onOpenChange={setOpen}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={4}
          className="z-50 rounded-sm border border-line-strong bg-surface px-2 py-1 text-meta text-fg-2 whitespace-nowrap"
        >
          {content}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
  return shared ? root : <RT.Provider delayDuration={300}>{root}</RT.Provider>;
}
