import { Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "../../ui";
import { copyPlain, copySecret } from "../../lib/clipboard";

/** A command block: wraps only at whitespace; a token longer than the width scrolls instead of breaking. */
export const COMMAND_PRE = "m-0 overflow-x-auto whitespace-pre-wrap rounded-sm border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-fg";

export interface FilledCommand {
  id: string;
  title: string;
  /** What is shown: PASS and HASH are masked. */
  text: string;
  /** What Copy puts on the clipboard: the real values. Falls back to `text`. */
  copyText?: string;
  unresolved: string[];
  /** Exam sim, no host locked yet: this command would spend the one Metasploit host. */
  msfMarker: boolean;
  viaTunnel?: { viaHostName: string; down: boolean };
  /** The DC in this command was picked by host name only. */
  dcByName?: boolean;
  /** Field-manual commands: the Arsenal card they came from. */
  cardId?: string;
  /** Uses {FILE} or {SCRIPT}: the step shows the Toolkit picker for this host. */
  fileToken?: { hostId: string; os: "windows" | "linux" | null; token: "FILE" | "SCRIPT" };
  /** Uses {PORT} and the host has several matching open ports: the step shows a port chip. */
  portToken?: { key: string; choices: number[]; picked: number };
  /** The raw unresolved tokens as they appear in `text`, to mark. */
  tokens?: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The command text with unresolved tokens wrapped in a warn-coloured mark (no background). */
function Text({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const re = new RegExp(`(${tokens.map(escape).join("|")})`);
  return (
    <>
      {text.split(re).map((part, i) =>
        tokens.includes(part) ? (
          <mark key={i} className="bg-transparent text-warn">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function CommandList({ commands }: { commands: FilledCommand[] }) {
  const [copied, setCopied] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (c: FilledCommand) => {
    // A filled command carries a real credential: that copy is a secret.
    const write = c.copyText !== undefined && c.copyText !== c.text ? copySecret : copyPlain;
    void write(c.copyText ?? c.text).then(() => {
      setCopied(c.id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(undefined), 1500);
    });
  };

  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {commands.map((c) => (
        <li key={c.id} className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <span data-testid="command-desc" className="text-xs text-muted">{c.title}</span>
            {copied === c.id && <span role="status" className="text-[11px] text-accent">Copied</span>}
          </div>
          {/* Copy has its own fixed track beside the block, so command text never runs under it. */}
          <div data-testid="command-block" className="grid grid-cols-[minmax(0,1fr)_1.5rem] items-start gap-2">
            <pre className={COMMAND_PRE}>
              <Text text={c.text} tokens={c.tokens ?? []} />
            </pre>
            <Button
              size="sm"
              className="mt-1 h-6 w-6 px-0!"
              aria-label={`Copy command: ${c.title}`}
              title="Copy command"
              onClick={() => copy(c)}
            >
              <Copy size={14} weight={copied === c.id ? "fill" : "light"} aria-hidden className={copied === c.id ? "text-accent" : undefined} />
            </Button>
          </div>
          {(c.msfMarker || c.viaTunnel || c.dcByName) && (
            <div className="flex flex-wrap gap-1.5">
              {c.dcByName && <Chip title="No Kerberos/LDAP seen: the DC was picked by its host name">DC (by name)</Chip>}
              {c.msfMarker && <Chip>uses your one Metasploit host</Chip>}
              {c.viaTunnel && (
                <Chip className={c.viaTunnel.down ? "border-warn text-warn" : undefined}>
                  via tunnel on {c.viaTunnel.viaHostName}
                  {c.viaTunnel.down ? " (down)" : ""}
                </Chip>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
