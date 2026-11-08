import { useEffect, useRef, useState } from "react";
import type { CommandSet } from "../../engines/credentials";
import { Button, CommandBlock } from "../../ui";
import { copySecret } from "../../lib/clipboard";

const NOTICE: Record<NonNullable<CommandSet["notice"]>, string> = {
  "no-services": "No host has the needed service open.",
  "nothing-left": "Nothing left to try: every host already has a result.",
  "not-sprayable": "This credential can't be sprayed.",
};

function CopyUsersButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      aria-label="Copy users.txt for spray"
      onClick={() =>
        void copySecret(text).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Copied" : "Copy users.txt"}
    </Button>
  );
}

/** Commands for one routine step. `shown` is the same build with the secret masked; Copy uses the real one. */
export function TestCommands({ set, shown }: { set: CommandSet & { usersFile?: string }; shown: CommandSet }) {
  if (set.commands.length === 0) {
    return <p className="m-0 text-meta text-muted">{set.notice ? NOTICE[set.notice] : "Nothing to run."}</p>;
  }
  return (
    <div className="grid gap-1">
      {set.commands.map((c, i) => (
        <CommandBlock
          key={i}
          text={shown.commands[i]?.command ?? ""}
          copyText={c.command}
          copyLabel={`Copy ${c.service} ${c.authMode} command`}
        />
      ))}
      {set.usersFile && (
        <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2 text-meta text-muted">
          <span>users.txt ({set.usersFile.split("\n").length} usernames)</span>
          <CopyUsersButton text={set.usersFile} />
        </div>
      )}
    </div>
  );
}
