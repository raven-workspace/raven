import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { PASTE_CONTEXTS } from "../../engines/payloads/context";
import { cx } from "../../lib/cx";
import { isDialogOpen, isTypingTarget, useKeydown } from "../../lib/keys";
import { Input, Kbd, labelClass, Toggle } from "../../ui";
import type { ChipPickerHandle } from "../arsenal/ChipPicker";
import { HostChip } from "../arsenal/HostChip";
import { useFillScope } from "../arsenal/useFillScope";
import { PayloadBlock, PayloadView } from "./PayloadView";
import { SqlPanel } from "./SqlPanel";
import { TransferPanel } from "./TransferPanel";
import { OS_LABEL } from "./usePayloadFit";
import { GENERATOR_LIST_ID, GENERATORS, hintsFor, inGeneratorList, isGenerator, otherDrawerOpen, usePayloadSession } from "./usePayloadSession";
import { usePayloadsStore, type PayloadOverride } from "./usePayloadsStore";

/** One labelled block of the left column, with the line saying where the value came from (amber when unknown). */
function ReadItem({ label, why, unknown, children }: { label: string; why?: string | null; unknown?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {why ? <span className="text-xs text-muted">{why}</span> : unknown && <span className="text-xs text-warn">{unknown}</span>}
    </div>
  );
}

/** ⌥O / ⌥W in the Workbench: focus the picked choice of a toggle group (or its first), ready for ⇥ and Space. */
const choiceGroup = (handle: RefObject<ChipPickerHandle | null>) => (el: HTMLDivElement | null) => {
  const focus = () => el && (el.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLElement>("button"))?.focus();
  handle.current = el ? { open: focus, focus } : null;
};

function WorkbenchBody({ engagementId, hostId: scopeHostId }: { engagementId: string; hostId: string | null }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const s = usePayloadSession({ engagementId, hostId: scopeHostId, bodyRef, lhostField: false });
  const { generator, fit, ranked, index, setIndex, def, built, guard, note, hostRef, osRef, contextRef, psRef, fieldEls } = s;
  const override = (patch: PayloadOverride) => usePayloadsStore.getState().override(fit.hostKey, patch);
  const contexts = PASTE_CONTEXTS.filter((c) => !fit.os || c.os === "any" || c.os === fit.os);
  const exam = fit.engagement.kind === "exam-sim";
  const register = (t: string) => (el: HTMLInputElement | null) => {
    if (el) fieldEls.current.set(t, el);
    else fieldEls.current.delete(t);
  };

  /** ↵ or → from the list goes into the generator: its first field (Transfer, Encode) or the payload body. */
  const enterOutput = () => {
    const field = generator === "transfer" || generator === "encode" ? bodyRef.current?.querySelector<HTMLElement>("input") : null;
    (field ?? bodyRef.current)?.focus();
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const at = GENERATORS.findIndex((g) => g.id === generator);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = GENERATORS[(at + (e.key === "ArrowDown" ? 1 : GENERATORS.length - 1)) % GENERATORS.length]!;
      usePayloadsStore.getState().setGenerator(next.id);
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      enterOutput();
    }
  };

  return (
    <main aria-label="Payloads" className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]" onKeyDown={s.onKeyDown}>
      <aside role="complementary" aria-label="Raven's read" className="grid min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden border-r border-line px-5 py-4">
        <h2 className={`${labelClass} m-0`}>Raven's read</h2>
        <ReadItem label="Target">
          {engagementId ? (
            <div className="grid justify-start">
              <HostChip ref={hostRef} hosts={fit.d.hosts} value={fit.host?.id ?? null} onChange={s.setHostId} align="start" className="max-w-80" />
            </div>
          ) : (
            <span className="text-xs text-fg-2">No active engagement</span>
          )}
        </ReadItem>
        <ReadItem label="OS" why={fit.evidence.os} unknown="Not known: pick one">
          <div ref={choiceGroup(osRef)} className="grid grid-cols-2 gap-1.5">
            {(["linux", "windows"] as const).map((o) => (
              <Toggle key={o} on={fit.os === o} onChange={() => override({ os: o })} className="justify-center">{OS_LABEL[o]}</Toggle>
            ))}
          </div>
        </ReadItem>
        <ReadItem label="Where you paste it" why={fit.evidence.context} unknown="Not known: pick one">
          <div ref={choiceGroup(contextRef)} className="grid grid-cols-2 gap-1.5">
            {contexts.map((c) => (
              <Toggle key={c.id} on={fit.context === c.id} onChange={() => override({ context: c.id })} className="min-w-0 justify-center">
                <span className="min-w-0 truncate">{c.label}</span>
              </Toggle>
            ))}
          </div>
        </ReadItem>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs text-muted">LHOST</span>
            <Input
              mono aria-label="LHOST" className="h-7" ref={register("LHOST")} value={fit.lhost} placeholder="Settings: attacker IP"
              onChange={(e) => usePayloadsStore.getState().setLhost(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-muted">LPORT</span>
            <Input
              mono aria-label="LPORT" className="h-7" ref={register("LPORT")} value={fit.port} placeholder="443" inputMode="numeric"
              onChange={(e) => override({ port: e.target.value.replace(/\D/g, "") })}
            />
          </label>
        </div>
        <ReadItem label="Exam rules">
          <span className={cx("text-xs", exam ? "text-fg-2" : "text-muted")}>
            No meterpreter; msfvenom offers stageless shell_reverse_tcp only.{exam ? " Enforced: exam sim." : ""}
          </span>
        </ReadItem>
        <div className="grid gap-1.5 border-t border-line pt-3">
          <span className={labelClass}>Generator</span>
          <div
            id={GENERATOR_LIST_ID} ref={listRef} role="listbox" aria-label="Generator" tabIndex={0}
            aria-activedescendant={`payloads-gen-${generator}`} onKeyDown={onListKey}
            className="grid gap-0.5 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {GENERATORS.map((g, i) => (
              <div
                key={g.id} id={`payloads-gen-${g.id}`} role="option" aria-selected={generator === g.id}
                onClick={() => {
                  usePayloadsStore.getState().setGenerator(g.id);
                  listRef.current?.focus();
                }}
                className={cx(
                  "grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center rounded-sm px-2 py-1 text-[13px]",
                  generator === g.id ? "bg-accent/10 text-accent shadow-[inset_2px_0_0_var(--accent)]" : "text-fg-2 hover:bg-surface-2",
                )}
              >
                <span className="truncate">{g.label}</span>
                <Kbd>⌥{i + 1}</Kbd>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div ref={bodyRef} tabIndex={-1} className="min-h-0 overflow-y-auto overflow-x-hidden px-6 py-5 outline-none">
          {ranked && (
            <PayloadView
              fits={ranked.fits} misfits={ranked.misfits} index={index} onIndex={setIndex} ordered={ranked.ordered}
              built={built} fitsLine={s.fitsLine ? `Fits: ${s.fitsLine}` : null} pasteLabel={s.pasteLabel} numbered
              stale={def?.bakesIp ? fit.staleLines.get(def.id) : null} note={note} noteWarn={guard.hint !== null} fields={s.fields}
              onCopy={() => void s.copy(false)} onCopyListener={s.copyListener}
            />
          )}
          {generator === "encode" && (
            <div className="grid content-start gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-muted">PowerShell command to encode</span>
                <Input mono ref={psRef} aria-label="PowerShell command" value={s.psCommand} onChange={(e) => s.setPsCommand(e.target.value)} />
              </label>
              {built && (
                <PayloadBlock built={built} pasteLabel="Paste into cmd.exe or PowerShell" numbered note={note} noteWarn={guard.hint !== null} onCopy={() => void s.copy(false)} />
              )}
            </div>
          )}
          {generator === "transfer" && <TransferPanel engagementId={engagementId} hostId={s.hostId} fit={fit} focusToken={s.focusToken} autoFocus={!inGeneratorList()} />}
          {generator === "sql" && <SqlPanel fit={fit} onFocusToken={s.focusToken} />}
          {s.status && <p role="alert" className="m-0 mt-2 text-xs text-warn">{s.status}</p>}
        </div>
        <footer data-hint-line="" className="border-t border-line px-6 py-2 text-[11px] text-muted">
          {hintsFor(generator, "back", [["P", "generators"]]).map(([key, label], i) => (
            <span key={key}>
              {i > 0 && " · "}
              <span className="whitespace-nowrap"><Kbd>{key}</Kbd> {label}</span>
            </span>
          ))}
        </footer>
      </div>
    </main>
  );
}

/**
 * `/payloads`, the Workbench: Raven's read of the host on the left (target, OS, where you paste it, LHOST/LPORT, exam
 * rules, generators), the generator's output on the right. Same fit, overrides and keys as the drawer.
 * `?generator=transfer` opens on that generator. Esc goes back where you came from.
 */
export function PayloadsWorkbench() {
  const { engagementId, hostId, pending } = useFillScope();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const asked = params.get("generator");
  useEffect(() => {
    if (isGenerator(asked)) usePayloadsStore.getState().setGenerator(asked);
  }, [asked]);

  useKeydown((e) => {
    // An Arsenal or Notes drawer over the Workbench takes Esc first.
    if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen() || otherDrawerOpen()) return;
    // The generator list is a listbox, which isTypingTarget counts as typing; from there Esc leaves at once.
    if (isTypingTarget(e.target) && !inGeneratorList()) {
      (e.target as HTMLElement).blur();
      return;
    }
    e.preventDefault();
    // The first entry of the session has nowhere to go back to.
    void (location.key === "default" ? navigate("/") : navigate(-1));
  });

  // Until the remembered engagement is confirmed there is nothing to read; then one mount per engagement.
  if (pending) return null;
  return <WorkbenchBody key={engagementId} engagementId={engagementId} hostId={hostId} />;
}
