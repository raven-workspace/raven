import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { DERIVED_TOKENS } from "../../engines/payloads/build";
import { encodePs } from "../../engines/payloads/encodePs";
import { LISTENERS, PLACEHOLDER } from "../../engines/payloads/listeners";
import type { BuiltPayload, GeneratorId, ListenerId, PayloadDef } from "../../engines/payloads/types";
import { api } from "../../lib/api";
import { copyPlain } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import type { PayloadBuild } from "../../types/payloadBuild";
import { Input, type Hint } from "../../ui";
import type { ChipPickerHandle } from "../arsenal/ChipPicker";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";
import { isHostPickKey, type HostChipHandle } from "../arsenal/HostChip";
import { logCommand } from "../capture/logCommand";
import { payloadBuildsKey } from "./queries";
import { contextLabel, hasToggles, isRanked, OS_LABEL, showsFilter, usePayloadFit } from "./usePayloadFit";
import { usePayloadsStore } from "./usePayloadsStore";
import { RavenError } from "../../types/errors";
import { anyDrawerOpen } from "../drawers";
import "./usePayloadSession.scss";

/** In ⌥1–⌥6 order. */
export const GENERATORS: { id: GeneratorId; label: string }[] = [
  { id: "shell", label: "Shell" },
  { id: "transfer", label: "Transfer" },
  { id: "sql", label: "SQL injection" },
  { id: "msfvenom", label: "msfvenom" },
  { id: "encode", label: "Encode" },
  { id: "upgrade", label: "Upgrade" },
];
/**
 * The hint line for one generator: only the keys that work there, by priority (1 never drops). `esc` names what Esc
 * does in this view; `extra` adds the view's own keys. `ordered`: ⇥ walks steps, not fits. `filter`: the Filter
 * toggle applies (an injection paste context), so ⌥F is listed for Shell; ⌥B ⌥T only for Shell and msfvenom.
 */
export function hintsFor(g: GeneratorId, esc: string, extra: Hint[] = [], ordered = false, filter = false): Hint[] {
  const generator: Hint = { keys: "⌥1–6", label: "generator", priority: 5 };
  const tail: Hint[] = [...extra, { keys: "Esc", label: esc, priority: 1 }];
  const copyLog: Hint = { keys: "⌘↵", label: "copy and log", priority: 3 };
  if (g === "transfer") return [{ ...copyLog, priority: 1 }, generator, ...tail];
  if (g === "sql") return [{ keys: "↵", label: "copy step", priority: 1 }, generator, ...tail];
  if (g === "encode") return [{ keys: "↵", label: "copy payload", priority: 1 }, copyLog, generator, ...tail];
  return [
    { keys: "↵", label: "copy payload", priority: 1 },
    copyLog,
    { keys: "⌥L", label: "copy listener", priority: 3 },
    { keys: "⇥", label: ordered ? "next step" : "next fit", priority: 2 },
    { keys: "⌥O", label: "OS", priority: 4 },
    { keys: "⌥W", label: "where you paste", priority: 4 },
    ...(hasToggles(g)
      ? [
        { keys: "⌥B", label: "callbacks", priority: 4 },
        ...(showsFilter(g, filter) ? [{ keys: "⌥F", label: "filter", priority: 4 }] : []),
        { keys: "⌥T", label: "tools", priority: 4 },
      ]
      : []),
    generator,
    ...tail,
  ];
}
/** The Arsenal or Notes drawer is open over this view: its keys win. */
export const otherDrawerOpen = () => anyDrawerOpen("payloads");
/** The Workbench's generator list (`P` focuses it). */
export const GENERATOR_LIST_ID = "payloads-generators";
export const inGeneratorList = () => document.activeElement?.closest(`#${GENERATOR_LIST_ID}`) != null;
export const isGenerator = (g: string | null): g is GeneratorId => GENERATORS.some((x) => x.id === g);

const namesIn = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
/** The listener placeholders that are fill values; LHOST and LPORT have their own fields, MSF_PAYLOAD comes from the def. */
const LISTENER_FIELDS = new Set(["TARGET_IP", "BIND_PORT"]);
/**
 * The payload's placeholders (template, prepare step, upload trigger, and the fill values of every listener it can
 * pick) as fill fields, LHOST first; LPORT is the port chip, and derived ports are never typed.
 */
const fieldTokens = (def: PayloadDef) =>
  [...new Set([
    ...namesIn(`${def.template} ${def.prepare ?? ""} ${def.upload?.trigger ?? ""}`),
    ...def.listeners.flatMap((l) => namesIn(LISTENERS[l].template)).filter((t) => LISTENER_FIELDS.has(t)),
  ])]
    .filter((t) => t !== "LPORT" && !DERIVED_TOKENS.has(t))
    .sort((a, b) => Number(b === "LHOST") - Number(a === "LHOST"));
/** The LHOST field's hint: Settings' attacker IP, which fills in while the field is empty. */
export const lhostPlaceholder = (settingsLhost: string) => (settingsLhost ? `Settings: ${settingsLhost}` : "Settings: attacker IP");
/** The muted hold on a trigger copy while the build memory is still loading. */
const CHECKING_BUILD = "Checking the last build";
/** Saves what a baked payload was built with, stamped now, and refetches the build memory. */
async function recordBuild(qc: QueryClient, build: Omit<PayloadBuild, "at">) {
  await api.payloadBuildRecord({ ...build, at: Date.now() });
  await qc.invalidateQueries({ queryKey: payloadBuildsKey(build.engagementId) });
}
/** ⌥ chords by physical key: on a Mac ⌥L types "¬" and ⌥1 "¡". */
const altCode = (e: KeyboardEvent) => (e.altKey && !e.metaKey && !e.ctrlKey ? e.code : null);

/**
 * What the drawer and the Workbench share: the host in view, its fit, the payload in view and its copy guard, and the
 * keys. ↵ copies, ⌘↵ copies and logs, ⇥ moves to the next fit (only while focus is on the payload body itself, and
 * never past the last fit: there it moves focus on, so Tab still reaches every button and field; ⇧⇥ always moves focus),
 * and ⌥1–⌥6, ⌥L, ⌥H, ⌥O (OS), ⌥W (where you paste it), ⌥B (callbacks), ⌥F (filter, while it applies) and ⌥T (tools)
 * work wherever focus is (⌥B ⌥T on Shell and msfvenom only, ⌥F on Shell only).
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

  // Which fit is in view: back to the best one whenever the list it indexes changes. Tool ticks sort first, so the same
  // ticks in another key order are the same list.
  const ranked = isRanked(generator) ? fit.ranked[generator] : null;
  const listKey = `${generator}|${fit.hostKey}|${fit.os}|${fit.context}|${fit.toggles.callbacksBlocked}|${JSON.stringify(Object.entries(fit.toggles.tools).sort(([a], [b]) => a.localeCompare(b)))}`;
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
  /** ⌥B ⌥F ⌥T: Callbacks, Filter and Tools. */
  const callbacksRef = useRef<ChipPickerHandle>(null);
  const filterRef = useRef<ChipPickerHandle>(null);
  const toolsRef = useRef<ChipPickerHandle>(null);
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

  // A baked payload last built for this host with other values (Rebuild first), and the exam's Metasploit lock.
  const stale = def ? fit.staleFor(def) : null;
  const lock = def ? fit.lockLine(def) : null;
  /** The build step of a baked payload: its prepare step when it has one, else the payload itself. */
  const buildStep = def?.bakesIp ? (def.prepare ? "prepare" as const : "payload" as const) : null;
  const staleWarn = stale ? { warn: `Built with ${stale.was}; rebuild first`, warnKey: stale.was } : undefined;
  const lockWarn = lock?.breach ? { warn: lock.text, warnKey: "msf-lock" } : undefined;
  /** A baked payload's trigger while the build memory has not loaded: held once (muted), and it never records. */
  const unknownBuild = !!def?.bakesIp && !!host && !fit.buildsKnown;
  const checkingWarn = unknownBuild ? { warn: CHECKING_BUILD, warnKey: "builds-unknown" } : undefined;
  const triggerWarn = staleWarn ?? checkingWarn;

  /**
   * Remembers what a baked payload was built with for this host, after its build step (or, while nothing is stale, its
   * trigger) was copied. No host, no record. A failure shows in `status`; the copy stands.
   */
  const record = async (d: PayloadDef) => {
    const lhost = fit.lhost.trim();
    const lport = fit.port.trim();
    if (!host || !d.bakesIp || !lhost || !lport) return;
    try {
      await recordBuild(qc, { engagementId, hostId: host.id, payloadId: d.id, lhost, lport });
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
    }
  };

  /** The prepare step's own copy key: its id and the placeholders still showing in it. */
  const prepareCmd = built?.prepare
    ? { id: `${built.def.id}:prepare`, unresolved: built.unresolved.filter((t) => built.prepare!.includes(`{${t}}`)) }
    : null;
  /** The listener's own copy key: a placeholder still showing in it ({TARGET_IP} on a host with no IP) holds it back once. */
  const listenerCmd = built?.listener ? { id: `${built.def.id}:listener`, unresolved: [...new Set(namesIn(built.listener))] } : null;
  /** The trigger copies as is (its placeholders are highlighted, not held back); only "Rebuild first" holds it. */
  const triggerCmd = built?.trigger ? { id: `${built.def.id}:trigger`, unresolved: [] as string[] } : null;

  /** Copies the prepare step through the copy guard; it is a build step, so a copy records the build. */
  const copyPrepare = async (): Promise<"copied" | "guarded"> => {
    if (!built?.prepare || !prepareCmd) return "guarded";
    setStatus(undefined);
    const b = built;
    const text = b.prepare!;
    try {
      const r = await guard.attempt({ ...prepareCmd, title: b.def.title, text, msfMarker: false }, () => copyPlain(text));
      if (r !== "copied") return "guarded";
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
      return "guarded";
    }
    await record(b.def);
    return "copied";
  };

  /** Copies an uploaded file's trigger; held back once while its build is stale, and records only while it is not. */
  const copyTrigger = async (): Promise<"copied" | "guarded"> => {
    if (!built?.trigger || !triggerCmd) return "guarded";
    setStatus(undefined);
    const b = built;
    const text = b.trigger!.text;
    const mayRecord = stale === null && !unknownBuild;
    try {
      const r = await guard.attempt({ ...triggerCmd, title: b.def.title, text, msfMarker: false }, () => copyPlain(text), triggerWarn);
      if (r !== "copied") return "guarded";
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
      return "guarded";
    }
    if (mayRecord) await record(b.def);
    return "copied";
  };

  /**
   * Copies the payload in view through the copy guard; "guarded" when it held the copy back. A payload that is the
   * trigger of a stale build (a served cradle) is held back once with "rebuild first"; a Meterpreter payload on a host
   * other than the Metasploit one, with the lock. A build step, or a trigger while nothing is stale, records the build.
   */
  const copy = async (log: boolean): Promise<"copied" | "guarded"> => {
    // A key to press (Ctrl-Z) has nothing to copy or log.
    if (!built || built.def.keypress) return "guarded";
    setStatus(undefined);
    const b = built;
    const cmd = { id: b.def.id, title: b.def.title, text: b.text, unresolved: b.unresolved, msfMarker: false };
    const isBuild = buildStep === "payload";
    const mayRecord = isBuild || (stale === null && !unknownBuild);
    try {
      // A trigger's "rebuild first" (or "checking") hold comes before the lock; no Meterpreter def has a prepare step,
      // so the two never meet today.
      const r = await guard.attempt(cmd, () => copyPlain(b.text), (!isBuild ? triggerWarn : undefined) ?? lockWarn);
      if (r !== "copied") return "guarded";
      if (mayRecord) await record(b.def);
      if (!log || !host || !d.engagement) return "copied";
      await logCommand(qc, {
        engagementId, host, hosts: d.hosts, command: b.text, title: b.def.title,
        // msfvenom, a file made on Kali and a step run in your own terminal run on your machine; the rest on the target.
        ranOn: b.def.generator === "msfvenom" || b.def.upload?.kali || b.def.runsOn === "kali" ? (d.settings?.machines[0] ?? "") : host.name,
        // An encoded command has no LHOST or LPORT in it: nothing to remember for it.
        payloadId: b.def.id, ...(b.def.generator === "encode" ? {} : { payloadValues: { LHOST: fit.lhost, LPORT: fit.port } }),
      });
      return "copied";
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
      return "guarded";
    }
  };
  /** Copies the listener (⌥L, its Copy) through the copy guard: an unresolved placeholder focuses its field first. */
  const copyListener = async (): Promise<"copied" | "guarded"> => {
    if (!built?.listener || !listenerCmd) return "guarded";
    const text = built.listener;
    try {
      return await guard.attempt({ ...listenerCmd, title: built.def.title, text, msfMarker: false }, () => copyPlain(text));
    } catch (e) {
      reportError(e);
      return "guarded";
    }
  };
  const pickListener = (id: ListenerId) => {
    if (built) usePayloadsStore.getState().pickListener(built.def.id, id);
  };

  // ⌥1–⌥6, ⌥L, ⌥H, ⌥O, ⌥W, ⌥B, ⌥F and ⌥T, wherever focus is. Capture phase, so the host view's own ⌥1–⌥3 tabs never see them.
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
        void copyListener();
      } else if (code === "KeyO" || code === "KeyW") {
        e.preventDefault();
        (code === "KeyO" ? osRef : contextRef).current?.open();
      } else if (hasToggles(generator) && (code === "KeyB" || code === "KeyT" || (code === "KeyF" && showsFilter(generator, fit.filterApplies)))) {
        e.preventDefault();
        (code === "KeyB" ? callbacksRef : code === "KeyT" ? toolsRef : filterRef).current?.open();
      } else if (engagementId && isHostPickKey(e)) {
        e.preventDefault();
        hostRef.current?.open();
      } else if (
        onEscape && e.key === "Escape" && document.activeElement?.getAttribute("aria-expanded") !== "true"
        // A field that takes Esc itself (the Port chip's "Other…" field) closes first.
        && !document.activeElement?.hasAttribute("data-own-esc")
      ) {
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
    } else if (e.key === "Tab" && !e.shiftKey && ranked && t === bodyRef.current) {
      // ⇥ skips past a key to press (Ctrl-Z): there is nothing to copy there. Past the last fit ⇥ is plain Tab again,
      // so focus can leave the body.
      let next = index + 1;
      while (ranked.fits[next]?.keypress) next++;
      if (next >= ranked.fits.length) return;
      e.preventDefault();
      setIndex(next);
    }
  };

  const noteFor = (c: { id: string; unresolved: string[] } | null) => (c && guard.forKey === copyKey(c) ? (guard.hint ?? guard.confirm) : null);
  const note = noteFor(built ? { id: built.def.id, unresolved: built.unresolved } : null);
  const pasteContext = built ? (fit.context && built.def.contexts.includes(fit.context) ? fit.context : built.def.contexts[0]!) : null;
  // An uploaded file is saved as (or made on Kali into) its FILE, then triggered.
  const uploadFile = def?.upload ? (extra.FILE?.trim() || def.defaults?.FILE || "{FILE}") : null;
  const pasteLabel = def?.upload
    ? (def.upload.kali ? `Make ${uploadFile} on Kali` : `Save as ${uploadFile}`)
    // An upgrade step says which side it runs on: inside the caught shell, or your own terminal.
    : def?.generator === "upgrade" ? (def.keypress ? "Press in your terminal" : def.runsOn === "kali" ? "Run in your terminal" : "Run on the target")
    : pasteContext ? `Paste into ${contextLabel(pasteContext)}` : "";
  const fitsLine = ranked && !ranked.ordered && generator === "shell"
    ? [fit.os && OS_LABEL[fit.os], fit.context && contextLabel(fit.context)].filter(Boolean).join(", ")
    : null;
  const tokens = def ? fieldTokens(def).filter((t) => lhostField || t !== "LHOST") : [];
  const fields = tokens.length > 0 && (
    <div className="payload-fields">
      {tokens.map((t) => (
        <label key={t} className="payload-fields__field">
          <span className="payload-fields__token">{t}</span>
          <Input
            mono aria-label={t}
            ref={(el) => { if (el) fieldEls.current.set(t, el); else fieldEls.current.delete(t); }}
            value={t === "LHOST" ? fit.lhostInput : (extra[t] ?? "")}
            // TARGET_IP fills from the host's IP while the field is empty, so that is its hint.
            placeholder={t === "LHOST" ? lhostPlaceholder(fit.settingsLhost) : t === "TARGET_IP" && host?.ip ? host.ip : (def?.defaults?.[t] ?? "")}
            onChange={(e) => (t === "LHOST" ? usePayloadsStore.getState().setLhost(e.target.value) : setExtra({ ...extra, [t]: e.target.value }))}
          />
        </label>
      ))}
    </div>
  );

  /** What PayloadView and PayloadBlock take from the session for the payload in view (the drawer and the Workbench). */
  const blockProps = {
    pasteLabel, pasteFile: uploadFile, fields, note, noteWarn: guard.hint !== null && !guard.hint.startsWith(CHECKING_BUILD), prepareNote: noteFor(prepareCmd), triggerNote: noteFor(triggerCmd), listenerNote: noteFor(listenerCmd)?.replace("Press ↵ again", "Press ⌥L again") ?? null,
    stale: stale ? `Rebuild first: built with ${stale.was}, now ${stale.now}` : null, buildStep, lock,
    onCopy: () => copy(false), onCopyPrepare: copyPrepare, onCopyTrigger: copyTrigger, onCopyListener: copyListener, onPickListener: pickListener,
  };

  return {
    blockProps, generator, hostId, setHostId, fit, ranked, index, setIndex, def, built, guard, note, copy, copyListener, onKeyDown,
    // A build memory that failed to load shows here, as a failed copy does.
    status: status ?? fit.buildsError ?? undefined, psCommand, setPsCommand, pasteLabel, fitsLine, fields, focusToken, hostRef, osRef, contextRef, portRef, psRef, fieldEls,
    callbacksRef, filterRef, toolsRef, pickListener,
  };
}

export type PayloadSession = ReturnType<typeof usePayloadSession>;
