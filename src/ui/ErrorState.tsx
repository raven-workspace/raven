import { useState } from "react";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";
import "./states.scss";

export interface ErrorStateProps {
  title: string;
  hint: string;
  onRetry: () => void;
  detail?: string;
}

export function ErrorState({ title, hint, onRetry, detail }: ErrorStateProps) {
  const [open, setOpen] = useState(false);
  return (
    <div role="alert" className="state state--error">
      <p className="state__title">{title}</p>
      <p className="state__body">{hint}</p>
      <Button size="sm" onClick={onRetry}>
        Retry
      </Button>
      {detail && (
        <div className="state__details">
          <Disclosure label="Details" open={open} onOpenChange={setOpen}>
            <pre className="state__detail-text">{detail}</pre>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
