import { useEffect, useRef, useState } from "react";
import type { CommandSet } from "../../engines/credentials";
import { Button } from "../../ui";
import { copySecret } from "../../lib/clipboard";

const NOTICE: Record<NonNullable<CommandSet["notice"]>, string> = {
  "no-services": "No host has the needed service open.",
  "nothing-left": "Nothing left to try: every host already has a result.",
  "not-sprayable": "This credential can't be sprayed.",
};

function CopyButton({ text, label, children }: { text: string; label: string; children?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      aria-label={label}
      onClick={() =>
        void copySecret(text).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Copied" : (children ?? "Copy")}
    </Button>
  );
}

/** Commands for one routine step. `shown` is the same build with the secret masked; Copy uses the real one. */
export function TestCommands({ set, shown }: { set: CommandSet & { usersFile?: string }; shown: CommandSet }) {
  if (set.commands.length === 0) {
    return <p className="m-0 text-xs text-muted">{set.notice ? NOTICE[set.notice] : "Nothing to run."}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {set.commands.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg-2">{shown.commands[i]?.command ?? ""}</code>
          <CopyButton text={c.command} label={`Copy ${c.service} ${c.authMode} command`} />
        </div>
      ))}
      {set.usersFile && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="flex-1">users.txt ({set.usersFile.split("\n").length} usernames)</span>
          <CopyButton text={set.usersFile} label="Copy users.txt for spray">Copy users.txt</CopyButton>
        </div>
      )}
    </div>
  );
}
