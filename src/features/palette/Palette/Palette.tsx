import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { fillCommand } from "../../../engines/checklist/index";
import { credLabel } from "../../../engines/credentials/labels";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../../engines/library/store";
import { copyPlain, copySecret } from "../../../lib/clipboard";
import { reportError } from "../../../lib/lockSignal";
import { Dialog, HintLine, type Hint } from "../../../ui/index";
import { logCommand } from "../../capture/logCommand";
import { copyKey, useCopyGuard } from "../../arsenal/copyGuard";
import { shortHostName } from "../../../lib/hostName";
import { useArsenalStore } from "../../arsenal/useArsenalStore";
import { useFillScope, useLastEngagementStore } from "../../arsenal/useFillScope";
import { CredChip, isCredPickKey } from "../../arsenal/CredChip/CredChip";
import type { CredChipHandle } from "../../arsenal/CredChip/CredChip";
import { CommandPreview, fillPreview, toolPrefill } from "../../arsenal/CommandPreview/CommandPreview";
import { HostChip, isHostPickKey } from "../../arsenal/HostChip/HostChip";
import type { HostChipHandle } from "../../arsenal/HostChip/HostChip";
import { useCredPickStore } from "../../checklist/credPick";
import { ResultList } from "../../arsenal/ResultList/ResultList";
import type { ResultGroup, ResultRow } from "../../arsenal/ResultList/ResultList";
import { SearchBar } from "../../arsenal/SearchBar/SearchBar";
import { useFillBase } from "../fillData";
import { GENERATORS } from "../generators";
import type { GeneratorId } from "../../../engines/payloads/types";
import { usePayloadsStore } from "../../payloads/usePayloadsStore";
import { useManualNotes } from "../../manual/useManualNotes";
import { manualSearchPath } from "../../manual/searchPath";
import { capGroups, searchPalette, withoutSecrets, type EngagementItem, type PaletteResult } from "../search";
import { usePaletteStore } from "../usePaletteStore";
import type { SuggestContext } from "../suggest";
import { RavenError } from "../../../types/errors";
import "./Palette.scss";

const MAX_RESULTS = 30;

type PaletteRow = ResultRow & { result: PaletteResult };
const paletteRow = (result: PaletteResult): PaletteRow => ({
  result, id: `palette-${result.type}-${result.id}`, title: result.title,
  tag: result.type === "command" ? result.command.tool : result.type === "item" ? result.item.kind : result.type === "more" ? "" : result.type === "manual" ? result.line : result.type,
  mono: result.type === "command",
  // A Manual hit's matching line goes under its title, so the title stays whole.
  stack: result.type === "manual",
});

function PaletteBody({ engagementId, hostId: openedHostId, remembered, onClose }: { engagementId: string; hostId: string | null; remembered: boolean; onClose: (opts?: { handOff?: boolean }) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { notes } = useManualNotes();
  const libraryVersion = useLibraryVersion();
  // The chip picks another host for this search only; typed values never carry over to it.
  const [hostId, setHostId] = useState(openedHostId);
  const { d, host, cred, credOwnerId, makeInput, examReady } = useFillBase(engagementId, hostId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const pickerRef = useRef<HostChipHandle>(null);
  const credRef = useRef<CredChipHandle>(null);
  const pickHost = (id: string | null) => {
    setHostId(id);
    setOverrides({});
  };
  const [status, setStatus] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldEls = useRef(new Map<string, HTMLInputElement>());

  const items = useMemo<EngagementItem[]>(() => {
    if (!engagementId) return [];
    const out: EngagementItem[] = [];
    // Log and note text is searched with the engagement's known secrets cut out: a password never finds anything.
    const secrets = (d.credentials ?? []).map((c) => c.secret);
    for (const e of d.log ?? []) {
      const raw = e.content.kind === "command" ? e.content.blocks.map((b) => b.command).join("\n") : e.content.kind === "note" ? e.content.text : "";
      out.push({ id: e.id, kind: e.kind === "note" ? "note" : "log", title: e.title, text: withoutSecrets(raw, secrets) });
    }
    // Credential labels only: a secret is never searched or shown.
    for (const c of d.credentials ?? []) out.push({ id: c.id, kind: "credential", title: credLabel(c), text: "" });
    for (const h of d.hosts) out.push({ id: h.id, kind: "host", title: h.name, text: h.ip ?? "" });
    return out;
  }, [engagementId, d.log, d.credentials, d.hosts]);

  const found = useMemo(
    () =>
      searchPalette(query, {
        library: getLibrary(), cards: getCards(), generators: GENERATORS, engagementItems: items, notes,
        ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
        examPending: !examReady,
      }),
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, items, notes, host, d.engagement, examReady, libraryVersion],
  );
  // Lookup rows first (the answer, its commands ready to fill), then Arsenal categories (the drawer's rows), then one
  // group for the engagement, then the Manual. Each list stops at MAX_RESULTS; Lookup rows never count against the Arsenal's.
  const rowGroups = useMemo<ResultGroup<PaletteRow>[]>(() => {
    const arsenal = capGroups(found.groups, MAX_RESULTS).map((g) => ({ key: g.category, label: g.label, rows: g.hits.map(paletteRow) }));
    const out: ResultGroup<PaletteRow>[] = [
      ...found.lookups.map((g) => ({ key: g.key, lead: { code: g.code, text: g.text }, rows: g.results.map(paletteRow) })),
      ...arsenal,
    ];
    // The cap only keeps the dialog short: what it left out is one row away in the Arsenal, never silently dropped.
    const left = found.groups.reduce((n, g) => n + g.hits.length, 0) - arsenal.reduce((n, g) => n + g.rows.length, 0);
    if (left > 0) out.push({ key: "more", rows: [paletteRow({ type: "more", id: "more", count: left, title: `${left} more, open in the Arsenal` })] });
    if (found.items.length > 0) out.push({ key: "engagement", label: "This engagement", rows: found.items.slice(0, MAX_RESULTS).map(paletteRow) });
    if (found.manual.length > 0) out.push({ key: "manual", label: "Manual", rows: found.manual.map(paletteRow) });
    return out;
  }, [found]);
  const results = useMemo(() => rowGroups.flatMap((g) => g.rows.map((r) => r.result)), [rowGroups]);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const current: PaletteResult | undefined = results[index];

  const filled = useMemo(
    () => (current?.type === "command" ? fillPreview(current.command, current.msfMarker, makeInput, overrides, toolPrefill(query, host?.os ?? null)) : null),
    [current, host, makeInput, query, overrides],
  );

  useEffect(() => searchRef.current?.focus(), []);
  useEffect(() => {
    if (current) document.getElementById(`palette-${current.type}-${current.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const focusToken = useCallback((t: string) => fieldEls.current.get(t)?.focus(), []);
  const focusCred = useCallback(() => credRef.current?.focus(), []);
  const guard = useCopyGuard({ focusToken, focusCred, hostName: host ? shortHostName(host.name) : null });
  // Moving to another row ends a held-back copy: coming back to the first one holds it back again.
  const { reset: resetGuard } = guard;
  const currentKey = current ? `${current.type}-${current.id}` : "";
  useEffect(() => resetGuard(), [currentKey, resetGuard]);

  /** Copies the filled command through the copy guard: null when it was held back for an unfilled token. */
  const copy = async (): Promise<string | null> => {
    if (!filled) return null;
    const c = filled.cmd;
    const text = c.copyText ?? c.text;
    const r = await guard.attempt(c, () => (text !== c.text ? copySecret : copyPlain)(text));
    return r === "copied" ? text : null;
  };

  const run = async (log: boolean) => {
    setStatus(undefined);
    if (current?.type === "item") {
      void navigate(current.item.kind === "host" ? `/e/${engagementId}/h/${current.item.id}` : `/e/${engagementId}/s/${current.item.kind === "credential" ? "credentials" : "log"}`);
      onClose();
      return;
    }
    if (current?.type === "manual") {
      // Inside the Manual a move replaces its one history entry, so Esc still leaves the Manual.
      void navigate(manualSearchPath(current.noteId, query, current.anchor), { replace: location.pathname.startsWith("/manual") });
      // The Manual focuses the match itself: focus does not go back to where the palette opened.
      onClose({ handOff: true });
      return;
    }
    if (current?.type === "more") {
      if (engagementId) useLastEngagementStore.setState({ engagementId, hostId: host?.id ?? null });
      void navigate(`/arsenal?q=${encodeURIComponent(query.trim())}`);
      onClose();
      return;
    }
    if (current?.type === "generator") {
      // Generators live in Payloads: its drawer opens on this one (on /payloads the Workbench switches to it).
      onClose();
      // Generator hits come from GENERATORS, whose ids are Payloads generator ids.
      usePayloadsStore.getState().show(current.id as GeneratorId);
      return;
    }
    if (!filled || current?.type !== "command") return;
    try {
      const text = await copy();
      // Held back for an unfilled token: the field has focus and the hint says why. Nothing is copied, logged or closed.
      if (text === null) return;
      if (log && host && d.engagement) {
        const c = current.command;
        // The real values, as typed at the shell (not shell-escaped, not masked).
        const typed = fillCommand(c.template, filled.input, { commandOs: c.os }).text;
        await logCommand(qc, {
          engagementId, host, hosts: d.hosts, command: typed,
          title: c.title,
          ranOn: c.runFrom === "attacker" ? (d.settings?.machines[0] ?? "") : host.name,
        });
      }
      onClose();
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
    }
  };

  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };

  // Tab goes to the first field still empty. With every value filled there is nothing to jump to: Tab moves on as usual,
  // to the host picker. Only tokens that have a field count (a credential's USER and PASS have none once it is picked).
  const firstUnfilled = (): HTMLInputElement | undefined => {
    const t = filled?.tokens.find((n) => filled.auto[n]?.unresolved && !overrides[n] && fieldEls.current.has(n));
    return t ? fieldEls.current.get(t) : undefined;
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(results.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Tab" && !e.shiftKey && firstUnfilled()) {
      e.preventDefault();
      // The dialog's focus trap would otherwise see Tab leave its last field and loop back to the top.
      e.stopPropagation();
      firstUnfilled()?.focus();
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length && current?.type !== "item" && current?.type !== "more" && current?.type !== "manual") {
      // Goes in: a card opens in the Arsenal drawer, a command at its block, or alone when it has no card; a lookup
      // command opens its note at its row (the answer card). Never a no-op.
      if (!current) return;
      e.preventDefault();
      if (current.type === "command" && "lookup" in current) {
        // Inside the Manual a move replaces its one history entry, so Esc still leaves the Manual.
        void navigate(manualSearchPath(current.lookup.noteId, query, current.lookup.anchor, current.lookup.row), { replace: location.pathname.startsWith("/manual") });
        // The answer card focuses its first command: focus does not go back to where the palette opened.
        onClose({ handOff: true });
        return;
      }
      if (current.type === "generator") {
        void run(false);
        return;
      }
      if (current.type === "card") useArsenalStore.getState().openCard(current.id);
      else if (current.command.cardId) useArsenalStore.getState().openCard(current.command.cardId, current.command.id);
      else useArsenalStore.getState().openSolo(current.command);
      onClose();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (engagementId && isHostPickKey(e)) {
      e.preventDefault();
      pickerRef.current?.open();
      return;
    }
    if (engagementId && isCredPickKey(e)) {
      e.preventDefault();
      credRef.current?.open();
      return;
    }
    // Enter on the host chip chooses a host, never copies (the chip stops it; this is a backstop).
    if (e.key !== "Enter" || e.nativeEvent.isComposing || (e.target instanceof HTMLElement && e.target.getAttribute("aria-haspopup") === "listbox")) return;
    e.preventDefault();
    void run(e.metaKey || e.ctrlKey);
  };

  // The copy guard put focus on the credential chip: Enter there copies anyway (the chip would open its list).
  const onKeyCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !filled || !guard.hint || guard.forKey !== copyKey(filled.cmd)) return;
    if (!(e.target instanceof HTMLElement && e.target.getAttribute("aria-label")?.startsWith("Fill with credential"))) return;
    e.preventDefault();
    e.stopPropagation();
    void run(e.metaKey || e.ctrlKey);
  };

  const hasUnfilled = filled?.tokens.some((n) => filled.auto[n]?.unresolved && !overrides[n]) ?? false;
  const onManual = current?.type === "manual";
  const onLookup = current?.type === "command" && "lookup" in current;
  const hints = useMemo<Hint[]>(
    () => [
      { keys: "↵", label: onManual ? "open note" : "copy", priority: 1 },
      // A Manual row opens its note: nothing to log, no card to go into.
      ...(onManual ? [] : [{ keys: "⌘↵", label: host ? "copy and log" : "log (no host)", priority: 2 }]),
      ...(engagementId ? [{ keys: "⌥H", label: "host", priority: 3 }, { keys: "⌥C", label: "credential", priority: 3 }] : []),
      ...(onManual ? [] : [{ keys: "→", label: onLookup ? "open in Manual" : "in card", priority: 4 }]),
      // ⇥ jumps only to a value still missing; with every value filled Tab moves on to the host picker, so no hint.
      ...(hasUnfilled ? [{ keys: "⇥", label: "edit a value", priority: 5 }] : []),
    ],
    [engagementId, host, hasUnfilled, onManual, onLookup],
  );
  return (
    <div data-hint-surface="" className="palette" onKeyDown={onKey} onKeyDownCapture={onKeyCapture}>
      <header className="palette__header">
        <SearchBar
          label="Search"
          inputRef={searchRef}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={current ? `palette-${current.type}-${current.id}` : undefined}
          placeholder="Search commands, cards, this engagement, the Manual"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onSearchKey}
          {...(engagementId ? { trailing: null } : {})}
        />
        {engagementId && (
          <div className="palette__chips">
            <HostChip
              ref={pickerRef} hosts={d.hosts} loadError={d.hostsError} value={host?.id ?? null} onChange={pickHost} align="start" className="palette__chip"
              {...(remembered && d.engagement ? { engagementName: d.engagement.name } : {})}
            />
            <CredChip
              ref={credRef} credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred}
              onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)} className="palette__chip"
            />
          </div>
        )}
      </header>
      <div className="palette__results">
        {/* One line for an empty list; with notes imported it says the Manual was searched too. */}
        {results.length === 0 && (
          <p className="palette__empty">
            {notes.length > 0 && query.trim().length > 0 ? "Nothing matches, the Manual included" : "Nothing matches"}
          </p>
        )}
        <ResultList
          id="palette-results" label="Results" groups={rowGroups} selected={index}
          onActivate={(_, i) => {
            setSelected(i);
            searchRef.current?.focus();
          }}
        />
      </div>
      {filled && (
        <CommandPreview
          filled={filled} hasCred={cred !== null} hostKey={host?.id ?? null} suggest={suggestCtx} os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
          overrides={overrides} onOverrides={setOverrides}
          fieldRef={(t, el) => (el ? fieldEls.current.set(t, el) : fieldEls.current.delete(t))}
        />
      )}
      {guard.hint && filled && guard.forKey === copyKey(filled.cmd) && <p role="status" className="palette__notice">{guard.hint}</p>}
      {status && <p role="alert" className="palette__notice">{status}</p>}
      <footer className="palette__footer">
        <HintLine hints={hints} ariaLabel="Search shortcuts" />
      </footer>
    </div>
  );
}

/** ⌘K: search commands, generators, cards and this engagement, and copy the filled command. Mounted while unlocked. */
export function Palette() {
  const { isOpen, hostId: openedFor, returnFocus, handOff, close } = usePaletteStore();
  const scope = useFillScope();
  const engagementId = scope.engagementId;
  const hostId = openedFor ?? scope.hostId;

  // Give focus back to what had it (Radix does too when it can; this covers an element it can't restore).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen && !handOff) returnFocus?.focus();
    wasOpen.current = isOpen;
  }, [isOpen, returnFocus, handOff]);

  return (
    <Dialog
      open={isOpen} onOpenChange={(o) => !o && close()} title="Search" size="lg"
      onCloseAutoFocus={(e) => {
        if (usePaletteStore.getState().handOff) e.preventDefault();
      }}
    >
      {/* Always rendered: the dialog mounts it on open and unmounts it once its close animation ends, so the whole
          panel fades out rather than collapsing to its header. */}
      <PaletteBody engagementId={engagementId} hostId={hostId} remembered={scope.remembered} onClose={close} />
    </Dialog>
  );
}
