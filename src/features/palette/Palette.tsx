import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { fillCommand } from "../../engines/checklist";
import { credLabel } from "../../engines/credentials/labels";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { reportError } from "../../lib/lockSignal";
import { Dialog, Kbd } from "../../ui";
import { logCommand } from "../capture/logCommand";
import { copyKey, useCopyGuard } from "../arsenal/copyGuard";
import { shortHostName } from "../../lib/hostName";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { useFillScope, useLastEngagementStore } from "../arsenal/useFillScope";
import { CredChip, isCredPickKey } from "../arsenal/CredChip";
import type { CredChipHandle } from "../arsenal/CredChip";
import { CommandPreview, fillPreview, toolPrefill } from "../arsenal/CommandPreview";
import { HostChip, isHostPickKey } from "../arsenal/HostChip";
import type { HostChipHandle } from "../arsenal/HostChip";
import { useCredPickStore } from "../checklist/credPick";
import { SearchBar } from "../arsenal/SearchBar";
import { useFillBase } from "./fillData";
import { GENERATORS } from "./generators";
import { flattenGroups, searchPalette, withoutSecrets, type EngagementItem, type PaletteResult } from "./search";
import { usePaletteStore } from "./usePaletteStore";
import type { SuggestContext } from "./suggest";

const MAX_RESULTS = 30;
const GROUPS = { command: "Commands", generator: "Generators", card: "Cards", item: "This engagement" } as const;

function PaletteBody({ engagementId, hostId: openedHostId, remembered, onClose }: { engagementId: string; hostId: string | null; remembered: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
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

  const results = useMemo(
    () =>
      searchPaletteFlat(query, {
        library: getLibrary(), cards: getCards(), generators: GENERATORS, engagementItems: items,
        ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
        examPending: !examReady,
      }).slice(0, MAX_RESULTS),
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, items, host, d.engagement, examReady, libraryVersion],
  );
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const current: PaletteResult | undefined = results[index];

  const filled = useMemo(
    () => (current?.type === "command" ? fillPreview(current.command, current.msfMarker, makeInput, overrides, toolPrefill(query, host?.os ?? null)) : null),
    [current, host, makeInput, query, overrides],
  );

  useEffect(() => searchRef.current?.focus(), []);

  const focusToken = useCallback((t: string) => fieldEls.current.get(t)?.focus(), []);
  const focusCred = useCallback(() => credRef.current?.focus(), []);
  const guard = useCopyGuard({ focusToken, focusCred, hostName: host ? shortHostName(host.name) : null });

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
    if (current?.type === "generator") {
      // The generator lives in full-screen Arsenal, for the engagement and host in view here.
      if (engagementId) useLastEngagementStore.setState({ engagementId, hostId: host?.id ?? null });
      void navigate(`/arsenal?generator=${encodeURIComponent(current.id)}`);
      onClose();
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
          title: `${c.title} · ${host.ip ?? host.name}`,
          ranOn: c.runFrom === "attacker" ? (d.settings?.machines[0] ?? "") : host.name,
        });
      }
      onClose();
    } catch (e) {
      reportError(e);
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const suggestCtx: SuggestContext = { engagement: d.engagement, hosts: d.hosts, services: d.services, credentials: d.credentials, host, toolkit: getToolkit() };

  // Tab goes to the first field still empty, else the first field.
  const firstUnfilled = (): HTMLInputElement | undefined => {
    const t = filled?.tokens.find((n) => filled.auto[n]?.unresolved && !overrides[n]) ?? filled?.tokens[0];
    return t ? fieldEls.current.get(t) : undefined;
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(results.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Tab" && !e.shiftKey && (filled?.tokens.length ?? 0) > 0) {
      e.preventDefault();
      // The dialog's focus trap would otherwise see Tab leave its last field and loop back to the top.
      e.stopPropagation();
      firstUnfilled()?.focus();
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length && current?.type !== "item") {
      // Opens the card in the Arsenal drawer.
      const cardId = current?.type === "card" ? current.id : current?.type === "command" ? current.command.cardId : undefined;
      if (!cardId) return;
      e.preventDefault();
      useArsenalStore.getState().openCard(cardId);
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

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKey} onKeyDownCapture={onKeyCapture}>
      <SearchBar
        label="Search"
        inputRef={searchRef}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={current ? `palette-${current.type}-${current.id}` : undefined}
        placeholder="Search commands, cards, this engagement"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onSearchKey}
        trailing={
          engagementId ? (
            <>
              <CredChip
                ref={credRef} credentials={d.credentials ?? []} attempts={d.attempts ?? []} hostId={host?.id ?? null} value={cred}
                onPick={(id) => useCredPickStore.getState().set(credOwnerId, id)}
              />
              <HostChip ref={pickerRef} hosts={d.hosts} value={host?.id ?? null} onChange={pickHost} {...(remembered && d.engagement ? { engagementName: d.engagement.name } : {})} />
            </>
          ) : undefined
        }
      />
      <ul id="palette-results" role="listbox" aria-label="Results" className="m-0 flex max-h-[44vh] list-none flex-col overflow-y-auto p-0">
        {results.length === 0 && <li role="presentation" className="px-1 py-2 text-xs text-muted">Nothing matches</li>}
        {results.map((r, i) => (
          <li key={`${r.type}-${r.id}`} role="presentation">
            {(i === 0 || results[i - 1]!.type !== r.type) && (
              <h3 className="m-0 px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-label text-muted">{GROUPS[r.type]}</h3>
            )}
            <div
              id={`palette-${r.type}-${r.id}`}
              role="option"
              aria-selected={i === index}
              onMouseMove={() => setSelected(i)}
              onClick={() => {
                setSelected(i);
                searchRef.current?.focus();
              }}
              className={`flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1 text-[13px] ${i === index ? "bg-surface-2 text-fg" : "text-fg-2"}`}
            >
              <span className="min-w-0 truncate">{r.title}</span>
              {r.type === "command" && <span className="shrink-0 font-mono text-[11px] text-muted">{r.command.tool}</span>}
              {r.type === "item" && <span className="shrink-0 text-[11px] text-muted">{r.item.kind}</span>}
            </div>
          </li>
        ))}
      </ul>
      {filled && (
        <CommandPreview
          filled={filled} hasCred={cred !== null} hostKey={host?.id ?? null} suggest={suggestCtx} os={host?.os === "linux" || host?.os === "windows" ? host.os : null}
          overrides={overrides} onOverrides={setOverrides}
          fieldRef={(t, el) => (el ? fieldEls.current.set(t, el) : fieldEls.current.delete(t))}
        />
      )}
      {guard.hint && filled && guard.forKey === copyKey(filled.cmd) && <p role="status" className="m-0 text-xs text-warn">{guard.hint}</p>}
      {status && <p role="alert" className="m-0 text-xs text-warn">{status}</p>}
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span><Kbd>↵</Kbd> copy</span>
        <span><Kbd>⌘↵</Kbd> copy and log{host ? "" : " (open a host)"}</span>
        <span><Kbd>→</Kbd> card</span>
        <span><Kbd>⇥</Kbd> edit a value</span>
        {engagementId && <span><Kbd>⌥H</Kbd> host</span>}
        {engagementId && <span><Kbd>⌥C</Kbd> credential</span>}
      </p>
    </div>
  );
}

/** Arsenal hits flattened (relevance order inside each type), then engagement items. Task 8 renders the groups. */
function searchPaletteFlat(q: string, c: Parameters<typeof searchPalette>[1]): PaletteResult[] {
  const r = searchPalette(q, c);
  return [...flattenGroups(r.groups), ...r.items];
}

/** ⌘K: search commands, generators, cards and this engagement, and copy the filled command. Mounted while unlocked. */
export function Palette() {
  const { isOpen, hostId: openedFor, returnFocus, close } = usePaletteStore();
  const scope = useFillScope();
  const engagementId = scope.engagementId;
  const hostId = openedFor ?? scope.hostId;

  // Give focus back to what had it (Radix does too when it can; this covers an element it can't restore).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen) returnFocus?.focus();
    wasOpen.current = isOpen;
  }, [isOpen, returnFocus]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()} title="Search" size="lg">
      {isOpen && <PaletteBody engagementId={engagementId} hostId={hostId} remembered={scope.remembered} onClose={close} />}
    </Dialog>
  );
}
