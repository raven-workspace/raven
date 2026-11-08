import * as RD from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row, right-aligned (e.g. Cancel + primary Button). */
  footer?: ReactNode;
  /** `lg` is for forms: wider, higher on screen; `xl` is for forms with embedded lists and code. The body scrolls when it doesn't fit. */
  size?: "md" | "lg" | "xl";
  className?: string;
}

/** Modal on Radix: hairline border, `--surface` panel, Esc closes. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", className }: DialogProps) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <RD.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          // Start on the first control in the body or footer, never the Close button: its tooltip would
          // open on focus and swallow the first Esc.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = e.currentTarget as HTMLElement;
            const first = root.querySelector<HTMLElement>(
              "[data-popup-bounds] :is(input,textarea,select,button,[href],[tabindex]):not([tabindex='-1']):not(:disabled), footer :is(button,[href],input):not(:disabled)",
            );
            (first ?? root).focus();
          }}
          className={cx(
            "fixed left-1/2 z-50 flex -translate-x-1/2 flex-col",
            size === "xl"
              ? "top-[6vh] max-h-[calc(94vh-24px)] w-[min(820px,calc(100vw-32px))]"
              : size === "lg"
                ? "top-[8vh] max-h-[calc(92vh-24px)] w-[min(560px,calc(100vw-32px))]"
                : "top-[18vh] max-h-[calc(82vh-24px)] w-[min(480px,calc(100vw-32px))]",
            "rounded border border-line-2 bg-surface text-fg-2",
            className,
          )}
        >
          <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <RD.Title className="m-0 text-heading text-fg">{title}</RD.Title>
              {description && (
                <RD.Description className="m-0 mt-1 text-meta text-muted">{description}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <IconButton icon={X} label="Close" shortcut="Esc" />
            </RD.Close>
          </header>
          {children !== undefined && <div data-popup-bounds="" className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>}
          {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
