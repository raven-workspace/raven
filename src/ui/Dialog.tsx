import * as RD from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./Kbd";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row, right-aligned (e.g. Cancel + primary Button). */
  footer?: ReactNode;
  className?: string;
}

/** Modal on Radix: hairline border, `--surface` panel, Esc closes. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <RD.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cx(
            "fixed top-[18vh] left-1/2 z-50 w-[min(480px,calc(100vw-32px))] -translate-x-1/2",
            "rounded border border-line-2 bg-surface text-fg-2",
            className,
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 pt-3.5 pb-3">
            <div className="min-w-0">
              <RD.Title className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</RD.Title>
              {description && (
                <RD.Description className="m-0 mt-0.5 text-[13px] text-muted">{description}</RD.Description>
              )}
            </div>
            <RD.Close
              aria-label="Close"
              className="shrink-0 rounded-sm border border-transparent p-0.5 hover:border-line-2"
            >
              <Kbd>esc</Kbd>
            </RD.Close>
          </header>
          {children !== undefined && <div className="px-4 py-3.5">{children}</div>}
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
