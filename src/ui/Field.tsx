import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "../lib/cx";
import "./Field.scss";

interface ControlProps {
  id?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}

export interface FieldProps {
  label: ReactNode;
  /** One control (Input, Textarea, Select…). It receives id, aria-invalid and aria-describedby. */
  children: ReactElement<ControlProps>;
  hint?: ReactNode;
  /** When set, the control is marked invalid and the message is linked to it. */
  error?: ReactNode;
  id?: string;
  className?: string;
}

export function Field({ label, children, hint, error, id, className }: FieldProps) {
  const auto = useId();
  const controlId = id ?? children.props.id ?? `f${auto}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : {}),
      })
    : children;

  return (
    <div className={cx("field", className)}>
      <label htmlFor={controlId} className="field__label">
        {label}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}
