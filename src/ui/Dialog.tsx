import * as RD from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";
import "./Dialog.scss";

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
  /** Radix's focus return on close: `preventDefault()` when the caller has already moved focus somewhere else. */
  onCloseAutoFocus?: (e: Event) => void;
}

/** Modal on Radix: hairline border, `--surface` panel, Esc closes. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", className, onCloseAutoFocus }: DialogProps) {
  // The open animation's clock starts when the panel is styled, but a heavy body (⌘K search) can hold the first paint
  // back for most of it: the panel would first appear nearly settled. Rewind both animations on the frame that paints.
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      for (const el of [overlayRef.current, contentRef.current]) {
        el?.getAnimations?.().forEach((a) => {
          a.currentTime = 0;
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        {/* Overlay and panel share one layer, so a dialog opened from a dialog (a delete confirm) dims the one below. */}
        <RD.Overlay ref={overlayRef} className="raven-overlay dialog-overlay" />
        <RD.Content
          ref={contentRef}
          {...(description ? {} : { "aria-describedby": undefined })}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
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
          className={cx("raven-dialog dialog", `dialog--${size}`, className)}
        >
          <header className="dialog__header">
            <div className="dialog__heading">
              <RD.Title className="dialog__title">{title}</RD.Title>
              {description && (
                <RD.Description className="dialog__description">{description}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <IconButton icon={X} label="Close" shortcut="Esc" />
            </RD.Close>
          </header>
          {children !== undefined && <div data-popup-bounds="" className="dialog__body">{children}</div>}
          {footer && <footer className="dialog__footer">{footer}</footer>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
