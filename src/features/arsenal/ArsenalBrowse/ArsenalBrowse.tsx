import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { examList } from "../../../engines/exam";
import { searchArsenal, type ArsenalHit } from "../../../engines/library/arsenalSearch";
import { allCategories, categoryLabel, categoryOf } from "../../../engines/library/categories";
import { useLibrary } from "../../../engines/library/store";
import type { CardMeta } from "../../../engines/library/types";
import { isDialogOpen, isTypingTarget, useEscapeBack, useKeydown } from "../../../lib/keys";
import { Button, HintLine, Select, type Hint } from "../../../ui/index";
import { useCredPickStore } from "../../checklist/credPick";
import { useFillBase } from "../../commands/fillData";
import { GENERATORS } from "../../palette/generators";
import { browseList, OTHER_TOOLS, type BrowseSection } from "../browseList";
import { CardView, CommandPane } from "../CardView/CardView";
import { CredChip, isCredPickKey } from "../CredChip/CredChip";
import type { CredChipHandle } from "../CredChip/CredChip";
import { HostChip, isHostPickKey } from "../HostChip/HostChip";
import type { HostChipHandle } from "../HostChip/HostChip";
import { ResultList } from "../ResultList/ResultList";
import type { ResultGroup, ResultRow } from "../ResultList/ResultList";
import { SearchBar } from "../SearchBar/SearchBar";
import { useArsenalStore } from "../useArsenalStore";
import { useFillScope, useLastEngagementStore } from "../useFillScope";
import { TabMarker } from "../../../ui/TabMarker";
import { useReferenceBase } from "../../workspace/referenceBase";
import "./ArsenalBrowse.scss";

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
const hitCategory = (h: ArsenalHit, cards: CardMeta[]): string =>
  h.type === "card" ? h.card.category : h.type === "generator" ? h.category : categoryOf(h.command, cards);
const SEARCH_ID = "arsenal-search";
const READING_ID = "arsenal-reading";

/** `/arsenal`: categories | the category's list | the open item in full. Fills for the engagement and host you came from. */
export function ArsenalBrowse() {
  const lib = useLibrary();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const { engagementId, hostId } = useFillScope();
  const setHostId = (id: string | null) => useLastEngagementStore.setState({ engagementId: engagementId || null, hostId: id });
  const { d, host, cred, credOwnerId, examReady, exam } = useFillBase(engagementId, hostId);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const hostRef = useRef<HostChipHandle>(null);
  const credRef = useRef<CredChipHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  // A category picked by arrow keeps focus on its button once the list has re-rendered.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfter.current === null) return;
    catsRef.current?.querySelector<HTMLElement>(`button[data-category="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  });

  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pick | null>(() => {
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

  // A list under the exam rules: what they leave (until the engagement's kind is known, no command that needs a verdict).
  const { cards, library } = useMemo(() => {
    const all = lib.commands;
    return {
      library: examList(all, exam).shown,
      cards: lib.cards.filter((c) => {
        // A card whose every command the exam rules hide has nothing to show.
        const cmds = all.filter((x) => x.cardId === c.id);
        return cmds.length === 0 || examList(cmds, exam).shown.length > 0;
      }),
    };
  }, [exam, lib]);
  const lists = useMemo(() => {
    const out = new Map<string, BrowseSection[]>();
    for (const c of allCategories(cards)) {
      const sections = browseList(c, library, cards, GENERATORS);
      if (sections.length > 0) out.set(c, sections);
    }
    return out;
  }, [cards, library]);
  const groups = useMemo(
    () => (query.trim() !== "" ? searchArsenal(query, { library: lib.commands, cards: lib.cards, generators: GENERATORS, exam }) : []),
    [query, exam, lib],
  );
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
    if (open) setCategory(hitCategory(open, lib.cards));
    setQuery("");
  };
  // Esc clears a typed search first; registered before the leave-Esc, which then sees it handled.
  useKeydown((e) => {
    if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen() || query === "") return;
    e.preventDefault();
    clearSearch();
  });
  // Back to wherever full screen was opened from, not always home.
  useEscapeBack();
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

  // A generator lives in Payloads: opening it goes there (Esc there comes back here).
  const navigate = useNavigate();
  const refBase = useReferenceBase();
  const payloadsPath = (id: string) => `${refBase}/payloads?generator=${encodeURIComponent(id)}`;
  const focusReading = () => {
    if (open?.type === "generator") void navigate(payloadsPath(open.id));
    else (readingRef.current?.querySelector<HTMLElement>("[data-block]") ?? readingRef.current)?.focus();
  };
  const wide = () => !catsRef.current || getComputedStyle(catsRef.current).display !== "none";
  // While the Arsenal is narrow the categories are the Select above the list, so ← goes there.
  const focusCategory = () => (wide() ? catsRef.current?.querySelector<HTMLElement>('button[tabindex="0"]') : selectRef.current)?.focus();
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
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      // From the focused tab (while searching it can differ from the open category).
      const from = (e.target as HTMLElement).closest<HTMLElement>("[data-category]")?.dataset.category ?? current ?? "";
      const at = visible.indexOf(from);
      const to = e.key === "Home" ? 0 : e.key === "End" ? visible.length - 1 : at + (e.key === "ArrowDown" ? 1 : -1);
      const next = visible[Math.max(0, Math.min(visible.length - 1, to))];
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
    const common = { engagementId, hostId, overrides, onOverrides: setOverrides, focusCred, autoFocus: false, onOpenCard: fromCard };
    if (open.type === "generator") {
      return (
        <article aria-label={open.title} className="arsenal-browse__generator">
          <h2 className="arsenal-browse__title">{open.title}</h2>
          <p className="arsenal-browse__note">This generator is in Payloads, with the reverse shells and SQL injection.</p>
          <Link to={payloadsPath(open.id)} className="arsenal-browse__link">Open in Payloads ↵</Link>
        </article>
      );
    }
    if (open.type === "card") return <CardView key={open.id} cardId={open.id} {...common} />;
    const c = open.command;
    const card = c.cardId ? cards.find((k) => k.id === c.cardId) : undefined;
    return (
      <article aria-label={c.title} className="arsenal-browse__article">
        <header className="arsenal-browse__article-header">
          <h2 className="arsenal-browse__title">{c.title}</h2>
          <p className="arsenal-browse__where"><span className="arsenal-browse__tool">{c.tool}</span><span>{categoryLabel(categoryOf(c, cards))}</span></p>
        </header>
        <CommandPane key={c.id} commands={[c]} {...common} />
        {card && (
          <div className="arsenal-browse__actions">
            <Button size="sm" onClick={() => fromCard(card.id)}>From card {card.title}</Button>
          </div>
        )}
      </article>
    );
  })();

  const hints: Hint[] = [
    { keys: "↑↓", label: "move", priority: 2 },
    { keys: "→", label: "read", priority: 1 },
    { keys: "←", label: "categories", priority: 4 },
    { keys: "/", label: "search", priority: 3 },
    ...(engagementId ? [{ keys: "⌥H", label: "host", priority: 4 }, { keys: "⌥C", label: "credential", priority: 5 }] : []),
    { keys: "Esc", label: query === "" ? "back" : "clear search", priority: 1 },
  ];

  return (
    <main aria-label="Arsenal" data-arsenal-browse="" data-hint-surface="" className="raven-page arsenal-browse">
      <header className="arsenal-browse__header">
        <SearchBar
          label="Search the Arsenal" id={SEARCH_ID} inputRef={searchRef} placeholder="Search cards and commands" trailing={null}
          value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
        />
        <div className="arsenal-browse__scope">
          {d.engagement && <span title={d.engagement.name} className="arsenal-browse__engagement">{d.engagement.name}</span>}
          {engagementId ? (
            <>
              <HostChip
                ref={hostRef} align="start" hosts={d.hosts} loadError={d.hostsError} value={host?.id ?? null} className="arsenal-browse__host"
                onChange={(id) => {
                  setHostId(id);
                  setOverrides({});
                }}
              />
              <CredChip
                ref={credRef} credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred}
                onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)} className="arsenal-browse__cred"
              />
            </>
          ) : (
            <span>no active engagement</span>
          )}
        </div>
      </header>
      <div className="arsenal-browse__body">
        <nav aria-label="Categories" className="arsenal-browse__categories">
          <div className="arsenal-browse__category-picker">
            <Select
              aria-label="Category" ref={selectRef} value={current ?? ""} onValueChange={(c) => openCategory(c, false)}
              options={visible.map((c) => ({ value: c, label: `${categoryLabel(c)} (${searching ? (hits.get(c) ?? 0) : counts.get(c)})` }))}
              className="arsenal-browse__category-select"
            />
          </div>
          <div ref={catsRef} role="tablist" aria-label="Categories" aria-orientation="vertical" onKeyDown={onCategoryKey} className="arsenal-browse__tabs">
            <TabMarker className="arsenal-browse__marker" />
            {visible.map((c) => {
              const n = searching ? (hits.get(c) ?? 0) : (counts.get(c) ?? 0);
              const on = c === current;
              return (
                <button
                  key={c} type="button" role="tab" data-category={c} data-dim={searching && n === 0 ? "true" : undefined}
                  tabIndex={on ? 0 : -1} aria-selected={on} title={categoryLabel(c)} onClick={() => openCategory(c, true)}
                  className="arsenal-browse__tab"
                >
                  <span className="arsenal-browse__tab-name">{categoryLabel(c)}</span>
                  <span className="arsenal-browse__tab-count">{n}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div className="arsenal-browse__results">
          {examReady && rows.length === 0 && <p className="arsenal-browse__empty">Nothing matches</p>}
          <ResultList
            id="arsenal-results" label="Arsenal results" groups={resultGroups} selected={index}
            onActivate={(r) => {
              if (r.hit.type === "generator") return void navigate(payloadsPath(r.hit.id));
              pick(r.hit);
              listRef.current?.focus();
            }}
            listRef={listRef}
            listProps={{ tabIndex: 0, onKeyDown: onListKey, "aria-activedescendant": rows[index]?.id }}
          />
        </div>
        <section
          id={READING_ID} ref={readingRef} tabIndex={-1} aria-label="Reading" onKeyDown={onReadingKey}
          className="arsenal-browse__reading"
        >
          {reading}
        </section>
      </div>
      <footer className="arsenal-browse__footer">
        <HintLine hints={hints} ariaLabel="Arsenal shortcuts" />
      </footer>
    </main>
  );
}
