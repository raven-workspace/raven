import { ArrowsOut } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMatch, useNavigate } from "react-router";
import { fillCommand } from "../../engines/checklist";
import { searchArsenal, type ArsenalHit } from "../../engines/library/arsenalSearch";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { shortHostName } from "../../lib/hostName";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { reportError } from "../../lib/lockSignal";
import { Button, HintLine, type Hint } from "../../ui";
import { logCommand } from "../capture/logCommand";
import { useCredPickStore } from "../checklist/credPick";
import { useFillBase } from "../palette/fillData";
import { GENERATORS } from "../palette/generators";
import type { SuggestContext } from "../palette/suggest";
import { CardView, CommandPane } from "./CardView";
import { CommandPreview, fillPreview } from "./CommandPreview";
import { copyKey, useCopyGuard } from "./copyGuard";
import { CredChip, isCredPickKey } from "./CredChip";
import type { CredChipHandle } from "./CredChip";
import { HostChip, isHostPickKey } from "./HostChip";
import type { HostChipHandle } from "./HostChip";
import { SearchBar } from "./SearchBar";
import { ResultList } from "./ResultList";
import type { ResultGroup, ResultRow } from "./ResultList";
import { useArsenalStore } from "./useArsenalStore";
import type { GeneratorId } from "../../engines/payloads/types";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { useFillScope } from "./useFillScope";

type Row = ResultRow & ({ kind: "category"; category: string } | { kind: "hit"; hit: ArsenalHit });

const hitRow = (hit: ArsenalHit): Row => ({
  kind: "hit", id: `arsenal-${hit.type}-${hit.id}`, hit, title: hit.title,
  tag: hit.type === "command" ? hit.command.tool : hit.type, mono: hit.type === "command",
});

function DrawerBody({ engagementId, hostId: routeHostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const libraryVersion = useLibraryVersion();
  const cardId = useArsenalStore((s) => s.cardId);
  const blockId = useArsenalStore((s) => s.blockId);
  const [query, setQuery] = useState("");
  // With no query: the category being listed, else the category list.
  const [category, setCategory] = useState<string | null>(null);
  const solo = useArsenalStore((s) => s.solo);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState<string>();
  // Fill chips apply across the whole drawer, but never carry over to another host.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // The chip can pick another host; moving to another host in the route follows the route again.
  const [hostId, setHostId] = useState(routeHostId);
  const [seenHost, setSeenHost] = useState(routeHostId);
  if (seenHost !== routeHostId) {
    setSeenHost(routeHostId);
    setHostId(routeHostId);
    setOverrides({});
  }
  const pickHost = (id: string | null) => {
    setHostId(id);
    setOverrides({});
  };
  const pickerRef = useRef<HostChipHandle>(null);
  const credRef = useRef<CredChipHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldEls = useRef(new Map<string, HTMLInputElement>());
  useKeydown((e) => {
    if (!engagementId || e.defaultPrevented || isDialogOpen()) return;
    if (isHostPickKey(e)) {
      e.preventDefault();
      pickerRef.current?.open();
    } else if (isCredPickKey(e)) {
      e.preventDefault();
      credRef.current?.open();
    }
  });
  const { d, host, cred, credOwnerId, makeInput, examReady } = useFillBase(engagementId, hostId);

  // Exam rules fail closed: until the engagement is known the drawer lists nothing, not even categories.
  const groups = useMemo(
    () =>
      examReady
        ? searchArsenal(query, {
            library: getLibrary(), cards: getCards(), generators: GENERATORS,
            ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
          })
        : [],
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, host, d.engagement, examReady, libraryVersion],
  );
  const searching = query.trim() !== "";
  const listing = searching || category !== null;
  const rowGroups = useMemo<ResultGroup<Row>[]>(() => {
    if (!listing) return [];
    return groups
      .filter((g) => searching || g.category === category)
      .map((g) => ({ key: g.category, label: g.label, rows: g.hits.map(hitRow) }));
  }, [groups, listing, searching, category]);
  const rows = useMemo<Row[]>(
    () =>
      listing
        ? rowGroups.flatMap((g) => g.rows)
        : groups.map((g): Row => ({ kind: "category", id: `arsenal-category-${g.category}`, category: g.category, title: g.label, tag: String(g.hits.length) })),
    [listing, rowGroups, groups],
  );
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const current: Row | undefined = rows[index];

  // Opened on a card (or one command), the reading pane takes focus (j/k/c); otherwise the search field does.
  useEffect(() => {
    const { cardId: card, solo: alone } = useArsenalStore.getState();
    if (!card && !alone) searchRef.current?.focus();
  }, []);
  useEffect(() => {
    if (current) document.getElementById(current.id)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const filled = useMemo(
    () => (current?.kind === "hit" && current.hit.type === "command" ? fillPreview(current.hit.command, current.hit.msfMarker, makeInput, overrides) : null),
    [current, makeInput, overrides],
  );

  const focusToken = useCallback((t: string) => fieldEls.current.get(t)?.focus(), []);
  const focusCred = useCallback(() => credRef.current?.focus(), []);
  const guard = useCopyGuard({ focusToken, focusCred, hostName: host ? shortHostName(host.name) : null });
  // Moving to another row ends a held-back copy: coming back to the first one holds it back again.
  const { reset: resetGuard } = guard;
  const currentId = current?.id;
  useEffect(() => resetGuard(), [currentId, resetGuard]);

  const showing = searching ? "results" : solo ? "solo" : cardId ? "card" : category !== null ? "results" : "categories";
  const openLinkedCard = (id: string) => useArsenalStore.getState().openCard(id);
  const onList = showing === "categories" || showing === "results";
  const previewRow = onList && listing;

  const openCategory = (c: string) => {
    setCategory(c);
    setSelected(0);
  };

  /** Copies the filled command through the copy guard; null when it was held back for an unfilled token. */
  const copy = async (): Promise<string | null> => {
    if (!filled) return null;
    const c = filled.cmd;
    const text = c.copyText ?? c.text;
    const r = await guard.attempt(c, () => (text !== c.text ? copySecret : copyPlain)(text));
    return r === "copied" ? text : null;
  };

  const copyCommand = async (hit: Extract<ArsenalHit, { type: "command" }>, log: boolean) => {
    setStatus(undefined);
    if (!filled) return;
    try {
      const text = await copy();
      if (text === null) return;
      if (log && host && d.engagement) {
        const c = hit.command;
        // The real values, as typed at the shell (not shell-escaped, not masked).
        const typed = fillCommand(c.template, filled.input, { commandOs: c.os }).text;
        await logCommand(qc, {
          engagementId, host, hosts: d.hosts, command: typed,
          title: c.title,
          ranOn: c.runFrom === "attacker" ? (d.settings?.machines[0] ?? "") : host.name,
        });
      }
    } catch (e) {
      reportError(e);
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  /** A card or generator opens; a command opens its card at its block, or alone when it has none. */
  const openHit = (hit: ArsenalHit, atBlock: boolean) => {
    setQuery("");
    setSelected(0);
    if (hit.type === "generator") {
      // Generators live in Payloads now: its drawer takes the right edge (and this one closes itself).
      usePayloadsStore.getState().show(hit.id as GeneratorId);
    } else if (hit.type === "card") {
      useArsenalStore.getState().openCard(hit.id);
    } else if (hit.command.cardId) {
      useArsenalStore.getState().openCard(hit.command.cardId, atBlock ? hit.command.id : undefined);
    } else {
      useArsenalStore.getState().openSolo(hit.command);
    }
  };

  /** From a card (or one command) back to the list. */
  const back = useCallback(() => {
    useArsenalStore.setState({ cardId: null, blockId: null, solo: null });
    searchRef.current?.focus();
  }, []);
  // Capture phase: Esc reaches the drawer before the screen's own Esc handler. On a card it goes back; in a category
  // it goes up to the categories; on the list it closes. A field with its suggestion list open keeps this Esc to close
  // just the list.
  const inCategory = !searching && category !== null && onList;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
      if (document.activeElement?.getAttribute("aria-expanded") === "true") return;
      e.preventDefault();
      if (inCategory) {
        setCategory(null);
        setSelected(0);
      } else if (onList) useArsenalStore.getState().close();
      else back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inCategory, onList, back]);

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing && onList) {
      if (!current) return;
      e.preventDefault();
      if (current.kind === "category") openCategory(current.category);
      else if (current.hit.type === "command") void copyCommand(current.hit, e.metaKey || e.ctrlKey);
      else openHit(current.hit, false);
    } else if (e.key === "ArrowRight" && onList && current && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      // → goes in: a category lists its hits, a card or generator opens, a command opens at its block.
      e.preventDefault();
      if (current.kind === "category") openCategory(current.category);
      else openHit(current.hit, true);
    }
  };

  // The copy guard put focus on the credential chip: Enter there copies anyway (the chip would open its list).
  const onKeyCapture = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || !filled || !guard.hint || guard.forKey !== copyKey(filled.cmd)) return;
    if (!(e.target instanceof HTMLElement && e.target.getAttribute("aria-label")?.startsWith("Fill with credential"))) return;
    if (current?.kind !== "hit" || current.hit.type !== "command") return;
    e.preventDefault();
    e.stopPropagation();
    void copyCommand(current.hit, e.metaKey || e.ctrlKey);
  };
  // Enter in one of the preview's fields copies too; Enter on a chip chooses, never copies.
  const onPreviewKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.defaultPrevented) return;
    if (e.target instanceof HTMLElement && e.target.getAttribute("aria-haspopup") === "listbox") return;
    if (current?.kind !== "hit" || current.hit.type !== "command") return;
    e.preventDefault();
    void copyCommand(current.hit, e.metaKey || e.ctrlKey);
  };

  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };
  const note = guard.forKey === (filled ? copyKey(filled.cmd) : null) ? (guard.hint ?? guard.confirm) : null;
  const activate = (r: Row, i: number) => {
    setSelected(i);
    if (r.kind === "category") openCategory(r.category);
    else if (r.hit.type === "command") searchRef.current?.focus();
    else openHit(r.hit, false);
  };
  const pickers: Hint[] = engagementId ? [{ keys: "⌥H", label: "host", priority: 4 }, { keys: "⌥C", label: "credential", priority: 4 }] : [];
  const hints: Hint[] = onList
    ? [
        { keys: "↵", label: "copy", priority: 1 },
        { keys: "⌘↵", label: host ? "copy and log" : "copy and log (open a host)", priority: 2 },
        { keys: "→", label: "in card", priority: 3 },
        ...pickers,
        { keys: "Esc", label: inCategory ? "back" : "close", priority: 1 },
      ]
    : [{ keys: "Esc", label: "back", priority: 1 }, ...pickers];
  return (
    <div
      // A results list keeps a fixed preview row under it: picking a longer or shorter command never moves the list.
      className={`grid h-full min-h-0 ${previewRow ? "grid-rows-[auto_minmax(0,1fr)_minmax(0,40%)_auto]" : "grid-rows-[auto_minmax(0,1fr)_auto]"}`}
      onKeyDownCapture={onKeyCapture}
    >
      <header className="grid shrink-0 gap-2 border-b border-line px-4 py-3">
        <div className={`grid items-center gap-2 ${onList ? "grid-cols-[1fr_auto]" : "grid-cols-[auto_1fr_auto]"}`}>
          {!onList && (
            <Button size="sm" onClick={back}>
              ← Back
            </Button>
          )}
          <div className="grid min-w-28">
            <SearchBar
              label="Search the Arsenal"
              inputRef={searchRef}
              placeholder="Search cards and commands"
              aria-controls="arsenal-results"
              aria-activedescendant={onList ? current?.id : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCategory(null);
                setSelected(0);
              }}
              onKeyDown={onSearchKey}
              {...(engagementId ? { trailing: null } : {})}
            />
          </div>
          <Button
            size="sm"
            aria-label="Full screen"
            title="Full screen"
            onClick={() => {
              useArsenalStore.getState().fullScreen();
              void navigate("/arsenal");
            }}
          >
            <ArrowsOut size={14} aria-hidden="true" />
          </Button>
        </div>
        {engagementId && (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] justify-items-start gap-3">
            <HostChip ref={pickerRef} hosts={d.hosts} value={host?.id ?? null} onChange={pickHost} className="max-w-full" />
            <CredChip
              ref={credRef} credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred}
              onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)} className="max-w-full"
            />
          </div>
        )}
      </header>
      <div className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3">
        {showing === "card" && cardId && <CardView onOpenCard={openLinkedCard} cardId={cardId} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={setOverrides} focusCred={focusCred} focusBlockId={blockId} />}
        {showing === "solo" && solo && <CommandPane key={solo.id} commands={[solo]} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={setOverrides} focusCred={focusCred} onOpenCard={openLinkedCard} />}
        {onList && (
          <>
            {examReady && rows.length === 0 && <p className="m-0 px-1 py-2 text-meta text-muted">Nothing matches</p>}
            <ResultList
              id="arsenal-results" label="Arsenal results" groups={listing ? rowGroups : [{ key: "categories", rows }]}
              selected={index} onActivate={activate}
            />
          </>
        )}
      </div>
      {previewRow && (
        <div className="grid min-h-0 content-start gap-1 overflow-y-auto overflow-x-hidden border-t border-line px-4 py-3" onKeyDown={onPreviewKey}>
          {filled ? (
            <>
            <CommandPreview
              filled={filled} hasCred={cred !== null} hostKey={host?.id ?? null} suggest={suggestCtx} os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
              overrides={overrides} onOverrides={setOverrides}
              fieldRef={(t, el) => (el ? fieldEls.current.set(t, el) : fieldEls.current.delete(t))}
            />
            {note && <p role="status" className={`m-0 text-meta ${guard.hint ? "text-warn" : "text-muted"}`}>{note}</p>}
            {status && <p role="alert" className="m-0 text-meta text-warn">{status}</p>}
            </>
          ) : (
            current && <p className="m-0 text-meta text-muted">↵ opens this {current.kind === "category" ? "category" : current.hit.type}</p>
          )}
        </div>
      )}
      <footer className="grid border-t border-line px-4 py-2">
        <HintLine hints={hints} ariaLabel="Arsenal shortcuts" />
      </footer>
    </div>
  );
}

/** The Arsenal (`A`): a drawer on the right edge, filled for the host in view. Mounted while unlocked. */
export function ArsenalDrawer() {
  const open = useArsenalStore((s) => s.open);
  const { engagementId, hostId } = useFillScope();
  const returnFocus = useRef<HTMLElement | null>(null);

  // A: toggles the drawer from any unlocked screen. The browse screen is the full-screen Arsenal: there it takes focus instead.
  const onBrowse = useMatch("/arsenal") !== null;
  useKeydown((e) => {
    if (!isFreeKey(e) || (e.key !== "a" && e.key !== "A")) return;
    e.preventDefault();
    if (onBrowse) document.getElementById("arsenal-search")?.focus();
    else useArsenalStore.getState().toggle();
  });
  useEffect(() => {
    if (onBrowse && open) {
      useArsenalStore.getState().close();
      document.getElementById("arsenal-search")?.focus();
    }
  }, [onBrowse, open]);

  // A lock unmounts this; the next unlock must not find it open.
  useEffect(() => () => useArsenalStore.getState().close(), []);

  useEffect(() => {
    if (!open) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
      return;
    }
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open]);

  if (!open || onBrowse) return null;
  return (
    <aside aria-label="Arsenal" data-hint-surface="" className="fixed inset-y-0 right-0 z-30 grid w-[500px] max-w-[70vw] border-l border-line-2 bg-surface text-fg-2">
      <DrawerBody engagementId={engagementId} hostId={hostId} />
    </aside>
  );
}
