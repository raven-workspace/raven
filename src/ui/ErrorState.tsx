import { useState } from "react";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";

export interface ErrorStateProps {
  title: string;
  hint: string;
  onRetry: () => void;
  detail?: string;
}

export function ErrorState({ title, hint, onRetry, detail }: ErrorStateProps) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className="grid justify-items-start gap-2 rounded border border-warn px-4 py-3">
      <p className="m-0 text-body font-semibold text-fg">{title}</p>
      <p className="m-0 text-meta text-muted-2">{hint}</p>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
      {detail && (
        <div className="w-full">
          <Disclosure label="Details" open={open} onOpenChange={setOpen}>
            <pre className="m-0 font-mono text-code whitespace-pre-wrap text-muted">{detail}</pre>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
