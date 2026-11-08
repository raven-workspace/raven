import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { encodePs } from "../../engines/payloads/encodePs";
import type { BuiltPayload, GeneratorId, PayloadDef } from "../../engines/payloads/types";
import { copyPlain } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { Input } from "../../ui";
import type { ChipPickerHandle } from "../arsenal/ChipPicker";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";
import { isHostPickKey, type HostChipHandle } from "../arsenal/HostChip";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { logCommand } from "../capture/logCommand";
import { useNotesStore } from "../notes/useNotesStore";
import { contextLabel, isRanked, OS_LABEL, usePayloadFit } from "./usePayloadFit";
import { usePayloadsStore } from "./usePayloadsStore";

/** In ⌥1–⌥6 order. */
export const GENERATORS: { id: GeneratorId; label: string }[] = [
  { id: "shell", label: "Reverse shell" },
  { id: "transfer", label: "Transfer" },
  { id: "sql", label: "SQL injection" },
  { id: "msfvenom", label: "msfvenom" },
  { id: "encode", label: "Encode" },
  { id: "upgrade", label: "Upgrade" },
];
/** The key hint line for the ranked generators; the last entry is what Esc does. */
export const HINTS: [string, string][] = [
  ["↵", "copy payload"], ["⌥L", "copy listener"], ["⇥", "next fit"], ["⌥O", "OS"], ["⌥W", "where you paste"], ["⌥1-6", "generator"], ["⌘↵", "copy and log"], ["Esc", "close"],
];
/** The hint line for one generator: only the keys that work there. `esc` names what Esc does in this view. */
export function hintsFor(g: GeneratorId, esc: string, extra: [string, string][] = []): [string, string][] {
  const tail: [string, string][] = [...extra, ["Esc", esc]];
  if (g === "transfer") return [["⌘↵", "copy and log"], ["⌥1-6", "generator"], ...tail];
  if (g === "sql") return [["↵", "copy step"], ["⌥1-6", "generator"], ...tail];
  if (g === "encode") return [["↵", "copy payload"], ["⌥1-6", "generator"], ["⌘↵", "copy and log"], ...tail];
  return [...HINTS.slice(0, -1), ...tail];
}
/** The Arsenal or Notes drawer is open over this view: its keys win. */
export const otherDrawerOpen = () => useArsenalStore.getState().open || useNotesStore.getState().open;
/** The Workbench's generator list (`P` focuses it). */
export const GENERATOR_LIST_ID = "payloads-generators";
export const inGeneratorList = () => document.activeElement?.closest(`#${GENERATOR_LIST_ID}`) != null;
export const isGenerator = (g: string | null): g is GeneratorId => GENERATORS.some((x) => x.id === g);

const PLACEHOLDER = /\{([A-Z][A-Z0-9_]*)\}/g;
/** The payload's placeholders as fill fields, LHOST first; LPORT is the port chip. */
const fieldTokens = (def: PayloadDef) =>
  [...new Set([...def.template.matchAll(PLACEHOLDER)].map((m) => m[1]!))]
    .filter((t) => t !== "LPORT")
    .sort((a, b) => Number(b === "LHOST") - Number(a === "LHOST"));
/** ⌥ chords by physical key: on a Mac ⌥L types "¬" and ⌥1 "¡". */
const altCode = (e: KeyboardEvent) => (e.altKey && !e.metaKey && !e.ctrlKey ? e.code : null);

/**
 * What the drawer and the Workbench share: the host in view, its fit, the payload in view and its copy guard, and the
 * keys. ↵ copies, ⌘↵ copies and logs, ⇥ moves to the next fit (only while focus is on the payload body itself, and
 * never past the last fit: there it moves focus on, so Tab still reaches every button and field; ⇧⇥ always moves focus),
 * and ⌥1–⌥6, ⌥L, ⌥H, ⌥O (OS) and ⌥W (where you paste it) work wherever focus is.
 * `onEscape`, when given, takes Esc in the capture phase (the drawer closes on it).
 * `lhostField`: show LHOST among the payload's fill fields (the Workbench has its own in the left column).
 */
export function usePayloadSession({ engagementId, hostId: routeHostId, bodyRef, onEscape, lhostField = true }: {
  engagementId: string; hostId: string | null; bodyRef: RefObject<HTMLElement | null>; onEscape?: () => void; lhostField?: boolean;
}) {
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

  const hostRef = useRef<HostChipHandle>(null);
  const portRef = useRef<ChipPickerHandle>(null);
  /** ⌥O and ⌥W: the drawer's chips, or the Workbench's choice groups. */
  const osRef = useRef<ChipPickerHandle>(null);
  const contextRef = useRef<ChipPickerHandle>(null);
  const psRef = useRef<HTMLInputElement>(null);
  const fieldEls = useRef(new Map<string, HTMLInputElement>());
  const focusToken = useCallback((t: string) => (t === "LPORT" && portRef.current ? portRef.current.open() : fieldEls.current.get(t)?.focus()), []);
  const focusNothing = useCallback(() => {}, []);
  const guard = useCopyGuard({ focusToken, focusCred: focusNothing, hostName: host ? shortHostName(host.name) : null });
  const { reset: resetGuard } = guard;
  const builtId = built?.def.id;
  useEffect(() => resetGuard(), [builtId, generator, resetGuard]);

  // The generator's body takes focus, so ↵ ⇥ and ⌥L work at once; Encode starts in its field, Transfer in its own.
  // Not while you move through the Workbench's generator list: focus stays there until ↵.
  useEffect(() => {
    if (inGeneratorList()) return;
    if (generator === "encode") psRef.current?.focus();
    else if (generator !== "transfer") bodyRef.current?.focus();
  }, [generator, bodyRef]);

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
  const copyListener = () => {
    if (built?.listener) void copyPlain(built.listener).catch(reportError);
  };

  // ⌥1–⌥6, ⌥L, ⌥H, ⌥O and ⌥W, wherever focus is. Capture phase, so the host view's own ⌥1–⌥3 tabs never see them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Workbench stays mounted under an Arsenal or Notes drawer: ⌥H ⌥L ⌥1–⌥6 then belong to that drawer.
      if (e.defaultPrevented || isDialogOpen() || otherDrawerOpen()) return;
      const code = altCode(e);
      const n = code?.startsWith("Digit") ? Number(code.slice(5)) : NaN;
      if (n >= 1 && n <= GENERATORS.length) {
        e.preventDefault();
        usePayloadsStore.getState().setGenerator(GENERATORS[n - 1]!.id);
      } else if (code === "KeyL" && built?.listener) {
        e.preventDefault();
        copyListener();
      } else if (code === "KeyO" || code === "KeyW") {
        e.preventDefault();
        (code === "KeyO" ? osRef : contextRef).current?.open();
      } else if (engagementId && isHostPickKey(e)) {
        e.preventDefault();
        hostRef.current?.open();
      } else if (onEscape && e.key === "Escape" && document.activeElement?.getAttribute("aria-expanded") !== "true") {
        e.preventDefault();
        onEscape();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // ↵ ⌘↵ and ⇥ act while focus is in the view. Transfer and SQL keep their own keys.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || generator === "transfer" || generator === "sql") return;
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
      if (t.tagName === "BUTTON" || t.getAttribute("aria-haspopup") === "listbox") return;
      e.preventDefault();
      void copy(e.metaKey || e.ctrlKey);
    } else if (e.key === "Tab" && !e.shiftKey && ranked && index < ranked.fits.length - 1 && t === bodyRef.current) {
      // Past the last fit ⇥ is plain Tab again, so focus can leave the body.
      e.preventDefault();
      setIndex(index + 1);
    }
  };

  const note = built && guard.forKey === copyKey({ id: built.def.id, unresolved: built.unresolved }) ? (guard.hint ?? guard.confirm) : null;
  const pasteContext = built ? (fit.context && built.def.contexts.includes(fit.context) ? fit.context : built.def.contexts[0]!) : null;
  const pasteLabel = pasteContext ? `Paste into ${contextLabel(pasteContext)}` : "";
  const fitsLine = ranked && !ranked.ordered && generator === "shell"
    ? [fit.os && OS_LABEL[fit.os], fit.context && contextLabel(fit.context)].filter(Boolean).join(", ")
    : null;
  const tokens = def ? fieldTokens(def).filter((t) => lhostField || t !== "LHOST") : [];
  const fields = tokens.length > 0 && (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      {tokens.map((t) => (
        <label key={t} className="contents">
          <span className="font-mono text-xs text-muted">{t}</span>
          <Input
            mono aria-label={t} className="h-7"
            ref={(el) => { if (el) fieldEls.current.set(t, el); else fieldEls.current.delete(t); }}
            value={t === "LHOST" ? fit.lhost : (extra[t] ?? "")}
            placeholder={def?.defaults?.[t] ?? ""}
            onChange={(e) => (t === "LHOST" ? usePayloadsStore.getState().setLhost(e.target.value) : setExtra({ ...extra, [t]: e.target.value }))}
          />
        </label>
      ))}
    </div>
  );

  return {
    generator, hostId, setHostId, fit, ranked, index, setIndex, def, built, guard, note, copy, copyListener, onKeyDown,
    status, psCommand, setPsCommand, pasteLabel, fitsLine, fields, focusToken, hostRef, osRef, contextRef, portRef, psRef, fieldEls,
  };
}

export type PayloadSession = ReturnType<typeof usePayloadSession>;
