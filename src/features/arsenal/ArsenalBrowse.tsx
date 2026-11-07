import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { filterForKind } from "../../engines/checklist";
import { searchArsenal, type ArsenalHit } from "../../engines/library/arsenalSearch";
import { allCategories, categoryLabel, categoryOf } from "../../engines/library/categories";
import { getCards, getLibrary, useLibraryVersion } from "../../engines/library/store";
import { cx } from "../../lib/cx";
import { isDialogOpen, isTypingTarget, useEscapeTo, useKeydown } from "../../lib/keys";
import { Button, Select } from "../../ui";
import { useCredPickStore } from "../checklist/credPick";
import { useFillBase } from "../palette/fillData";
import { GENERATORS } from "../palette/generators";
import { TransferGenerator } from "../generators/TransferGenerator";
import { browseList, OTHER_TOOLS, type BrowseSection } from "./browseList";
import { CardView, CommandPane } from "./CardView";
import { CredChip, isCredPickKey } from "./CredChip";
import type { CredChipHandle } from "./CredChip";
import { HostChip, isHostPickKey } from "./HostChip";
import type { HostChipHandle } from "./HostChip";
import { ResultList } from "./ResultList";
import type { ResultGroup, ResultRow } from "./ResultList";
import { SearchBar } from "./SearchBar";
import { ON } from "./styles";
import { useArsenalStore } from "./useArsenalStore";
import { useFillScope, useLastEngagementStore } from "./useFillScope";

type Row = ResultRow & { hit: ArsenalHit };
type Kind = "card" | "command" | "generator";
type Pick = { kind: Kind; id: string };

/** `withTool`: a command row shows its tool at the right (search results, and the "Other tools" block). */
const hitRow = (hit: ArsenalHit, searching: boolean, withTool = searching): Row => ({
  hit, id: `browse-${hit.type}-${hit.id}`, title: hit.title,
  tag: withTool && hit.type === "command" ? hit.command.tool : searching ? hit.type : hit.type === "generator" ? "generator" : "",
  mono: withTool && hit.type === "command",
  // Pane 2 is narrow: the tool goes under the title instead of eating its width.
  stack: withTool && hit.type === "command",
});
const sameHit = (h: ArsenalHit, p: Pick | null): boolean => p !== null && h.type === p.kind && h.id === p.id;
const hitCategory = (h: ArsenalHit, cards: ReturnType<typeof getCards>): string =>
  h.type === "card" ? h.card.category : h.type === "generator" ? h.category : categoryOf(h.command, cards);
const SEARCH_ID = "arsenal-search";
const READING_ID = "arsenal-reading";

/** `/arsenal`: categories | the category's list | the open item in full. Fills for the engagement and host you came from. */
export function ArsenalBrowse() {
  const version = useLibraryVersion();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const { engagementId, hostId } = useFillScope();
  const setHostId = (id: string | null) => useLastEngagementStore.setState({ engagementId: engagementId || null, hostId: id });
  const { d, host, cred, credOwnerId, examReady } = useFillBase(engagementId, hostId);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const hostRef = useRef<HostChipHandle>(null);
  const credRef = useRef<CredChipHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  // A category picked by arrow keeps focus on its button once the list has re-rendered.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfter.current === null) return;
    catsRef.current?.querySelector<HTMLElement>(`button[data-category="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  });

  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pick | null>(() => {
    const generator = GENERATORS.find((g) => g.id === params.get("generator"));
    if (generator) return { kind: "generator", id: generator.id };
    const { cardId, lastRead } = useArsenalStore.getState();
    return cardId ? { kind: "card", id: cardId } : lastRead;
  });

  useKeydown((e) => {
    if (e.defaultPrevented || isDialogOpen()) return;
    if (engagementId && isHostPickKey(e)) {
      e.preventDefault();
      hostRef.current?.open();
    } else if (engagementId && isCredPickKey(e)) {
      e.preventDefault();
      credRef.current?.open();
    } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      searchRef.current?.focus();
    }
  });

  // What the exam rules leave: until they are known, nothing at all (fail closed).
  /* eslint-disable react-hooks/exhaustive-deps */
  const { cards, library } = useMemo(() => {
    if (!examReady) return { cards: [], library: [] };
    const kind = d.engagement?.kind;
    const scope = { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null };
    const all = getLibrary();
    return {
      library: kind ? filterForKind(all, kind, scope).shown : all,
      cards: getCards().filter((c) => {
        if (!kind) return true;
        // A card whose every command the exam bans has nothing to show.
        const cmds = all.filter((x) => x.cardId === c.id);
        return cmds.length === 0 || filterForKind(cmds, kind, scope).shown.length > 0;
      }),
    };
  }, [d.engagement, examReady, host, version]);
  const lists = useMemo(() => {
    const out = new Map<string, BrowseSection[]>();
    for (const c of allCategories(cards)) {
      const sections = browseList(c, library, cards, examReady ? GENERATORS : []);
      if (sections.length > 0) out.set(c, sections);
    }
    return out;
  }, [cards, library, examReady]);
  const groups = useMemo(
    () =>
      examReady && query.trim() !== ""
        ? searchArsenal(query, {
            library: getLibrary(), cards: getCards(), generators: GENERATORS,
            ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
          })
        : [],
    [query, host, d.engagement, examReady, version],
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const searching = query.trim() !== "";

  const counts = new Map<string, number>([...lists].map(([c, s]) => [c, s.reduce((n, x) => n + x.rows.length, 0)]));
  const visible = [...counts.keys()];
  const hits = new Map(groups.map((g) => [g.category, g.hits.length]));

  // Which category pane 2 lists: the one picked, else the open item's, else the first.
  const selectedCategory = (() => {
    if (!selected) return null;
    if (selected.kind === "card") return cards.find((c) => c.id === selected.id)?.category ?? null;
    if (selected.kind === "generator") return GENERATORS.find((g) => g.id === selected.id)?.category ?? null;
    const c = library.find((x) => x.id === selected.id);
    return c ? categoryOf(c, cards) : null;
  })();
  const current = [category, selectedCategory].find((c): c is string => c !== null && visible.includes(c)) ?? visible[0] ?? null;

  const resultGroups: ResultGroup<Row>[] = searching
    ? groups.map((g) => ({ key: g.category, label: g.label, rows: g.hits.map((h) => hitRow(h, true)) }))
    : (lists.get(current ?? "") ?? []).map((s, i) => ({
        key: s.heading ?? `top${i}`, ...(s.heading === null ? {} : { label: s.heading }), rows: s.rows.map((h) => hitRow(h, false, s.heading === OTHER_TOOLS)),
      }));
  const rows = resultGroups.flatMap((g) => g.rows);
  const found = rows.findIndex((r) => sameHit(r.hit, selected));
  const index = found >= 0 ? found : 0;
  const open = rows[index]?.hit ?? null;

  const pick = (hit: ArsenalHit) => {
    const next = { kind: hit.type, id: hit.id };
    setSelected(next);
    useArsenalStore.setState({ lastRead: next, ...(hit.type === "card" ? { cardId: hit.id } : {}) });
  };
  const clearSearch = () => {
    // The category of what was open stays listed.
    if (open) setCategory(hitCategory(open, getCards()));
    setQuery("");
  };
  // Esc clears a typed search first; registered before the leave-Esc, which then sees it handled.
  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen() || query === "") return;
    e.preventDefault();
    clearSearch();
  });
  useEscapeTo("/");
  const openCategory = (c: string, move: boolean) => {
    setCategory(c);
    setQuery("");
    const first = lists.get(c)?.[0]?.rows[0];
    if (first) pick(first);
    if (move) listRef.current?.focus();
  };
  const fromCard = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    setQuery("");
    setCategory(card.category);
    pick({ type: "card", id: card.id, title: card.title, card });
  };

  const focusReading = () => (readingRef.current?.querySelector<HTMLElement>("[data-block]") ?? readingRef.current)?.focus();
  const focusCategory = () => catsRef.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
  const modified = (e: ReactKeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing;

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (modified(e)) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      listRef.current?.focus();
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      focusReading();
    }
  };
  const onCategoryKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (modified(e)) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      listRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = visible.indexOf(current ?? "");
      const next = visible[Math.max(0, Math.min(visible.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      // While searching the arrows only move; Enter or a click picks (and ends the search).
      if (searching) {
        const buttons = [...(catsRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        buttons[visible.indexOf(next)]?.focus();
      } else {
        openCategory(next, false);
        focusAfter.current = next;
      }
    }
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (modified(e)) return;
    if (e.key === "/" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) pick(next.hit);
      requestAnimationFrame(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }));
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      focusReading();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCategory();
    }
  };
  const onReadingKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (modified(e) || e.defaultPrevented || isTypingTarget(e.target) || e.key !== "ArrowLeft") return;
    e.preventDefault();
    listRef.current?.focus();
  };

  const focusCred = () => credRef.current?.focus();
  const reading = (() => {
    if (!open) return null;
    const common = { engagementId, hostId, overrides, onOverrides: setOverrides, focusCred, autoFocus: false };
    if (open.type === "generator") return open.id === "transfer" ? <TransferGenerator key={`${engagementId}`} engagementId={engagementId} hostId={hostId} /> : null;
    if (open.type === "card") return <CardView key={open.id} cardId={open.id} {...common} />;
    const c = open.command;
    const card = c.cardId ? cards.find((k) => k.id === c.cardId) : undefined;
    return (
      <article aria-label={c.title} className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <header className="grid gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold text-fg">{c.title}</h2>
          <p className="m-0 text-xs text-muted"><span className="font-mono">{c.tool}</span> · {categoryLabel(categoryOf(c, cards))}</p>
        </header>
        <CommandPane key={c.id} commands={[c]} {...common} />
        {card && (
          <div className="grid justify-items-start">
            <Button size="sm" onClick={() => fromCard(card.id)}>From card {card.title}</Button>
          </div>
        )}
      </article>
    );
  })();

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 px-6 py-5">
      <header className="grid grid-cols-[minmax(200px,320px)_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
        <SearchBar
          label="Search the Arsenal" id={SEARCH_ID} inputRef={searchRef} placeholder="Search cards and commands" trailing={null}
          value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
        />
        <div className="grid grid-flow-col items-center justify-start gap-3 text-xs text-muted">
          {d.engagement && <span className="min-w-0 max-w-48 truncate text-fg-2">{d.engagement.name}</span>}
          {engagementId ? (
            <>
              <HostChip
                ref={hostRef} align="start" hosts={d.hosts} value={host?.id ?? null} className="max-w-64"
                onChange={(id) => {
                  setHostId(id);
                  setOverrides({});
                }}
              />
              <CredChip
                ref={credRef} align="start" credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred}
                onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)} className="max-w-72"
              />
            </>
          ) : (
            <span>no active engagement</span>
          )}
        </div>
      </header>
      <div className="grid min-h-0 grid-cols-[minmax(220px,260px)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 min-[1100px]:grid-cols-[minmax(150px,180px)_minmax(220px,260px)_minmax(0,1fr)] min-[1280px]:grid-cols-[minmax(150px,180px)_minmax(260px,320px)_minmax(0,1fr)] min-[1100px]:grid-rows-[minmax(0,1fr)]">
        <nav aria-label="Categories" className="col-start-1 row-start-1 min-h-0 min-[1100px]:overflow-y-auto">
          <div className="grid min-[1100px]:hidden">
            <Select
              aria-label="Category" value={current ?? undefined} onValueChange={(c) => openCategory(c, false)}
              options={visible.map((c) => ({ value: c, label: `${categoryLabel(c)} (${searching ? (hits.get(c) ?? 0) : counts.get(c)})` }))}
              className="w-full"
            />
          </div>
          <div ref={catsRef} onKeyDown={onCategoryKey} className="hidden gap-0.5 min-[1100px]:grid">
            {visible.map((c) => {
              const n = searching ? (hits.get(c) ?? 0) : (counts.get(c) ?? 0);
              const on = c === current;
              return (
                <button
                  key={c} type="button" data-category={c} data-dim={searching && n === 0 ? "true" : undefined}
                  tabIndex={on ? 0 : -1} aria-current={on ? "true" : undefined} onClick={() => openCategory(c, true)}
                  className={cx(
                    "grid w-full cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1 text-left text-[13px]",
                    on ? ON : "text-fg-2 hover:bg-surface-2", searching && n === 0 && "opacity-40",
                  )}
                >
                  <span className="truncate">{categoryLabel(c)}</span>
                  <span className="text-[11px] text-muted">{n}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className="col-start-1 row-start-2 min-h-0 overflow-y-auto min-[1100px]:col-start-2 min-[1100px]:row-start-1">
          {examReady && rows.length === 0 && <p className="m-0 px-2 py-1 text-xs text-muted">Nothing matches</p>}
          <ResultList
            id="arsenal-results" label="Arsenal results" groups={resultGroups} selected={index} onSelect={() => {}}
            onActivate={(r) => {
              pick(r.hit);
              listRef.current?.focus();
            }}
            listRef={listRef}
            listProps={{ tabIndex: 0, onKeyDown: onListKey, "aria-activedescendant": rows[index]?.id }}
          />
        </div>
        <section
          id={READING_ID} ref={readingRef} tabIndex={-1} aria-label="Reading" onKeyDown={onReadingKey}
          className="min-h-0 overflow-y-auto outline-none min-[1100px]:col-start-3 max-[1099px]:col-start-2 max-[1099px]:row-span-2 max-[1099px]:row-start-1"
        >
          {reading}
        </section>
      </div>
    </div>
  );
}
