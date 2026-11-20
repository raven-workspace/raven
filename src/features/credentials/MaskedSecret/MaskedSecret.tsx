import { useState } from "react";
import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";
import { IconButton, useFlash } from "../../../ui/index";
import { copySecret } from "../../../lib/clipboard";
import { cx } from "../../../lib/cx";
import "./MaskedSecret.scss";

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
export function MaskedSecret({ secret, label, copy = true, hideMaskBelow }: { secret: string; label: string; copy?: boolean; /** A class (with a container query) that hides the at-rest dots in a narrow container; a revealed secret always shows. */ hideMaskBelow?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={cx("masked-secret", copy && "masked-secret--copy")}>
      <span
        className={cx("masked-secret__text", shown ? "masked-secret__text--shown" : hideMaskBelow)}
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
