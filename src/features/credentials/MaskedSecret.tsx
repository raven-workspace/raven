import { useEffect, useRef, useState } from "react";
import { Button, Toggle } from "../../ui";
import { copySecret } from "../../lib/clipboard";

export const MASK = "••••••••";

/** A secret shown as dots. Reveal shows it; Copy puts the real value on the clipboard without revealing it. */
export function MaskedSecret({ secret, label }: { secret: string; label: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void copySecret(secret).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 break-all font-mono text-[12.5px] text-fg" data-testid="secret-text">
        {shown ? secret : MASK}
      </span>
      <Toggle on={shown} onChange={setShown} aria-label={`Reveal ${label}`} className="h-5 px-1.5 text-[11px]">
        {shown ? "Hide" : "Reveal"}
      </Toggle>
      <Button size="sm" aria-label={`Copy ${label}`} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}
