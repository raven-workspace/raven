import { ArrowsOut } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useMatch, useNavigate } from "react-router";
import { isFreeKey, useKeydown } from "../../lib/keys";
import { Button, Input, Kbd } from "../../ui";
import { useFillScope } from "../arsenal/useFillScope";
import { ContextChips } from "./ContextChips";
import { PayloadBlock, PayloadView } from "./PayloadView";
import { SqlPanel } from "./SqlPanel";
import { TransferPanel } from "./TransferPanel";
import { GENERATOR_LIST_ID, GENERATORS, hintsFor, usePayloadSession } from "./usePayloadSession";
import { usePayloadsStore } from "./usePayloadsStore";

function DrawerBody({ engagementId, hostId: routeHostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const bodyRef = useRef<HTMLDivElement>(null);
  const s = usePayloadSession({ engagementId, hostId: routeHostId, bodyRef, onEscape: () => usePayloadsStore.getState().close() });
  const { generator, fit, ranked, index, setIndex, def, built, guard, note, hostRef, osRef, contextRef, portRef, psRef } = s;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]" onKeyDown={s.onKeyDown}>
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line px-4 py-2.5">
        <div role="tablist" aria-label="Generator" className="grid grid-flow-col justify-start gap-1 overflow-hidden">
          {GENERATORS.map((g, i) => (
            <button
              key={g.id} type="button" role="tab" aria-selected={generator === g.id} title={`⌥${i + 1}`}
              onClick={() => usePayloadsStore.getState().setGenerator(g.id)}
              className={`cursor-default whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs ${generator === g.id ? "border-accent text-accent" : "border-line-2 text-fg-2 hover:bg-surface-hi"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <Button
          size="sm" aria-label="Full screen" title="Full screen"
          onClick={() => {
            usePayloadsStore.getState().close();
            void navigate("/payloads");
          }}
        >
          <ArrowsOut size={14} aria-hidden="true" />
        </Button>
      </header>
      <ContextChips fit={fit} engagementId={engagementId} onHost={s.setHostId} hostRef={hostRef} osRef={osRef} contextRef={contextRef} portRef={portRef} />
      <div ref={bodyRef} tabIndex={-1} className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 outline-none">
        {ranked && (
          <PayloadView
            fits={ranked.fits} misfits={ranked.misfits} index={index} onIndex={setIndex} ordered={ranked.ordered}
            built={built} fitsLine={s.fitsLine ? `Fits: ${s.fitsLine}` : null} pasteLabel={s.pasteLabel}
            stale={def?.bakesIp ? fit.staleLines.get(def.id) : null} note={note} noteWarn={guard.hint !== null} fields={s.fields}
          />
        )}
        {generator === "encode" && (
          <div className="grid content-start gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">PowerShell command to encode</span>
              <Input mono ref={psRef} aria-label="PowerShell command" value={s.psCommand} onChange={(e) => s.setPsCommand(e.target.value)} />
            </label>
            {built && <PayloadBlock built={built} pasteLabel="Paste into cmd.exe or PowerShell" note={note} noteWarn={guard.hint !== null} />}
          </div>
        )}
        {generator === "transfer" && <TransferPanel engagementId={engagementId} hostId={s.hostId} fit={fit} lhostField focusToken={s.focusToken} />}
        {generator === "sql" && <SqlPanel fit={fit} onFocusToken={s.focusToken} />}
        {s.status && <p role="alert" className="m-0 mt-2 text-xs text-warn">{s.status}</p>}
      </div>
      <footer data-hint-line="" className="border-t border-line px-4 py-2 text-[11px] text-muted">
        {hintsFor(generator, "close").map(([key, label], i) => (
          <span key={key}>
            {i > 0 && " · "}
            <span className="whitespace-nowrap"><Kbd>{key}</Kbd> {label}</span>
          </span>
        ))}
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
    <aside aria-label="Payloads" className="fixed inset-y-0 right-0 z-30 grid w-[560px] max-w-[70vw] border-l border-line-2 bg-surface text-fg-2">
      <DrawerBody engagementId={engagementId} hostId={hostId} />
    </aside>
  );
}
