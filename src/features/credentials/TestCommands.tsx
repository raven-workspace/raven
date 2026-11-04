import { useEffect, useRef, useState } from "react";
import { shellQuote, type CommandSet } from "../../engines/credentials";
import type { Credential } from "../../types/credentials";
import { Button } from "../../ui";
import { MASK } from "./MaskedSecret";

const NOTICE: Record<NonNullable<CommandSet["notice"]>, string> = {
  "no-services": "No host has the needed service open.",
  "nothing-left": "Nothing left to try: every host already has a result.",
  "not-sprayable": "This credential can't be sprayed.",
};

/** The command as shown: the secret (and an NT hash's NT half) is replaced by the mask, so it never reaches the DOM. */
export function maskCommand(command: string, cred: Credential): string {
  const parts = new Set<string>([cred.secret]);
  if (cred.type === "hash" && cred.secret.includes(":")) parts.add(cred.secret.trim().split(":")[1] ?? "");
  let out = command;
  for (const p of parts) {
    if (!p) continue;
    out = out.split(shellQuote(p)).join(shellQuote(MASK)).split(p).join(MASK);
  }
  return out;
}

function CopyButton({ text, label, children }: { text: string; label: string; children?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size="sm"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
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

/** Commands for one routine step. Display is masked; Copy puts the real command on the clipboard. */
export function TestCommands({ set, cred }: { set: CommandSet & { usersFile?: string }; cred: Credential }) {
  if (set.commands.length === 0) {
    return <p className="m-0 text-xs text-muted">{set.notice ? NOTICE[set.notice] : "Nothing to run."}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {set.commands.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg-2">{maskCommand(c.command, cred)}</code>
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
