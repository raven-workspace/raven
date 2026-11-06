import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMatch, useNavigate } from "react-router";
import { defaultCredFor, fillCommand, portChoices, type FillInput } from "../../engines/checklist";
import { credLabel } from "../../engines/credentials/labels";
import { getCards, getLibrary, getToolkit, useLibraryVersion } from "../../engines/library/store";
import { api } from "../../lib/api";
import { copyPlain, copySecret } from "../../lib/clipboard";
import { reportError } from "../../lib/lockSignal";
import type { Engagement } from "../../types/engagement";
import type { Host } from "../../types/host";
import type { Service } from "../../types/service";
import { Chip, Dialog, Input, Kbd } from "../../ui";
import { logCommand } from "../capture/logCommand";
import { fillLibraryCommand } from "../checklist/goalCommands";
import { useCredPickStore } from "../checklist/credPick";
import { engagementServicesKey, tunnelsKey } from "../checklist/queries";
import { credAttemptsKey, credentialsKey } from "../credentials/queries";
import { GENERATORS } from "./generators";
import { searchPalette, type EngagementItem, type PaletteResult } from "./search";
import { usePaletteStore } from "./usePaletteStore";

const MAX_RESULTS = 30;
const GROUPS = { command: "Commands", generator: "Generators", card: "Cards", item: "This engagement" } as const;

const NO_HOSTS: Host[] = [];
const DASHBOARD_ENGAGEMENT: Engagement = {
  id: "", name: "", kind: "lab", client: null, subLabel: null, scopeCidrs: [], domain: null, startsAt: null, endsAt: null,
  timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: 0, updatedAt: 0, lastActivityAt: null, lastRanOn: null, msfHostId: null,
};
const noHost = (engagementId: string): Host => ({
  id: "", engagementId, name: "", ip: null, os: null, boardColumn: "information-gathering", boardManual: false, dualHomed: false,
  boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, access: "none", createdAt: 0, updatedAt: 0,
});

/** The best staged Toolkit file whose name contains a query word: it pre-fills {FILE}. */
function toolPrefill(query: string, os: Host["os"]): Record<string, string> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return {};
  const hits = getToolkit()
    .filter((t) => t.staged && words.some((w) => t.file.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.os === os) - Number(a.os === os));
  return hits[0] ? { FILE: hits[0].file } : {};
}

function usePaletteData(engagementId: string) {
  const enabled = engagementId !== "";
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settingsGet });
  const engagement = useQuery({ queryKey: ["engagement", engagementId], queryFn: () => api.engagementGet(engagementId), enabled });
  const hosts = useQuery({ queryKey: ["hosts", engagementId], queryFn: () => api.hostsList(engagementId), enabled });
  const services = useQuery({ queryKey: engagementServicesKey(engagementId), queryFn: () => api.servicesListEngagement(engagementId), enabled });
  const tunnels = useQuery({ queryKey: tunnelsKey(engagementId), queryFn: () => api.tunnelsList(engagementId), enabled });
  const credentials = useQuery({ queryKey: credentialsKey(engagementId), queryFn: () => api.credentialsList(engagementId), enabled });
  const attempts = useQuery({ queryKey: credAttemptsKey(engagementId), queryFn: () => api.credAttemptsList(engagementId), enabled });
  const log = useQuery({ queryKey: ["log", engagementId], queryFn: () => api.logList(engagementId), enabled });
  return { settings: settings.data, engagement: engagement.data, hosts: hosts.data ?? NO_HOSTS, services: services.data, tunnels: tunnels.data, credentials: credentials.data, attempts: attempts.data, log: log.data };
}

function PaletteBody({ engagementId, hostId, onClose }: { engagementId: string; hostId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const libraryVersion = useLibraryVersion();
  const d = usePaletteData(engagementId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const tokenRefs = useRef<HTMLInputElement[]>([]);
  const picked = useCredPickStore((s) => (hostId ? s.picks[hostId] : undefined));

  const host = hostId ? d.hosts.find((h) => h.id === hostId) : undefined;
  const engagement = d.engagement ?? DASHBOARD_ENGAGEMENT;

  const items = useMemo<EngagementItem[]>(() => {
    if (!engagementId) return [];
    const out: EngagementItem[] = [];
    for (const e of d.log ?? []) {
      const text = e.content.kind === "command" ? e.content.blocks.map((b) => b.command).join("\n") : e.content.kind === "note" ? e.content.text : "";
      out.push({ id: e.id, kind: e.kind === "note" ? "note" : "log", title: e.title, text });
    }
    // Credential labels only: a secret is never searched or shown.
    for (const c of d.credentials ?? []) out.push({ id: c.id, kind: "credential", title: credLabel(c), text: "" });
    return out;
  }, [engagementId, d.log, d.credentials]);

  const results = useMemo(
    () =>
      searchPalette(query, {
        library: getLibrary(), cards: getCards(), generators: GENERATORS, engagementItems: items,
        ...(host?.os === "linux" || host?.os === "windows" ? { os: host.os } : {}),
        ...(host ? { stageId: host.boardColumn } : {}),
        ...(d.engagement ? { exam: { kind: d.engagement.kind, hostId: host?.id ?? "", msfHostId: d.engagement.msfHostId } } : {}),
      }).slice(0, MAX_RESULTS),
    // getLibrary()/getCards() change only with the library version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, items, host, d.engagement, libraryVersion],
  );
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const current: PaletteResult | undefined = results[index];

  const cred = useMemo(() => {
    if (!host || !d.credentials) return null;
    if (picked === null) return null;
    return d.credentials.find((c) => c.id === picked) ?? defaultCredFor(host, d.credentials, d.attempts ?? []);
  }, [host, d.credentials, d.attempts, picked]);

  const filled = useMemo(() => {
    if (current?.type !== "command") return null;
    const servicesByHost = new Map<string, Service[]>();
    for (const s of d.services ?? []) servicesByHost.set(s.hostId, [...(servicesByHost.get(s.hostId) ?? []), s]);
    const h = host ?? noHost(engagementId);
    const input: FillInput = {
      host: h, engagement, hosts: d.hosts, servicesByHost, tunnels: d.tunnels ?? [],
      attackerIp: d.settings?.attackerIp ?? "", kaliUser: d.settings?.kaliUser, listenerPort: d.settings?.listenerPort ?? "",
      cred: host ? cred : null,
      overrides: { ...toolPrefill(query, h.os), ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k.toUpperCase(), v])) },
    };
    const portHint = host ? portChoices(input) : [];
    if (portHint.length) input.portHint = portHint;
    return { cmd: fillLibraryCommand(current.command, input, current.msfMarker), input };
  }, [current, host, engagementId, engagement, d.hosts, d.services, d.tunnels, d.settings, cred, query, overrides]);

  useEffect(() => searchRef.current?.focus(), []);

  const copy = async (): Promise<string | null> => {
    if (!filled) return null;
    const c = filled.cmd;
    const text = c.copyText ?? c.text;
    await (text !== c.text ? copySecret : copyPlain)(text);
    return text;
  };

  const run = async (log: boolean) => {
    setStatus(undefined);
    if (current?.type === "item") {
      const section = current.item.kind === "credential" ? "credentials" : "log";
      void navigate(`/e/${engagementId}/s/${section}`);
      onClose();
      return;
    }
    if (!filled || current?.type !== "command") return;
    try {
      const text = await copy();
      if (log && host && text !== null && d.engagement) {
        const c = current.command;
        // The real values, as typed at the shell (not shell-escaped, not masked).
        const typed = fillCommand(c.template, filled.input).text;
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

  // A field stays once edited, even though filling it resolves the token.
  const tpl = current?.type === "command" ? current.command.template.toUpperCase() : "";
  const unresolved = filled
    ? [...new Set([...filled.cmd.unresolved, ...Object.keys(overrides).filter((k) => tpl.includes(k.toUpperCase()))])]
    : [];

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(0, Math.min(results.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Tab" && !e.shiftKey && unresolved.length > 0) {
      e.preventDefault();
      // The dialog's focus trap would otherwise see Tab leave its last field and loop back to the top.
      e.stopPropagation();
      tokenRefs.current[0]?.focus();
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length && current?.type !== "item") {
      // Opens the card in the Arsenal drawer once it exists; until then the key does nothing.
      e.preventDefault();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void run(e.metaKey || e.ctrlKey);
  };

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKey}>
      <div className="flex items-center gap-2">
        <Input
          ref={searchRef}
          role="combobox"
          aria-label="Search"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={current ? `palette-${current.type}-${current.id}` : undefined}
          placeholder="Search commands, cards, this engagement"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onSearchKey}
        />
        {engagementId && host && <Chip className="shrink-0">for {host.name}</Chip>}
      </div>
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
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-fg">{filled.cmd.text}</pre>
          {filled.cmd.msfMarker && <Chip>uses your one Metasploit host</Chip>}
          {unresolved.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unresolved.map((name, i) => {
                const key = name;
                return (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-warn">
                    {name}
                    <Input
                      mono
                      aria-label={`Value for ${name}`}
                      className="h-7 w-40"
                      value={overrides[key] ?? ""}
                      ref={(el) => {
                        if (el) tokenRefs.current[i] = el;
                      }}
                      onChange={(e) => setOverrides((o) => ({ ...o, [key]: e.target.value }))}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
      {status && <p role="alert" className="m-0 text-xs text-warn">{status}</p>}
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span><Kbd>↵</Kbd> copy</span>
        <span><Kbd>⌘↵</Kbd> copy and log{host ? "" : " (open a host)"}</span>
        <span><Kbd>→</Kbd> card</span>
        <span><Kbd>⇥</Kbd> edit a value</span>
      </p>
    </div>
  );
}

/** ⌘K: search commands, generators, cards and this engagement, and copy the filled command. Mounted while unlocked. */
export function Palette() {
  const { isOpen, hostId: openedFor, returnFocus, close } = usePaletteStore();
  const hostMatch = useMatch("/e/:id/h/:hostId");
  const engMatch = useMatch("/e/:id/*");
  const engagementId = hostMatch?.params.id ?? engMatch?.params.id ?? "";
  const hostId = openedFor ?? hostMatch?.params.hostId ?? null;

  // Give focus back to what had it (Radix does too when it can; this covers an element it can't restore).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !isOpen) returnFocus?.focus();
    wasOpen.current = isOpen;
  }, [isOpen, returnFocus]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()} title="Search" size="lg">
      {isOpen && <PaletteBody engagementId={engagementId} hostId={hostId} onClose={close} />}
    </Dialog>
  );
}
