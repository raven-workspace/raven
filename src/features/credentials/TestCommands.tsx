import type { CommandSet } from "../../engines/credentials";
import { Button, CommandBlock, useFlash } from "../../ui";
import { copySecret } from "../../lib/clipboard";
import "./TestCommands.scss";

const NOTICE: Record<NonNullable<CommandSet["notice"]>, string> = {
  "no-services": "No host has the needed service open.",
  "nothing-left": "Nothing left to try: every host already has a result.",
  "not-sprayable": "This credential can't be sprayed.",
};

function CopyUsersButton({ text }: { text: string }) {
  const [copied, flash] = useFlash(1500);
  return (
    <Button size="sm" aria-label="Copy users.txt for spray" onClick={() => void copySecret(text).then(flash)}>
      {copied ? "Copied" : "Copy users.txt"}
    </Button>
  );
}

/** Commands for one routine step. `shown` is the same build with the secret masked; Copy uses the real one. */
export function TestCommands({ set, shown }: { set: CommandSet & { usersFile?: string }; shown: CommandSet }) {
  if (set.commands.length === 0) {
    return <p className="test-commands__notice">{set.notice ? NOTICE[set.notice] : "Nothing to run."}</p>;
  }
  return (
    <div className="test-commands">
      {set.commands.map((c, i) => (
        <CommandBlock
          key={i}
          text={shown.commands[i]?.command ?? ""}
          copyText={c.command}
          copyLabel={`Copy ${c.service} ${c.authMode} command`}
        />
      ))}
      {set.usersFile && (
        <div className="test-commands__users">
          <span>users.txt ({set.usersFile.split("\n").length} usernames)</span>
          <CopyUsersButton text={set.usersFile} />
        </div>
      )}
    </div>
  );
}
