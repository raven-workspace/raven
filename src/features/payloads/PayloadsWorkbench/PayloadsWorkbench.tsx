import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { PASTE_CONTEXTS } from "../../../engines/payloads/context";
import { filterChoices } from "../../../engines/payloads/filters";
import { cx } from "../../../lib/cx";
import { isDialogOpen, isTypingTarget, useKeydown } from "../../../lib/keys";
import { HintLine, Input, Kbd, labelClass, Toggle, useFadeOnChange } from "../../../ui/index";
import type { ChipPickerHandle } from "../../arsenal/ChipPicker/ChipPicker";
import { HostChip } from "../../arsenal/HostChip/HostChip";
import { useFillScope } from "../../arsenal/useFillScope";
import { PayloadBlock, PayloadView } from "../PayloadView/PayloadView";
import { SqlPanel } from "../SqlPanel/SqlPanel";
import { TransferPanel } from "../TransferPanel/TransferPanel";
import { ToolsPicker } from "../ToolsPicker/ToolsPicker";
import { FILTER_LABEL, hasToggles, OS_LABEL, showsFilter } from "../usePayloadFit";
import { GENERATOR_LIST_ID, GENERATORS, hintsFor, inGeneratorList, isGenerator, lhostPlaceholder, otherDrawerOpen, usePayloadSession } from "../usePayloadSession/usePayloadSession";
import { usePayloadsStore, type PayloadOverride } from "../usePayloadsStore";
import "./PayloadsWorkbench.scss";

/** One labelled block of the left column, with the line saying where the value came from (amber when unknown). */
function ReadItem({ label, why, unknown, children }: { label: string; why?: string | null; unknown?: string; children: ReactNode }) {
  return (
    <div className="read-item">
      <span className="read-item__label">{label}</span>
      {children}
      {why ? <span className="read-item__why">{why}</span> : unknown && <span className="read-item__unknown">{unknown}</span>}
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
  const { generator, fit, ranked, index, setIndex, built, guard, note, hostRef, osRef, contextRef, callbacksRef, filterRef, toolsRef, psRef, fieldEls } = s;
  useFadeOnChange(bodyRef, generator);
  const hints = useMemo(
    () => hintsFor(generator, "back", [{ keys: "P", label: "generators", priority: 4 }], ranked?.ordered, fit.filterApplies),
    [generator, ranked?.ordered, fit.filterApplies],
  );
  const override = (patch: PayloadOverride) => usePayloadsStore.getState().override(fit.hostKey, patch);
  const contexts = PASTE_CONTEXTS.filter((c) => !fit.os || c.os === "any" || c.os === fit.os);
  const exam = fit.engagement.kind === "exam-sim";
  const msfHostId = fit.engagement.msfHostId;
  const msfHost = msfHostId ? (fit.d.hosts?.find((h) => h.id === msfHostId)?.name ?? "another host") : null;
  const blocked = fit.toggles.callbacksBlocked;
  /** A callback clue shows only while callbacks read allowed; Raven never flips the toggle. */
  const clue = blocked ? null : fit.callbackClue;
  /** Callbacks, Filter and Tools apply to Shell and msfvenom only. */
  const toggles = hasToggles(generator);
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
    <main aria-label="Payloads" data-hint-surface="" className="raven-page payloads-workbench" onKeyDown={s.onKeyDown}>
      <aside role="complementary" aria-label="Raven's read" className="payloads-workbench__read">
        <h2 className={labelClass}>Raven's read</h2>
        <ReadItem label="Target">
          {engagementId ? (
            // The chip's column never shrinks below 10rem, so a short name (or "No host") still reads as a control.
            <div data-host-chip-cell="" className="payloads-workbench__host-cell">
              <HostChip ref={hostRef} hosts={fit.d.hosts} value={fit.host?.id ?? null} onChange={s.setHostId} align="start" className="payloads-workbench__host" />
            </div>
          ) : (
            <span className="payloads-workbench__no-engagement">No active engagement</span>
          )}
        </ReadItem>
        <ReadItem label="OS" why={fit.evidence.os} unknown="Not known: pick one">
          <div ref={choiceGroup(osRef)} className="payloads-workbench__choices">
            {(["linux", "windows"] as const).map((o) => (
              <Toggle key={o} on={fit.os === o} onChange={() => override({ os: o })} className="payloads-workbench__choice">{OS_LABEL[o]}</Toggle>
            ))}
          </div>
        </ReadItem>
        <ReadItem label="Where you paste it" why={fit.evidence.context} unknown="Not known: pick one">
          <div ref={choiceGroup(contextRef)} className="payloads-workbench__choices">
            {contexts.map((c) => (
              // A long label truncates in its half of the column: the title keeps it whole.
              <Toggle key={c.id} on={fit.context === c.id} onChange={() => override({ context: c.id })} title={c.label} className="payloads-workbench__choice payloads-workbench__choice--long">
                <span className="payloads-workbench__choice-text">{c.label}</span>
              </Toggle>
            ))}
          </div>
        </ReadItem>
        <div className="payloads-workbench__listen">
          <label className="payloads-workbench__field">
            <span className="payloads-workbench__field-label">LHOST</span>
            <Input
              mono aria-label="LHOST" ref={register("LHOST")} value={fit.lhostInput} placeholder={lhostPlaceholder(fit.settingsLhost)}
              onChange={(e) => usePayloadsStore.getState().setLhost(e.target.value)}
            />
          </label>
          <label className="payloads-workbench__field">
            <span className="payloads-workbench__field-label">LPORT</span>
            <Input
              mono aria-label="LPORT" ref={register("LPORT")} value={fit.portInput} placeholder={fit.settingsPort ? `Settings: ${fit.settingsPort}` : "443"} inputMode="numeric"
              onChange={(e) => override({ port: e.target.value.replace(/\D/g, "") })}
            />
          </label>
        </div>
        {toggles && (
          <ReadItem label="Callbacks" why={blocked ? "set by you: binds first" : null}>
            <div ref={choiceGroup(callbacksRef)} className="payloads-workbench__choices">
              <Toggle on={!blocked} onChange={() => override({ callbacksBlocked: false })} className="payloads-workbench__choice">
                <span className={clue ? "payloads-workbench__clue" : undefined}>Allowed</span>
              </Toggle>
              <Toggle on={blocked} onChange={() => override({ callbacksBlocked: true })} className="payloads-workbench__choice">Blocked</Toggle>
            </div>
            {clue && <span className="payloads-workbench__clue-line">{clue}</span>}
          </ReadItem>
        )}
        {showsFilter(generator, fit.filterApplies) && (
          <ReadItem label="Filter">
            <div ref={choiceGroup(filterRef)} className="payloads-workbench__choices">
              {filterChoices(fit.os).map((f) => (
                <Toggle key={f} on={fit.filter === f} onChange={() => override({ filter: f })} title={f === "off" ? "Off" : FILTER_LABEL[f]} className="payloads-workbench__choice payloads-workbench__choice--long">
                  <span className="payloads-workbench__choice-text">{f === "off" ? "Off" : FILTER_LABEL[f]}</span>
                </Toggle>
              ))}
            </div>
          </ReadItem>
        )}
        {toggles && (
          <ReadItem label="Tools">
            <div className="payloads-workbench__tools">
              <ToolsPicker ref={toolsRef} own={fit.toggles.tools} log={fit.logTools} onChange={(tools) => override({ tools })} />
            </div>
          </ReadItem>
        )}
        <ReadItem label="Exam rules">
          <span className={cx("payloads-workbench__exam", exam && "payloads-workbench__exam--limits")}>
            {exam ? `Meterpreter: one machine only. ${msfHost ? `Locked to ${msfHost}.` : "Not locked yet."}` : "No exam limits."}
          </span>
        </ReadItem>
        <div className="payloads-workbench__generators">
          <span className={labelClass}>Generator</span>
          <div
            id={GENERATOR_LIST_ID} ref={listRef} role="listbox" aria-label="Generator" tabIndex={0}
            aria-activedescendant={`payloads-gen-${generator}`} onKeyDown={onListKey}
            className="payloads-workbench__generator-list"
          >
            {GENERATORS.map((g, i) => (
              <div
                key={g.id} id={`payloads-gen-${g.id}`} role="option" aria-selected={generator === g.id}
                onClick={() => {
                  usePayloadsStore.getState().setGenerator(g.id);
                  listRef.current?.focus();
                }}
                className="payloads-workbench__generator"
              >
                <span className="payloads-workbench__generator-name">{g.label}</span>
                <Kbd variant="inline">⌥{i + 1}</Kbd>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="payloads-workbench__main">
        <div ref={bodyRef} tabIndex={-1} className="payloads-workbench__output">
          {ranked && (
            <PayloadView
              fits={ranked.fits} misfits={ranked.misfits} marks={ranked.marks} index={index} onIndex={setIndex} ordered={ranked.ordered}
              built={built} fitsLine={s.fitsLine ? `Fits: ${s.fitsLine}` : null} numbered {...s.blockProps}
            />
          )}
          {generator === "encode" && (
            <div className="payloads-workbench__encode">
              <label className="payloads-workbench__field">
                <span className="payloads-workbench__field-label">PowerShell command to encode</span>
                <Input mono ref={psRef} aria-label="PowerShell command" value={s.psCommand} onChange={(e) => s.setPsCommand(e.target.value)} />
              </label>
              {built && (
                <PayloadBlock
                  built={built} pasteLabel="Paste into cmd.exe or PowerShell" numbered note={note} noteWarn={guard.hint !== null}
                  onCopy={() => s.copy(false)} onCopyListener={s.copyListener}
                />
              )}
            </div>
          )}
          {generator === "transfer" && <TransferPanel engagementId={engagementId} hostId={s.hostId} fit={fit} focusToken={s.focusToken} autoFocus={!inGeneratorList()} />}
          {generator === "sql" && <SqlPanel fit={fit} onFocusToken={s.focusToken} />}
          {s.status && <p role="alert" className="payloads-workbench__status">{s.status}</p>}
        </div>
        <footer className="payloads-workbench__footer">
          <HintLine hints={hints} ariaLabel="Payloads shortcuts" />
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
