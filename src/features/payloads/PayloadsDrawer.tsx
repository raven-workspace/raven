import { ArrowsOut } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMatch, useNavigate } from "react-router";
import { isFreeKey, useKeydown } from "../../lib/keys";
import { BELOW_TITLE_BAR, HintLine, IconButton, Input } from "../../ui";
import { useFillScope } from "../arsenal/useFillScope";
import { ContextChips } from "./ContextChips";
import { PayloadBlock, PayloadView } from "./PayloadView";
import { SqlPanel } from "./SqlPanel";
import { TransferPanel } from "./TransferPanel";
import { hasToggles, showsFilter } from "./usePayloadFit";
import { GENERATOR_LIST_ID, GENERATORS, hintsFor, usePayloadSession } from "./usePayloadSession";
import { usePayloadsStore } from "./usePayloadsStore";

const TABBABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";
/** The drawer's Tab stops, in order. */
const tabStops = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0 && !el.closest("[hidden], [inert]"));

/**
 * Keeps ⇥ inside the drawer: past its last control (or from the payload body with nothing after it) Tab comes round to
 * the generator tabs and Full screen; ⇧⇥ from the first comes round to the last. The page behind never takes focus.
 */
function wrapTab(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const stops = tabStops(e.currentTarget);
  const at = document.activeElement;
  if (stops.length === 0 || !(at instanceof Node)) return;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  /** `a` is `b` or comes after it. */
  const after = (a: Node, b: Node) => a === b || (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  if (!e.shiftKey && after(at, last)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && after(first, at)) {
    e.preventDefault();
    last.focus();
  }
}

function DrawerBody({ engagementId, hostId: routeHostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const s = usePayloadSession({ engagementId, hostId: routeHostId, bodyRef, onEscape: () => usePayloadsStore.getState().close() });
  const { generator, fit, ranked, index, setIndex, built, guard, note, hostRef, osRef, contextRef, callbacksRef, filterRef, toolsRef, portRef, psRef } = s;
  const hints = useMemo(
    () => hintsFor(generator, "close", [], ranked?.ordered, fit.filterApplies),
    [generator, ranked?.ordered, fit.filterApplies],
  );

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]"
      onKeyDown={(e) => {
        s.onKeyDown(e);
        wrapTab(e);
      }}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2 border-b border-line px-4 py-2">
        <div role="tablist" aria-label="Generator" className="grid grid-flow-col justify-start gap-1 overflow-hidden">
          {GENERATORS.map((g, i) => (
            <button
              key={g.id} type="button" role="tab" aria-selected={generator === g.id} title={`⌥${i + 1}`}
              onClick={() => usePayloadsStore.getState().setGenerator(g.id)}
              // An inset ring, not a border: six tabs at 13px fit the 560px drawer beside Full screen. Only the selected one
              // is outlined (accent); the rest are plain until hovered, so the row reads as one choice, not six boxes.
              className={`h-7 cursor-default whitespace-nowrap rounded-sm px-2 text-meta ring-1 ring-inset ${generator === g.id ? "text-accent ring-accent" : "text-fg-2 ring-transparent hover:bg-surface-hi hover:text-fg"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <IconButton
          icon={ArrowsOut} label="Full screen"
          onClick={() => {
            usePayloadsStore.getState().close();
            void navigate("/payloads");
          }}
        />
      </header>
      <ContextChips fit={fit} engagementId={engagementId} onHost={s.setHostId} onDone={() => bodyRef.current?.focus()} toggleRow={hasToggles(generator)} filterChip={showsFilter(generator, fit.filterApplies)} hostRef={hostRef} osRef={osRef} contextRef={contextRef} portRef={portRef}
        callbacksRef={callbacksRef} filterRef={filterRef} toolsRef={toolsRef}
      />
      <div ref={bodyRef} tabIndex={-1} className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 outline-none">
        {ranked && (
          <PayloadView
            fits={ranked.fits} misfits={ranked.misfits} marks={ranked.marks} index={index} onIndex={setIndex} ordered={ranked.ordered}
            built={built} fitsLine={s.fitsLine ? `Fits: ${s.fitsLine}` : null} {...s.blockProps}
          />
        )}
        {generator === "encode" && (
          <div className="grid content-start gap-3">
            <label className="grid gap-2">
              <span className="text-meta text-muted-2">PowerShell command to encode</span>
              <Input mono ref={psRef} aria-label="PowerShell command" value={s.psCommand} onChange={(e) => s.setPsCommand(e.target.value)} />
            </label>
            {built && (
              <PayloadBlock
                built={built} pasteLabel="Paste into cmd.exe or PowerShell" note={note} noteWarn={guard.hint !== null}
                onCopy={() => s.copy(false)} onCopyListener={s.copyListener}
              />
            )}
          </div>
        )}
        {generator === "transfer" && <TransferPanel engagementId={engagementId} hostId={s.hostId} fit={fit} lhostField focusToken={s.focusToken} />}
        {generator === "sql" && <SqlPanel fit={fit} onFocusToken={s.focusToken} lhostField />}
        {s.status && <p role="alert" className="m-0 mt-2 text-meta text-warn">{s.status}</p>}
      </div>
      <footer className="grid border-t border-line px-4 py-2">
        <HintLine hints={hints} ariaLabel="Payloads shortcuts" />
      </footer>
    </div>
  );
}

/** Payloads (`P`): a drawer on the right edge, built for the host in view. Mounted while unlocked. */
export function PayloadsDrawer() {
  const open = usePayloadsStore((s) => s.open);
  const { engagementId, hostId } = useFillScope();
  const returnFocus = useRef<HTMLElement | null>(null);

  // P toggles the drawer from any unlocked screen. Full-screen Payloads takes focus instead.
  const onFull = useMatch("/payloads") !== null;
  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "p" && e.key !== "P")) return;
    e.preventDefault();
    if (onFull) document.getElementById(GENERATOR_LIST_ID)?.focus();
    else usePayloadsStore.getState().toggle();
  });
  useEffect(() => {
    if (onFull && open) usePayloadsStore.getState().close();
  }, [onFull, open]);

  // A lock unmounts this; the next unlock must not find it open.
  useEffect(() => () => usePayloadsStore.getState().close(), []);

  // A layout effect: it runs before the body's own (passive) effect takes focus, so it sees where focus was before P.
  useLayoutEffect(() => {
    if (!open) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
      return;
    }
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  if (!open || onFull) return null;
  return (
    <aside aria-label="Payloads" data-hint-surface="" className={`fixed ${BELOW_TITLE_BAR} right-0 z-30 grid w-[560px] max-w-[70vw] border-l border-line-2 bg-surface text-fg-2`}>
      <DrawerBody engagementId={engagementId} hostId={hostId} />
    </aside>
  );
}
