import { ArrowsOut } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMatch, useNavigate } from "react-router";
import { encodePs } from "../../engines/payloads/encodePs";
import type { BuiltPayload, GeneratorId, PayloadDef } from "../../engines/payloads/types";
import { copyPlain } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { Button, Input, Kbd } from "../../ui";
import type { ChipPickerHandle } from "../arsenal/ChipPicker";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";
import { isHostPickKey, type HostChipHandle } from "../arsenal/HostChip";
import { useFillScope } from "../arsenal/useFillScope";
import { logCommand } from "../capture/logCommand";
import { TransferGenerator } from "../generators/TransferGenerator";
import { ContextChips } from "./ContextChips";
import { PayloadBlock, PayloadView } from "./PayloadView";
import { contextLabel, isRanked, OS_LABEL, usePayloadFit } from "./usePayloadFit";
import { usePayloadsStore } from "./usePayloadsStore";

/** In ⌥1–⌥6 order. */
const GENERATORS: { id: GeneratorId; label: string }[] = [
  { id: "shell", label: "Reverse shell" },
  { id: "transfer", label: "Transfer" },
  { id: "sql", label: "SQL injection" },
  { id: "msfvenom", label: "msfvenom" },
  { id: "encode", label: "Encode" },
  { id: "upgrade", label: "Upgrade" },
];
const HINTS: [string, string][] = [
  ["↵", "copy payload"], ["⌥L", "copy listener"], ["⇥", "next fit"], ["⌥1-6", "generator"], ["⌘↵", "copy and log"], ["Esc", "close"],
];
const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;
/** The payload's placeholders as fill fields, LHOST first; LPORT is the port chip. */
const fieldTokens = (def: PayloadDef) =>
  [...new Set([...def.template.matchAll(PLACEHOLDER)].map((m) => m[1]!))]
    .filter((t) => t !== "LPORT")
    .sort((a, b) => Number(b === "LHOST") - Number(a === "LHOST"));
/** ⌥ chords by physical key: on a Mac ⌥L types "¬" and ⌥1 "¡". */
const altCode = (e: KeyboardEvent) => (e.altKey && !e.metaKey && !e.ctrlKey ? e.code : null);
const isTextField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

function DrawerBody({ engagementId, hostId: routeHostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const generator = usePayloadsStore((s) => s.generator);
  // The host chip can pick another host; moving to another host in the route follows the route again.
  const [hostId, setHostId] = useState(routeHostId);
  const [seenHost, setSeenHost] = useState(routeHostId);
  if (seenHost !== routeHostId) {
    setSeenHost(routeHostId);
    setHostId(routeHostId);
  }
  const fit = usePayloadFit(engagementId, hostId);
  const { host, d } = fit;
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [psCommand, setPsCommand] = useState("");
  const [status, setStatus] = useState<string>();

  // Which fit is in view: back to the best one whenever the list it indexes changes.
  const ranked = isRanked(generator) ? fit.ranked[generator] : null;
  const listKey = `${generator}|${fit.hostKey}|${fit.os}|${fit.context}`;
  const [pos, setPos] = useState({ key: listKey, index: 0 });
  const index = pos.key === listKey && ranked ? Math.min(pos.index, Math.max(0, ranked.fits.length - 1)) : 0;
  const setIndex = (i: number) => setPos({ key: listKey, index: i });

  const def: PayloadDef | null = ranked?.fits[index] ?? null;
  let built: BuiltPayload | null = null;
  if (def) built = fit.build(def, extra);
  else if (generator === "encode" && psCommand.trim()) built = encodePs(psCommand.trim());

  const bodyRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HostChipHandle>(null);
  const portRef = useRef<ChipPickerHandle>(null);
  const psRef = useRef<HTMLInputElement>(null);
  const fieldEls = useRef(new Map<string, HTMLInputElement>());
  const focusToken = useCallback((t: string) => (t === "LPORT" ? portRef.current?.open() : fieldEls.current.get(t)?.focus()), []);
  const focusNothing = useCallback(() => {}, []);
  const guard = useCopyGuard({ focusToken, focusCred: focusNothing, hostName: host ? shortHostName(host.name) : null });
  const { reset: resetGuard } = guard;
  const builtId = built?.def.id;
  useEffect(() => resetGuard(), [builtId, generator, resetGuard]);

  // The generator's body takes focus, so ↵ ⇥ and ⌥L work at once; Encode starts in its field.
  useEffect(() => {
    if (generator === "encode") psRef.current?.focus();
    else bodyRef.current?.focus();
  }, [generator]);

  const copy = async (log: boolean) => {
    if (!built) return;
    setStatus(undefined);
    const b = built;
    const cmd = { id: b.def.id, title: b.def.title, text: b.text, unresolved: b.unresolved, msfMarker: false };
    try {
      const r = await guard.attempt(cmd, () => copyPlain(b.text));
      if (r !== "copied" || !log || !host || !d.engagement) return;
      await logCommand(qc, {
        engagementId, host, hosts: d.hosts, command: b.text, title: `${b.def.title} · ${host.ip ?? host.name}`,
        // msfvenom runs on your own machine; everything else runs on the target.
        ranOn: b.def.generator === "msfvenom" ? (d.settings?.machines[0] ?? "") : host.name,
        payloadId: b.def.id, payloadValues: { LHOST: fit.lhost, LPORT: fit.port },
      });
    } catch (e) {
      reportError(e);
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  // ⌥1–⌥6, ⌥L and ⌥H, wherever focus is. Capture phase, so the host view's own ⌥1–⌥3 tabs never see them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isDialogOpen()) return;
      const code = altCode(e);
      const n = code?.startsWith("Digit") ? Number(code.slice(5)) : NaN;
      if (n >= 1 && n <= GENERATORS.length) {
        e.preventDefault();
        usePayloadsStore.getState().setGenerator(GENERATORS[n - 1]!.id);
      } else if (code === "KeyL" && built?.listener) {
        e.preventDefault();
        void copyPlain(built.listener).catch(reportError);
      } else if (engagementId && isHostPickKey(e)) {
        e.preventDefault();
        hostRef.current?.open();
      } else if (e.key === "Escape" && document.activeElement?.getAttribute("aria-expanded") !== "true") {
        e.preventDefault();
        usePayloadsStore.getState().close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // ↵ ⌘↵ and ⇥ act while focus is in the drawer. Transfer and SQL keep their own keys.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || generator === "transfer" || generator === "sql") return;
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
      if (t.tagName === "BUTTON" || t.getAttribute("aria-haspopup") === "listbox") return;
      e.preventDefault();
      void copy(e.metaKey || e.ctrlKey);
    } else if (e.key === "Tab" && ranked && ranked.fits.length > 1 && !isTextField(t)) {
      e.preventDefault();
      const n = ranked.fits.length;
      setIndex((index + (e.shiftKey ? n - 1 : 1)) % n);
    }
  };

  const note = built && guard.forKey === copyKey({ id: built.def.id, unresolved: built.unresolved }) ? (guard.hint ?? guard.confirm) : null;
  const pasteLabel = built ? `Paste into ${contextLabel(fit.context && built.def.contexts.includes(fit.context) ? fit.context : built.def.contexts[0]!)}` : "";
  const fitsLine = ranked && !ranked.ordered && generator === "shell"
    ? [fit.os && OS_LABEL[fit.os], fit.context && contextLabel(fit.context)].filter(Boolean).join(", ")
    : null;
  const fields = def && fieldTokens(def).length > 0 && (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      {fieldTokens(def).map((t) => (
        <label key={t} className="contents">
          <span className="font-mono text-xs text-muted">{t}</span>
          <Input
            mono aria-label={t} className="h-7"
            ref={(el) => { if (el) fieldEls.current.set(t, el); else fieldEls.current.delete(t); }}
            value={t === "LHOST" ? fit.lhost : (extra[t] ?? "")}
            placeholder={def.defaults?.[t] ?? ""}
            onChange={(e) => (t === "LHOST" ? usePayloadsStore.getState().setLhost(e.target.value) : setExtra({ ...extra, [t]: e.target.value }))}
          />
        </label>
      ))}
    </div>
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]" onKeyDown={onKeyDown}>
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
      <ContextChips fit={fit} engagementId={engagementId} onHost={setHostId} hostRef={hostRef} portRef={portRef} />
      <div ref={bodyRef} tabIndex={-1} className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 outline-none">
        {ranked && (
          <PayloadView
            fits={ranked.fits} misfits={ranked.misfits} index={index} onIndex={setIndex} ordered={ranked.ordered}
            built={built} fitsLine={fitsLine ? `Fits: ${fitsLine}` : null} pasteLabel={pasteLabel}
            stale={def?.bakesIp ? fit.staleLines.get(def.id) : null} note={note} noteWarn={guard.hint !== null} fields={fields}
          />
        )}
        {generator === "encode" && (
          <div className="grid content-start gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted">PowerShell command to encode</span>
              <Input mono ref={psRef} aria-label="PowerShell command" value={psCommand} onChange={(e) => setPsCommand(e.target.value)} />
            </label>
            {built && <PayloadBlock built={built} pasteLabel="Paste into cmd.exe or PowerShell" note={note} noteWarn={guard.hint !== null} />}
          </div>
        )}
        {generator === "transfer" && <TransferGenerator engagementId={engagementId} hostId={hostId} />}
        {generator === "sql" && <p className="m-0 text-xs text-muted">The SQL injection builder is on its way; use the Arsenal's SQL cards meanwhile.</p>}
        {status && <p role="alert" className="m-0 mt-2 text-xs text-warn">{status}</p>}
      </div>
      <footer data-hint-line="" className="border-t border-line px-4 py-2 text-[11px] text-muted">
        {HINTS.map(([key, label], i) => (
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
    if (onFull) document.getElementById("payloads-generators")?.focus();
    else usePayloadsStore.getState().toggle();
  });
  useEffect(() => {
    if (onFull && open) usePayloadsStore.getState().close();
  }, [onFull, open]);

  // A lock unmounts this; the next unlock must not find it open.
  useEffect(() => () => usePayloadsStore.getState().close(), []);

  useEffect(() => {
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
