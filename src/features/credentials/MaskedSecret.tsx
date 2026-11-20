import { useState } from "react";
import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";
import { IconButton, useFlash } from "../../ui";
import { copySecret } from "../../lib/clipboard";

export const MASK = "••••••••";

/** Copy puts the real value on the clipboard without revealing it (`copy` swaps in a plain copy for non-secrets). */
export function CopySecretButton({ secret, label, copy = copySecret }: { secret: string; label: string; copy?: (text: string) => Promise<unknown> }) {
  const [copied, flash] = useFlash(1500);
  return <IconButton icon={copied ? Check : Copy} label={`Copy ${label}`} onClick={() => void copy(secret).then(flash)} />;
}

/**
 * A secret as a fixed 8-dot mask that never wraps. The eye reveals it in place; Copy is its own track
 * (omit it with `copy={false}` when the row has Copy in its action cell).
 */
export function MaskedSecret({ secret, label, copy = true, hideMaskBelow }: { secret: string; label: string; copy?: boolean; /** Container-query class that hides the at-rest dots in a narrow container; a revealed secret always shows. */ hideMaskBelow?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`inline-grid items-center gap-1 ${copy ? "grid-cols-[max-content_28px_28px]" : "grid-cols-[max-content_28px]"}`}>
      <span
        className={`font-mono text-code text-fg ${shown ? "max-w-[32ch] whitespace-normal [overflow-wrap:anywhere]" : `whitespace-nowrap ${hideMaskBelow ?? ""}`}`}
        data-testid="secret-text"
      >
        {shown ? secret : MASK}
      </span>
      <IconButton
        icon={shown ? EyeSlash : Eye}
        label={shown ? "Hide secret" : "Reveal secret"}
        aria-label={`${shown ? "Hide" : "Reveal"} ${label}`}
        onClick={() => setShown((v) => !v)}
      />
      {copy && <CopySecretButton secret={secret} label={label} />}
    </span>
  );
}
