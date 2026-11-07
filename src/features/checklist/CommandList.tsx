import { Copy } from "@phosphor-icons/react";
import { Button, Chip } from "../../ui";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";

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

/** One word with its unresolved tokens wrapped in a warn-coloured mark (no background). */
function Marked({ word, re, tokens }: { word: string; re: RegExp | null; tokens: string[] }) {
  if (!re) return <>{word}</>;
  return (
    <>
      {word.split(re).map((part, i) =>
        tokens.includes(part) ? (
          <mark key={i} className="bg-transparent text-warn">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The command text, one unbreakable span per whitespace-separated word, so a line wraps only at spaces (never inside
 * `-sV` or an IP); a word longer than the block scrolls. The spaces stay plain text, so copying the text is unchanged.
 */
export function MarkedText({ text, tokens }: { text: string; tokens: string[] }) {
  const re = tokens.length > 0 ? new RegExp(`(${tokens.map(escape).join("|")})`) : null;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        part === "" ? null : /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={i} data-testid="command-word" className="inline-block whitespace-nowrap">
            <Marked word={part} re={re} tokens={tokens} />
          </span>
        ),
      )}
    </>
  );
}

const noToken = () => {};
const noCred = () => {};

/**
 * Filled command blocks with a Copy button each. Copy goes through the copy guard: a command with an unresolved token
 * focuses it first (`focusToken` / `focusCred`; a surface with no such field passes nothing and the hint still shows).
 */
export function CommandList({ commands, hostName = null, focusToken = noToken, focusCred = noCred, hideDcNote = false }: {
  commands: FilledCommand[];
  /** The short name of the host in view, for "Copied for <host>". */
  hostName?: string | null;
  focusToken?: (token: string) => void; focusCred?: () => void;
  /** A fill bar above already notes "(by name)" once, on DC_IP: no chip per block. */
  hideDcNote?: boolean;
}) {
  const guard = useCopyGuard({ focusToken, focusCred, hostName });

  const copy = (c: FilledCommand, button: HTMLElement) => {
    // A filled command carries a real credential: that copy is a secret.
    const write = c.copyText !== undefined && c.copyText !== c.text ? copySecret : copyPlain;
    void guard.attempt(c, () => write(c.copyText ?? c.text)).then((r) => {
      // Held back with no field or chip to take focus here: the Copy button keeps it, so Enter is the second press.
      const a = document.activeElement;
      if (r === "guarded" && (!a || a === document.body || a === button)) button.focus();
    });
  };

  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {commands.map((c) => (
        <li key={c.id} className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <span data-testid="command-desc" className="text-xs text-muted">{c.title}</span>
            {guard.forKey === copyKey(c) && (guard.hint || guard.confirm) && (
              <span role="status" className={`text-[11px] ${guard.hint || c.unresolved.length > 0 ? "text-warn" : "text-accent"}`}>
                {guard.hint ?? guard.confirm}
              </span>
            )}
          </div>
          {/* Copy has its own fixed track beside the block, so command text never runs under it. */}
          <div data-testid="command-block" className="grid grid-cols-[minmax(0,1fr)_1.5rem] items-start gap-2">
            <pre className={COMMAND_PRE} tabIndex={0} role="group" aria-label={`Command: ${c.title}`}>
              <MarkedText text={c.text} tokens={c.tokens ?? []} />
            </pre>
            <Button
              size="sm"
              className="mt-1 h-6 w-6 px-0!"
              aria-label={`Copy command: ${c.title}`}
              title="Copy command"
              onClick={(e) => copy(c, e.currentTarget)}
            >
              <Copy size={14} weight={guard.forKey === copyKey(c) && guard.confirm ? "fill" : "light"} aria-hidden className={guard.forKey === copyKey(c) && guard.confirm ? "text-accent" : undefined} />
            </Button>
          </div>
          {(c.msfMarker || c.viaTunnel || (c.dcByName && !hideDcNote)) && (
            <div className="flex flex-wrap gap-1.5">
              {c.dcByName && !hideDcNote && <Chip title="No Kerberos/LDAP seen: the DC was picked by its host name">DC (by name)</Chip>}
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
