import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { getCards, getLibrary, useLibraryVersion } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import { isDialogOpen } from "../../lib/keys";
import { Button, Input, Kbd } from "../../ui";
import { useFillBase } from "../palette/fillData";
import { searchPalette, type PaletteResult } from "../palette/search";
import { CardView, CommandPane } from "./CardView";
import { useArsenalStore } from "./useArsenalStore";

const MAX_RESULTS = 40;

/** Cards and commands only, filtered by the exam rules of the engagement in view. Shared with browse's search. */
export function useArsenalSearch(query: string, engagementId: string, hostId: string | null): PaletteResult[] {
  const version = useLibraryVersion();
  const { d, host } = useFillBase(engagementId, hostId);
  return useMemo(() => {
    const all = searchPalette(query, {
      library: getLibrary(), cards: getCards(), generators: [],
      ...(host?.os === "linux" || host?.os === "windows" ? { os: host.os } : {}),
      ...(host ? { stageId: host.boardColumn } : {}),
      ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
    }).filter((r) => r.type === "card" || r.type === "command");
    return [...all.filter((r) => r.type === "card"), ...all.filter((r) => r.type === "command")].slice(0, MAX_RESULTS);
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, host, d.engagement, version]);
}

function DrawerBody({ engagementId, hostId }: { engagementId: string; hostId: string | null }) {
  const navigate = useNavigate();
  const cardId = useArsenalStore((s) => s.cardId);
  const [query, setQuery] = useState("");
  const [solo, setSolo] = useState<LibraryCommand | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { host } = useFillBase(engagementId, hostId);
  const results = useArsenalSearch(query, engagementId, hostId);

  useEffect(() => searchRef.current?.focus(), []);

  const pick = (r: PaletteResult) => {
    setQuery("");
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

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <Input
          ref={searchRef}
          aria-label="Search the Arsenal"
          placeholder="Search cards and commands"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
        {showing === "card" && cardId && <CardView cardId={cardId} engagementId={engagementId} hostId={hostId} />}
        {showing === "solo" && solo && <CommandPane key={solo.id} commands={[solo]} engagementId={engagementId} hostId={hostId} />}
        {showing === "results" && (
          <ul role="listbox" aria-label="Arsenal results" className="m-0 flex list-none flex-col p-0">
            {results.length === 0 && <li role="presentation" className="px-1 py-2 text-xs text-muted">Nothing matches</li>}
            {results.map((r) => (
              <li key={`${r.type}-${r.id}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(r)}
                  className="flex w-full cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg"
                >
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">{r.type === "card" ? "card" : r.type === "command" ? r.command.tool : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="shrink-0 border-t border-line px-4 py-2 text-[11px] text-muted">
        <Kbd>Esc</Kbd> close
      </footer>
    </>
  );
}

/** The Arsenal (`A`): a drawer on the right edge, filled for the host in view. Mounted while unlocked. */
export function ArsenalDrawer() {
  const open = useArsenalStore((s) => s.open);
  const hostMatch = useMatch("/e/:id/h/:hostId");
  const engMatch = useMatch("/e/:id/*");
  const engagementId = hostMatch?.params.id ?? engMatch?.params.id ?? "";
  const hostId = hostMatch?.params.hostId ?? null;
  const returnFocus = useRef<HTMLElement | null>(null);

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
    // Capture phase: Esc reaches the drawer before the screen's own Esc handler.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isDialogOpen()) return;
      e.preventDefault();
      useArsenalStore.getState().close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <aside aria-label="Arsenal" className="fixed inset-y-0 right-0 z-30 flex w-[440px] max-w-[70vw] flex-col border-l border-line-2 bg-surface text-fg-2">
      <DrawerBody engagementId={engagementId} hostId={hostId} />
    </aside>
  );
}
