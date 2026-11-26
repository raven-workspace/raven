import { ArrowCounterClockwise, Check as CheckIcon, Circle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { groupChecks, type Check, type CheckGroup, type FlagKind } from "../../../engines/report/index";
import { cx } from "../../../lib/cx";
import { Button, Disclosure, IconButton, labelClass, Toggle, Tooltip } from "../../../ui/index";
import "./TodoPanel.scss";

/** A check's one-press fix, offered under it (a long block's "Move to appendix"). */
export interface CheckAction {
  label: string;
  run(): void;
}

/**
 * The open target's checks, in plain words, one line per kind: several checks of a kind read as a count ("12 steps
 * have no explanation") and each click on the row takes the page to the next of them. The picked check
 * shows which one it is, its fix (in a disclosure), its one-press action and Dismiss (a false positive) under its row.
 */
export function CheckList({
  checks,
  onPick,
  actionFor,
  onDismiss,
}: {
  checks: Check[];
  onPick(check: Check): void;
  actionFor?(check: Check): CheckAction | undefined;
  /** Takes checks off the list (a false positive), by id. */
  onDismiss?(ids: string[]): void;
}) {
  const [picked, setPicked] = useState<{ key: string; at: number } | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  if (checks.length === 0) {
    return (
      <ul aria-label="Checks" className="check-list">
        <li className="check-list__empty">
          <CheckIcon aria-label="pass" className="check-list__icon check-list__icon--pass" />
          <span>Nothing to do on this tab</span>
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
    <ul aria-label="Checks" className="check-list">
      {groups.map((g) => {
        const isPicked = picked?.key === g.key;
        // The group may have shrunk since the pick (a step got its explanation): stay inside it.
        const at = isPicked ? Math.min(picked.at, g.checks.length - 1) : 0;
        const check = g.checks[at];
        const action = isPicked ? actionFor?.(check) : undefined;
        const many = g.checks.length > 1;
        // The picked check in full: always for a single one (its row is the short wording), and for a group when its
        // checks' words differ ("22/tcp on lnx02 is untested."). A single check whose row already reads in full (a kind
        // with no short wording) isn't said twice.
        const sameAsRow = !many && check.text.replace(/\.$/, "") === g.text.replace(/\.$/, "");
        const ownText = (!many && !sameAsRow) || (many && g.checks.some((c) => c.text !== g.checks[0].text));
        return (
          <li key={g.key} className="check-list__item">
            <Tooltip content={g.full} side="right">
              <button
                type="button"
                onClick={() => pick(g)}
                className={cx("check-list__row", isPicked && "check-list__row--picked")}
              >
                {g.level === "fail" ? (
                  <WarningCircle aria-label="gap" className="check-list__icon check-list__icon--gap" />
                ) : (
                  <Circle aria-label="worth a look" className="check-list__icon check-list__icon--look" />
                )}
                <span className="check-list__text">{g.text}</span>
              </button>
            </Tooltip>
            {isPicked && (
              <div className="check-list__detail">
                <span aria-hidden />
                <div className="check-list__detail-body">
                  {many && <span className="check-list__count">{`${at + 1} of ${g.checks.length}`}</span>}
                  {ownText && <span>{check.text}</span>}
                  {check.fix && (
                    <Disclosure label="Fix" open={fixOpen} onOpenChange={setFixOpen}>
                      <code className="check-list__fix">{check.fix}</code>
                    </Disclosure>
                  )}
                  {(action || onDismiss) && (
                    <div className="check-list__actions">
                      {action && (
                        <Button size="sm" onClick={action.run}>
                          {action.label}
                        </Button>
                      )}
                      {onDismiss && (
                        <Button size="sm" onClick={() => onDismiss([check.id])}>
                          Dismiss
                        </Button>
                      )}
                      {onDismiss && many && (
                        <Button size="sm" onClick={() => onDismiss(g.checks.map((c) => c.id))}>
                          {`Dismiss all ${g.checks.length}`}
                        </Button>
                      )}
                    </div>
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
    <div role="group" aria-label="Expected flags" className="expected-flags">
      <span className="expected-flags__label">Expected flags</span>
      {machines.map((m) => {
        const flags = flagsOf(m.hostId);
        const set = (kind: FlagKind, on: boolean) =>
          onChange(m.hostId, (["local", "proof"] as FlagKind[]).filter((k) => (k === kind ? on : flags.includes(k))));
        return (
          <div key={m.hostId} className={cx("expected-flags__machine", many && "expected-flags__machine--named")}>
            {many && <span className="expected-flags__name">{m.name}</span>}
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
 * The open tab's To do (§10.1): its checks in plain words, the ones the owner dismissed (folded, each can come back),
 * and a target's expected flags, at the top of the page pane.
 * A check click takes the page to its block; Esc anywhere in the panel, or its close button, closes it.
 */
export function TodoPanel({
  checks,
  flags,
  others = [],
  onOpenTab,
  onPick,
  actionFor,
  dismissed = [],
  onDismiss,
  onRestore,
  onClose,
  className,
}: {
  checks: Check[];
  /** The tab's checks the owner dismissed, listed apart (folded) with a way back. */
  dismissed?: Check[];
  onDismiss?(ids: string[]): void;
  onRestore?(ids: string[]): void;
  /** A target's expected flags, set per machine. */
  flags?: ReactNode;
  /** The other tabs that still have checks to do (the strip's count is report-wide): each opens its tab. */
  others?: { id: string; label: string; todo: number }[];
  onOpenTab?(id: string): void;
  onPick(check: Check): void;
  actionFor?(check: Check): CheckAction | undefined;
  onClose(): void;
  className?: string;
}) {
  // Opened, and again on another tab picked from it, focus moves in (its first check, else the panel itself) so Esc
  // and the arrows work at once.
  const ref = useRef<HTMLElement>(null);
  const [moved, setMoved] = useState(0);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  useEffect(() => {
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>('[aria-label="Checks"] button') ?? panel)?.focus();
  }, [moved]);
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
      className={cx("todo-panel", className)}
    >
      <header className="todo-panel__header">
        <h2 className={labelClass}>To do</h2>
        <IconButton icon={X} label="Close To do" shortcut="Esc" onClick={onClose} />
      </header>
      <div className="todo-panel__body">
        <CheckList checks={checks} onPick={onPick} actionFor={actionFor} onDismiss={onDismiss} />
        {dismissed.length > 0 && onRestore && (
          <div className="todo-panel__dismissed">
            <Disclosure label="Dismissed" count={dismissed.length} open={dismissedOpen} onOpenChange={setDismissedOpen}>
              <ul aria-label="Dismissed checks" className="check-list">
                {dismissed.map((c) => (
                  <li key={c.id} className="todo-panel__dismissed-item">
                    <span aria-hidden />
                    <span className="todo-panel__dismissed-text">{c.text}</span>
                    <IconButton icon={ArrowCounterClockwise} label="Bring back" onClick={() => onRestore([c.id])} />
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
        {others.length > 0 && onOpenTab && (
          <div className="todo-panel__others">
            <span className="todo-panel__others-label">Still to do on</span>
            <ul aria-label="Tabs with checks" className="check-list">
              {others.map((t) => (
                <li key={t.id} className="check-list__item">
                  <button
                    type="button"
                    aria-label={`Open ${t.label}, ${t.todo} to do`}
                    onClick={() => {
                      onOpenTab(t.id);
                      setMoved((n) => n + 1);
                    }}
                    className="todo-panel__other"
                  >
                    <WarningCircle aria-hidden className="check-list__icon check-list__icon--gap" />
                    <span className="check-list__text">{t.label}</span>
                    <span className="check-list__count">{`${t.todo} to do`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {flags}
      </div>
    </section>
  );
}
