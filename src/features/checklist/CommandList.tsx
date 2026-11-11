import { useState } from "react";
import { Link, useParams } from "react-router";
import { ChipSet, Chip, CommandBlock } from "../../ui";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { sectionPath } from "../engagements/sections";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";

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
  viaTunnel?: { viaHostId: string; viaHostName: string; down: boolean };
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

const noToken = () => {};
const noCred = () => {};

/**
 * Filled command blocks (one `CommandBlock` each). Copy goes through the copy guard: a command with an unresolved token
 * focuses it first (`focusToken` / `focusCred`; a surface with no such field passes nothing and the hint still shows).
 */
export function CommandList({ commands, hostName = null, focusToken = noToken, focusCred = noCred, hideDcNote = false, strongTitles = false, guard: shared, guardAs, repeatKey }: {
  commands: FilledCommand[];
  /** The short name of the host in view, for "Copied for <host>". */
  hostName?: string | null;
  focusToken?: (token: string) => void; focusCred?: () => void;
  /** A fill bar above already notes "(by name)" once, on DC_IP: no chip per block. */
  hideDcNote?: boolean;
  /** Titles read as headings over their blocks (the Arsenal), not as quiet labels (a checklist goal's commands). */
  strongTitles?: boolean;
  /** One guard shared with another copy control (Transfer's ⌘↵), instead of this list's own. */
  guard?: ReturnType<typeof useCopyGuard>;
  /** Guard every Copy here as this one command (its id and unresolved tokens), so a shared guard has one arm. */
  guardAs?: FilledCommand;
  /** What the hint tells the user to press for the second try. */
  repeatKey?: string;
}) {
  // Always called (hooks rule), even when a shared guard replaces it.
  const own = useCopyGuard({ focusToken, focusCred, hostName, ...(repeatKey ? { repeatKey } : {}) });
  const guard = shared ?? own;
  // With one guard over several blocks, its status shows on the block last pressed (the first until one is).
  const [pressed, setPressed] = useState<string | null>(null);
  const statusId = guardAs ? (commands.some((x) => x.id === pressed) ? pressed : commands[0]?.id) : null;

  const engagementId = useParams().id;

  const copy = (c: FilledCommand, button: HTMLElement) => {
    // A filled command carries a real credential: that copy is a secret.
    setPressed(c.id);
    const write = c.copyText !== undefined && c.copyText !== c.text ? copySecret : copyPlain;
    return guard.attempt(guardAs ?? c, () => write(c.copyText ?? c.text)).then((r) => {
      // Held back with no field or chip to take focus here: the Copy button keeps it, so Enter is the second press.
      const a = document.activeElement;
      if (r === "guarded" && (!a || a === document.body || a === button)) button.focus();
      return r;
    });
  };

  return (
    <ul className="m-0 grid list-none gap-4 p-0">
      {commands.map((c) => (
        <li key={c.id} className="grid gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <span data-testid="command-desc" className={strongTitles ? "text-body font-medium text-fg" : "text-meta text-muted-2"}>{c.title}</span>
            {guard.forKey === copyKey(guardAs ?? c) && (!guardAs || statusId === c.id) && (guard.hint || guard.confirm) && (
              <span role="status" className={`text-meta ${guard.hint || c.unresolved.length > 0 ? "text-warn" : "text-accent"}`}>
                {guard.hint ?? guard.confirm}
              </span>
            )}
          </div>
          <div data-testid="command-block">
            <CommandBlock
              text={c.text}
              {...(c.copyText !== undefined ? { copyText: c.copyText } : {})}
              tokens={c.tokens ?? []}
              name={c.title}
              copyLabel={`Copy command: ${c.title}`}
              onCopyAction={(button) => copy(c, button)}
            />
          </div>
          {(c.msfMarker || c.viaTunnel || (c.dcByName && !hideDcNote)) && (
            <ChipSet>
              {c.dcByName && !hideDcNote && <Chip title="No Kerberos/LDAP seen: the DC was picked by its host name">DC (by name)</Chip>}
              {c.msfMarker && <Chip>uses your one Metasploit host</Chip>}
              {c.viaTunnel && (() => {
                const label = c.viaTunnel.down ? `via tunnel on ${c.viaTunnel.viaHostName} (down)` : `via tunnel on ${c.viaTunnel.viaHostName}`;
                const variant = c.viaTunnel.down ? "warn" : "default";
                // Outside an engagement there is no Network to open: the note stays a plain chip.
                if (!engagementId) return <Chip variant={variant}>{label}</Chip>;
                return (
                  <Link to={sectionPath(engagementId, "network")} state={{ hostId: c.viaTunnel.viaHostId }} className="inline-grid min-h-6 items-center rounded-full focus-visible:outline-1 focus-visible:outline-accent [&>span]:hover:underline [&>span]:underline-offset-2">
                    <Chip variant={variant}>{label}</Chip>
                  </Link>
                );
              })()}
            </ChipSet>
          )}
        </li>
      ))}
    </ul>
  );
}
