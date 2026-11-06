import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMatch, useNavigate } from "react-router";
import { getCards, getLibrary, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { isDialogOpen, isFreeKey, useKeydown } from "../../lib/keys";
import { Button, Input, Kbd } from "../../ui";
import { useFillBase } from "../palette/fillData";
import { searchPalette, type PaletteResult } from "../palette/search";
import { CardView, CommandPane } from "./CardView";
import { useArsenalStore } from "./useArsenalStore";
import { useFillScope } from "./useFillScope";

/** Commands shown in the result list; cards are never capped. */
const MAX_RESULTS = 40;

export interface ResultGroup {
  label: string;
  results: PaletteResult[];
}

/** `Shells-and-Transfers` → `Shells and Transfers`. */
export const categoryLabel = (category: string): string => category.replace(/[-_]+/g, " ").trim() || "Other";

/**
 * Cards and commands only, filtered by the exam rules of the engagement in view. Cards are grouped by category
 * (alphabetical, rank order inside); matching commands follow in one "Commands" group.
 */
function useArsenalSearch(query: string, engagementId: string, hostId: string | null): { groups: ResultGroup[]; results: PaletteResult[] } {
  const version = useLibraryVersion();
  const { d, host } = useFillBase(engagementId, hostId);
  return useMemo(() => {
    const all = searchPalette(query, {
      library: getLibrary(), cards: getCards(), generators: [],
      ...(host?.os === "linux" || host?.os === "windows" ? { os: host.os } : {}),
      ...(host ? { stageId: host.boardColumn } : {}),
      ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
    });
    const byCategory = new Map<string, PaletteResult[]>();
    for (const r of all) {
      if (r.type !== "card") continue;
      const label = categoryLabel(r.card.category);
      byCategory.set(label, [...(byCategory.get(label) ?? []), r]);
    }
    const groups: ResultGroup[] = [...byCategory.keys()].sort((a, b) => a.localeCompare(b)).map((label) => ({ label, results: byCategory.get(label)! }));
    // Every matching card (an import has well over a page of them); commands are capped.
    const commands = all.filter((r) => r.type === "command").slice(0, MAX_RESULTS);
    if (commands.length) groups.push({ label: "Commands", results: commands });
    return { groups, results: groups.flatMap((g) => g.results) };
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, host, d.engagement, version]);
}

function DrawerBody({ engagementId, hostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const cardId = useArsenalStore((s) => s.cardId);
  const [query, setQuery] = useState("");
  const [solo, setSolo] = useState<LibraryCommand | null>(null);
  const [selected, setSelected] = useState(0);
  // Fill chips apply across the whole drawer, but never carry over to another host.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [seenHost, setSeenHost] = useState(hostId);
  if (seenHost !== hostId) {
    setSeenHost(hostId);
    setOverrides({});
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const { host } = useFillBase(engagementId, hostId);
  const { groups, results } = useArsenalSearch(query, engagementId, hostId);

  useEffect(() => searchRef.current?.focus(), []);

  const pick = (r: PaletteResult) => {
    setQuery("");
    setSelected(0);
    if (r.type === "card") {
      setSolo(null);
      useArsenalStore.getState().openCard(r.id);
    } else if (r.type === "command" && r.command.cardId) {
      setSolo(null);
      useArsenalStore.getState().openCard(r.command.cardId);
    } else if (r.type === "command") {
      setSolo(r.command);
    }
  };

  const showing = query.trim() === "" ? (solo ? "solo" : cardId ? "card" : "results") : "results";

  /** From a card (or one command) back to the list. */
  const back = () => {
    setSolo(null);
    useArsenalStore.setState({ cardId: null });
    searchRef.current?.focus();
  };
  // Capture phase: Esc reaches the drawer before the screen's own Esc handler. On a card it goes back; on the list it closes.
  const onList = showing === "results";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
      e.preventDefault();
      if (onList) useArsenalStore.getState().close();
      else {
        setSolo(null);
        useArsenalStore.setState({ cardId: null });
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onList]);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(results.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing && showing === "results") {
      const r = results[index];
      if (!r) return;
      e.preventDefault();
      pick(r);
    }
  };

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        {showing !== "results" && (
          <Button size="sm" onClick={back}>
            ← Back
          </Button>
        )}
        <Input
          ref={searchRef}
          aria-label="Search the Arsenal"
          placeholder="Search cards and commands"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onSearchKey}
        />
        {host && <span className="shrink-0 text-xs text-muted">for {host.name}</span>}
        <Button
          size="sm"
          aria-label="Full screen"
          onClick={() => {
            useArsenalStore.getState().fullScreen();
            void navigate("/arsenal");
          }}
        >
          ⤢ full screen
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {showing === "card" && cardId && <CardView cardId={cardId} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={setOverrides} />}
        {showing === "solo" && solo && <CommandPane key={solo.id} commands={[solo]} engagementId={engagementId} hostId={hostId} overrides={overrides} onOverrides={setOverrides} />}
        {showing === "results" && (
          <div role="listbox" aria-label="Arsenal results" className="flex flex-col gap-2">
            {results.length === 0 && <p className="m-0 px-1 py-2 text-xs text-muted">Nothing matches</p>}
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="flex flex-col border-t border-line pt-1.5 first:border-t-0 first:pt-0">
                <h3 className="m-0 px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-label text-muted">{g.label}</h3>
                {g.results.map((r) => {
                  const i = results.indexOf(r);
                  return (
                    <button
                      key={`${r.type}-${r.id}`}
                      type="button"
                      role="option"
                      aria-selected={i === index}
                      onClick={() => pick(r)}
                      onMouseMove={() => setSelected(i)}
                      className={`flex w-full cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-[13px] ${i === index ? "bg-surface-2 text-fg" : "text-fg-2"}`}
                    >
                      <span className="min-w-0 truncate">{r.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{r.type === "card" ? "card" : r.type === "command" ? r.command.tool : ""}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="shrink-0 border-t border-line px-4 py-2 text-[11px] text-muted">
        <Kbd>Esc</Kbd> {showing === "results" ? "close" : "back"}
      </footer>
    </>
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
    if (onBrowse) document.getElementById("arsenal-browse")?.focus();
    else useArsenalStore.getState().toggle();
  });
  useEffect(() => {
    if (onBrowse && open) {
      useArsenalStore.getState().close();
      document.getElementById("arsenal-browse")?.focus();
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
    <aside aria-label="Arsenal" className="fixed inset-y-0 right-0 z-30 flex w-[440px] max-w-[70vw] flex-col border-l border-line-2 bg-surface text-fg-2">
      <DrawerBody engagementId={engagementId} hostId={hostId} />
    </aside>
  );
}
