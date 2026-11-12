import { Check as CheckIcon, Circle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { groupChecks, type Check, type CheckGroup, type FlagKind } from "../../engines/report";
import { cx } from "../../lib/cx";
import { Button, Disclosure, IconButton, labelClass, Toggle, Tooltip } from "../../ui";

/** A check's one-press fix, offered under it (a long block's "Move to appendix"). */
export interface CheckAction {
  label: string;
  run(): void;
}

/**
 * The open target's checks, in plain words, one line per kind: several checks of a kind read as a count ("12 steps
 * have no explanation") and each click on the row takes the page to the next of them. The picked check
 * shows which one it is, its fix (in a disclosure) and its one-press action under its row.
 */
export function CheckList({
  checks,
  onPick,
  actionFor,
}: {
  checks: Check[];
  onPick(check: Check): void;
  actionFor?(check: Check): CheckAction | undefined;
}) {
  const [picked, setPicked] = useState<{ key: string; at: number } | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  if (checks.length === 0) {
    return (
      <ul aria-label="Checks" className="m-0 grid list-none p-0">
        <li className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 py-1 pl-2 pr-2 text-meta text-muted-2">
          <CheckIcon aria-label="pass" className="size-4 text-accent" />
          <span>No gaps</span>
        </li>
      </ul>
    );
  }
  const groups = groupChecks(checks);
  const pick = (g: CheckGroup) => {
    const at = picked?.key === g.key ? (picked.at + 1) % g.checks.length : 0;
    setPicked({ key: g.key, at });
    setFixOpen(false);
    onPick(g.checks[at]);
  };
  return (
    <ul aria-label="Checks" className="m-0 grid list-none p-0">
      {groups.map((g) => {
        const isPicked = picked?.key === g.key;
        // The group may have shrunk since the pick (a step got its explanation): stay inside it.
        const at = isPicked ? Math.min(picked.at, g.checks.length - 1) : 0;
        const check = g.checks[at];
        const action = isPicked ? actionFor?.(check) : undefined;
        const many = g.checks.length > 1;
        // The picked check in full: always for a single one (its row is the short wording), and for a group when its
        // checks' words differ ("22/tcp on lnx02 is untested.").
        const ownText = !many || g.checks.some((c) => c.text !== g.checks[0].text);
        return (
          <li key={g.key} className="grid">
            <Tooltip content={g.full} side="right">
              <button
                type="button"
                onClick={() => pick(g)}
                className={cx(
                  "grid min-h-7 w-full cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-sm border-0 py-1 pl-2 pr-2 text-left text-meta",
                  isPicked ? "bg-surface text-fg" : "bg-transparent text-muted-2 hover:bg-surface hover:text-fg",
                )}
              >
                {g.level === "fail" ? (
                  <WarningCircle aria-label="gap" className="size-4 text-warn" />
                ) : (
                  <Circle aria-label="worth a look" className="size-4 text-muted" />
                )}
                <span className="min-w-0 truncate">{g.text}</span>
              </button>
            </Tooltip>
            {isPicked && (
              <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 gap-y-1 pb-2 pl-2 pr-2 text-meta text-muted-2">
                <span aria-hidden />
                <div className="grid gap-1">
                  {many && <span className="font-mono tabular-nums">{`${at + 1} of ${g.checks.length}`}</span>}
                  {ownText && <span>{check.text}</span>}
                  {check.fix && (
                    <Disclosure label="Fix" open={fixOpen} onOpenChange={setFixOpen}>
                      <code className="block py-1 pl-6 font-mono text-meta text-fg-2 [overflow-wrap:anywhere]">{check.fix}</code>
                    </Disclosure>
                  )}
                  {action && (
                    <Button size="sm" className="justify-self-start" onClick={action.run}>
                      {action.label}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Per machine: which proof flags the target should have. Two toggles each. */
export function ExpectedFlags({
  machines,
  flagsOf,
  onChange,
}: {
  machines: { hostId: string; name: string }[];
  flagsOf(hostId: string): FlagKind[];
  onChange(hostId: string, flags: FlagKind[]): void;
}) {
  const many = machines.length > 1;
  return (
    <div role="group" aria-label="Expected flags" className="grid gap-2 py-2 pl-2 pr-2">
      <span className="text-meta text-muted-2">Expected flags</span>
      {machines.map((m) => {
        const flags = flagsOf(m.hostId);
        const set = (kind: FlagKind, on: boolean) =>
          onChange(m.hostId, (["local", "proof"] as FlagKind[]).filter((k) => (k === kind ? on : flags.includes(k))));
        return (
          <div key={m.hostId} className={cx("grid items-center gap-2", many ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[auto_auto] justify-start")}>
            {many && <span className="truncate text-meta text-muted-2">{m.name}</span>}
            <Toggle on={flags.includes("local")} onChange={(on) => set("local", on)} aria-label={`${m.name} local.txt`}>
              local.txt
            </Toggle>
            <Toggle on={flags.includes("proof")} onChange={(on) => set("proof", on)} aria-label={`${m.name} proof.txt`}>
              proof.txt
            </Toggle>
          </div>
        );
      })}
    </div>
  );
}


/**
 * The open tab's To do (§10.1): its checks in plain words, and a target's expected flags, at the top of the page pane.
 * A check click takes the page to its block; Esc anywhere in the panel, or its close button, closes it.
 */
export function TodoPanel({
  checks,
  flags,
  onPick,
  actionFor,
  onClose,
  className,
}: {
  checks: Check[];
  /** A target's expected flags, set per machine. */
  flags?: ReactNode;
  onPick(check: Check): void;
  actionFor?(check: Check): CheckAction | undefined;
  onClose(): void;
  className?: string;
}) {
  // Opened, focus moves in (its first check, else the panel itself) so Esc and the arrows work at once.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>('[aria-label="Checks"] button') ?? panel)?.focus();
  }, []);
  // Esc closes from anywhere in the panel. A focused check shows its tooltip, whose layer marks Esc handled before it
  // reaches here; the panel closes anyway, tooltip and all.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <section
      ref={ref}
      aria-label="To do"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cx("grid max-h-80 min-h-0 outline-none grid-rows-[auto_minmax(0,1fr)] border-b border-line bg-surface", className)}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1 pl-6 pr-4">
        <h2 className={cx(labelClass, "m-0")}>To do</h2>
        <IconButton icon={X} label="Close To do" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="grid min-h-0 content-start overflow-y-auto pb-2 pl-4 pr-4">
        <CheckList checks={checks} onPick={onPick} actionFor={actionFor} />
        {flags}
      </div>
    </section>
  );
}
