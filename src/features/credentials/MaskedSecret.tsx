import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";
import { IconButton } from "../../ui";
import { copySecret } from "../../lib/clipboard";

export const MASK = "••••••••";

/** Copy puts the real value on the clipboard without revealing it. */
export function CopySecretButton({ secret, label }: { secret: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={`Copy ${label}`}
      onClick={() => {
        void copySecret(secret).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

/**
 * A secret as a fixed 8-dot mask that never wraps. The eye reveals it in place; Copy is its own track
 * (omit it with `copy={false}` when the row has Copy in its action cell).
 */
export function MaskedSecret({ secret, label, copy = true }: { secret: string; label: string; copy?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`inline-grid items-center gap-1 ${copy ? "grid-cols-[max-content_28px_28px]" : "grid-cols-[max-content_28px]"}`}>
      <span
        className={`whitespace-nowrap font-mono text-code text-fg ${shown ? "max-w-[32ch] truncate" : ""}`}
        title={shown ? secret : undefined}
        data-testid="secret-text"
      >
        {shown ? secret : MASK}
      </span>
      <IconButton
        icon={shown ? EyeSlash : Eye}
        label={shown ? "Hide secret" : "Reveal secret"}
        onClick={() => setShown((v) => !v)}
      />
      {copy && <CopySecretButton secret={secret} label={label} />}
    </span>
  );
}
