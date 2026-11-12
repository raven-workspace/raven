import { Check as CheckIcon, Circle, WarningCircle } from "@phosphor-icons/react";
import { Fragment, type KeyboardEvent, type ReactNode } from "react";
import type { Check, FlagKind } from "../../engines/report";
import { cx } from "../../lib/cx";
import { Button, labelClass, Toggle } from "../../ui";

export type OutlineGroup = "report" | "targets" | "appendices" | "closing";
export type TargetState = "ready" | "gaps" | "not-started";

export interface OutlineItem {
  /** The section id. */
  id: string;
  group: OutlineGroup;
  label: string;
  /** A target's last IP octet (".10"). */
  octet?: string;
  /** Generated from data (appendices). */
  auto?: boolean;
  /** Targets only. */
  state?: TargetState;
  /** Report details with name, email or OSID missing. */
  warn?: boolean;
  /** Standalone targets: ⌥↑/⌥↓ change the grading order. */
  reorderable?: boolean;
}

const GROUP_LABEL: Record<OutlineGroup, string | null> = {
  report: "Report",
  targets: "Targets, in grading order",
  appendices: "Appendices",
  closing: null,
};

const ROW = "[data-outline-row]";

/** Moves focus to the outline row `delta` steps from `from` (or from the open row), clamped to the ends. */
export function focusOutlineRow(root: HTMLElement | null, delta: number, from?: Element | null) {
  if (!root) return;
  const rows = [...root.querySelectorAll<HTMLElement>(ROW)];
  if (rows.length === 0) return;
  const start = from && rows.includes(from as HTMLElement) ? rows.indexOf(from as HTMLElement) : rows.findIndex((r) => r.dataset.open === "true");
  const at = Math.min(rows.length - 1, Math.max(0, (start === -1 ? 0 : start) + delta));
  rows[at].focus();
}

/** The state glyph: accent filled when ready, warn ring with gaps, a line ring when not started. */
function StateGlyph({ state, warn }: { state?: TargetState; warn?: boolean }) {
  if (!state && !warn) return <span aria-hidden />;
  const label = warn ? "details missing" : state === "ready" ? "ready" : state === "gaps" ? "has gaps" : "not started";
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        "mt-1 size-3 rounded-full border-[1.5px]",
        warn || state === "gaps" ? "border-warn" : state === "ready" ? "border-accent bg-accent" : "border-line-strong",
      )}
    />
  );
}

function OutlineRow({ item, open, onOpen, onReorder }: { item: OutlineItem; open: boolean; onOpen(): void; onReorder?(dir: -1 | 1): void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || !item.reorderable || !onReorder) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    onReorder(e.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <button
      type="button"
      data-outline-row
      data-id={item.id}
      data-open={open}
      aria-current={open ? "page" : undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={cx(
        "grid min-h-7 w-full cursor-default grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 rounded-sm border-0 px-2 py-1 text-left text-body",
        open ? "bg-surface-hi text-fg shadow-[inset_2px_0_0_var(--accent)]" : "bg-transparent text-fg-2 hover:bg-surface hover:text-fg",
      )}
    >
      <StateGlyph state={item.state} warn={item.warn} />
      <span className="min-w-0 truncate">{item.label}</span>
      {item.octet ? (
        <span className="font-mono text-code text-faint">{item.octet}</span>
      ) : item.auto ? (
        <span className="text-meta text-faint">auto</span>
      ) : (
        <span />
      )}
    </button>
  );
}

/** A check's one-press fix, offered under it (a long block's "Move to appendix"). */
export interface CheckAction {
  label: string;
  run(): void;
}

/** The open target's checks, in plain words; clicking one takes the page to the place it concerns. */
export function CheckList({
  checks,
  onPick,
  actionFor,
}: {
  checks: Check[];
  onPick(check: Check): void;
  actionFor?(check: Check): CheckAction | undefined;
}) {
  if (checks.length === 0) {
    return (
      <ul aria-label="Checks" className="m-0 grid list-none p-0">
        <li className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 py-1 pl-8 pr-2 text-meta text-muted-2">
          <CheckIcon aria-label="pass" className="size-4 text-accent" />
          <span>No gaps</span>
        </li>
      </ul>
    );
  }
  return (
    <ul aria-label="Checks" className="m-0 grid list-none p-0">
      {checks.map((c) => {
        const action = actionFor?.(c);
        return (
          <li key={c.id} className="grid">
            <button
              type="button"
              onClick={() => onPick(c)}
              className="grid w-full cursor-default grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-sm border-0 bg-transparent py-1 pl-8 pr-2 text-left text-meta text-muted-2 hover:bg-surface hover:text-fg"
            >
              {c.level === "fail" ? (
                <WarningCircle aria-label="gap" className="size-4 text-warn" />
              ) : (
                <Circle aria-label="worth a look" className="size-4 text-muted" />
              )}
              <span className="grid gap-1">
                <span>{c.text}</span>
                {c.fix && <span className="font-mono text-meta text-faint [overflow-wrap:anywhere]">{c.fix}</span>}
              </span>
            </button>
            {action && (
              <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 pb-1 pl-8 pr-2">
                <span aria-hidden />
                <Button size="sm" className="justify-self-start" onClick={action.run}>
                  {action.label}
                </Button>
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
    <div role="group" aria-label="Expected flags" className="grid gap-2 py-2 pl-8 pr-2">
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

/** The report's outline: front matter, targets in grading order, appendices and closing sections. */
export function ReportOutline({
  items,
  openId,
  onOpen,
  onReorder,
  openExtra,
  navRef,
}: {
  items: OutlineItem[];
  openId: string | null;
  onOpen(id: string): void;
  onReorder(id: string, dir: -1 | 1): void;
  /** Rendered under the open item: a target's checks and expected flags. */
  openExtra?: ReactNode;
  navRef?: (el: HTMLElement | null) => void;
}) {
  const groups = (Object.keys(GROUP_LABEL) as OutlineGroup[]).filter((g) => items.some((i) => i.group === g));
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    if (!(e.target as HTMLElement).matches(ROW)) return;
    e.preventDefault();
    focusOutlineRow(e.currentTarget, e.key === "ArrowDown" ? 1 : -1, e.target as Element);
  };
  return (
    <nav ref={navRef} aria-label="Report outline" onKeyDown={onKeyDown} className="grid content-start gap-4 px-3 py-4">
      {groups.map((g) => (
        <div key={g} role="group" aria-label={GROUP_LABEL[g] ?? "Closing"} className="grid gap-1">
          {GROUP_LABEL[g] && <h2 className={cx(labelClass, "m-0 px-2 pb-1")}>{GROUP_LABEL[g]}</h2>}
          {items
            .filter((i) => i.group === g)
            .map((i) => (
              <Fragment key={i.id}>
                <OutlineRow item={i} open={i.id === openId} onOpen={() => onOpen(i.id)} onReorder={(dir) => onReorder(i.id, dir)} />
                {i.id === openId && openExtra}
              </Fragment>
            ))}
        </div>
      ))}
    </nav>
  );
}
