import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fillCommand, filterForKind } from "../../engines/checklist";
import { isHttp, transferMethods, TRANSFER_CARD, withToolsDirs } from "../../engines/generators/transfer";
import { getCards, getLibrary, useLibraryVersion } from "../../engines/library/store";
import { copyPlain } from "../../lib/clipboard";
import { cx } from "../../lib/cx";
import { isDialogOpen, useKeydown } from "../../lib/keys";
import { shortHostName } from "../../lib/hostName";
import { reportError } from "../../lib/lockSignal";
import { ChipSet, Input, Kbd, Select, labelClass } from "../../ui";
import { useCopyGuard } from "../arsenal/copyGuard";
import { logCommand } from "../capture/logCommand";
import { CommandList } from "../checklist/CommandList";
import { fillLibraryCommand } from "../checklist/goalCommands";
import { useFillBase } from "../palette/fillData";
import { FilePicker } from "./FilePicker";
import { RavenError } from "../../types/errors";

type Os = "windows" | "linux";
const DEFAULT_DIR: Record<Os, string> = { windows: "C:\\Windows\\Temp", linux: "/tmp" };
/** Method pills sit under two plain labels so no row is a long run of mixed tools. */
const METHOD_GROUPS = [
  { label: "HTTP", test: isHttp },
  { label: "Other", test: (g: string) => !isHttp(g) },
];
const FIELD_COLS: Record<number, string> = {
  2: "grid-cols-[max-content_max-content_minmax(0,1fr)]",
  3: "grid-cols-[max-content_max-content_max-content_minmax(0,1fr)]",
  4: "grid-cols-[max-content_max-content_max-content_max-content_minmax(0,1fr)]",
};
const dirKey = (os: Os) => `raven.transfer.dir.${os}`;
const readDir = (os: Os): string => {
  try {
    return localStorage.getItem(dirKey(os)) ?? "";
  } catch {
    return "";
  }
};
const saveDir = (os: Os, dir: string) => {
  try {
    if (dir.trim()) localStorage.setItem(dirKey(os), dir.trim());
    else localStorage.removeItem(dirKey(os));
  } catch {
    // Remembering the folder is a convenience.
  }
};

/**
 * "Transfer a file": pick a Toolkit file, a host and folder, and a method; get the Kali command and the target command
 * as a copy-ready pair. The methods come from the transfer cards in the library (imported cards win), so editing a
 * card changes the generator. ⌘↵ copies and logs the target half against the host. Copy and ⌘↵ go through the copy
 * guard: an unfilled token (a blank LHOST) copies nothing on the first try and focuses its field.
 * It runs inside Payloads, which supplies the OS and LHOST it settled on and the field for a token this has none for.
 */
export function TransferGenerator({ engagementId, hostId: viewHostId, os: contextOs, lhost, focusToken: focusOuter, autoFocus = true }: {
  engagementId: string; hostId: string | null;
  /** Payloads' OS for the host (inferred or overridden); null asks here. */
  os: Os | null;
  /** Payloads' LHOST (session value over Settings); "" leaves {LHOST} unfilled. */
  lhost: string;
  /** Focus the field for a token this generator has no input for (LHOST). */
  focusToken: (token: string) => void;
  /** Start in the File field (off while you move through the Workbench's generator list). */
  autoFocus?: boolean;
}) {
  const qc = useQueryClient();
  const version = useLibraryVersion();
  // The host is the screen's own (the browse bar's HostChip); there is no second host control here.
  const hostId = viewHostId;
  const { d, host, makeInput, examReady } = useFillBase(engagementId, hostId);
  const [osPick, setOsPick] = useState<Os>("windows");
  const os: Os = contextOs ?? osPick;
  const [dirs, setDirs] = useState<Record<Os, string>>(() => ({ windows: readDir("windows"), linux: readDir("linux") }));
  const dir = dirs[os];
  const [file, setFile] = useState("");
  const [port, setPort] = useState("9000");
  const [methodId, setMethodId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [startFocused] = useState(autoFocus);
  useEffect(() => {
    if (startFocused) fileRef.current?.focus();
  }, [startFocused]);

  // getLibrary()/getCards() change only with the library version.
  /* eslint-disable react-hooks/exhaustive-deps */
  const methods = useMemo(() => {
    const kind = d.engagement?.kind;
    const cardId = TRANSFER_CARD[os];
    // Fail closed: no methods until the engagement's exam rules are known.
    if (!examReady) return [];
    let pool = getLibrary().filter((c) => c.cardId === cardId);
    if (kind) pool = filterForKind(pool, kind, { hostId: host?.id ?? "", msfHostId: d.engagement?.msfHostId ?? null }).shown;
    // HTTP first, so arrow keys follow the order the pills are drawn in.
    const all = transferMethods(getCards(), pool, os).filter((m) => m.kali.length + m.target.length > 0);
    return [...all.filter((m) => isHttp(m.group)), ...all.filter((m) => !isHttp(m.group))];
  }, [os, d.engagement, examReady, host, version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  const effectiveDir = dir.trim() || DEFAULT_DIR[os];
  const overrides: Record<string, string> = { DEST_DIR: effectiveDir, PORT: port, LHOST: lhost.trim() };
  if (file.trim()) {
    overrides.FILE = file.trim();
    overrides.SCRIPT = file.trim().replace(/\.ps1$/i, "");
  }
  const input = makeInput(overrides);
  const usesPort = !!method && [...method.kali, ...method.target].some((c) => c.template.includes("{PORT}"));
  const fill = (cmds: NonNullable<typeof method>["kali"]) => cmds.map((c) => fillLibraryCommand(c, input, false));

  // The target half as typed at the shell: one block, so the cleanup list sees every line.
  const targetFills = method ? method.target.map((c) => fillCommand(c.template, input, { commandOs: c.os })) : [];
  const targetText = targetFills.map((f) => f.text).join("\n");
  const targetCmd = method && {
    id: `transfer:${method.id}`, title: method.label, text: targetText, unresolved: [...new Set(targetFills.flatMap((f) => f.unresolved))], msfMarker: false,
  };
  const focusToken = useCallback((t: string) => (t === "FILE" || t === "SCRIPT" ? fileRef.current?.focus() : focusOuter(t)), [focusOuter]);
  const focusNothing = useCallback(() => {}, []);
  const guard = useCopyGuard({ focusToken, focusCred: focusNothing, hostName: host ? shortHostName(host.name) : null, repeatKey: "⌘↵ or Copy" });
  const logTarget = async () => {
    setStatus(undefined);
    if (!targetCmd || !host || !d.engagement || !targetText) return;
    try {
      if ((await guard.attempt(targetCmd, () => copyPlain(targetText))) !== "copied") return;
      await logCommand(qc, {
        engagementId, host, hosts: d.hosts, command: targetText,
        title: `Transfer ${file.trim() || "a file"} with ${method.label}`,
        ranOn: host.name,
      });
      setStatus("Copied and logged");
    } catch (e) {
      reportError(e);
      setStatus(RavenError.from(e).message);
    }
  };
  useKeydown((e) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.isComposing || isDialogOpen() || e.defaultPrevented) return;
    e.preventDefault();
    void logTarget();
  });

  /** ←/→ move between tabs (wrapping), Home/End jump; the tab list is one Tab stop. */
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const last = methods.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    setMethodId(methods[next]!.id);
    tabRefs.current[next]?.focus();
  };

  const hostName = host?.name || "the target";
  const shortName = host ? shortHostName(host.name) : null;
  // The serve command runs from the tool folders set in Settings.
  const toolsDirs = { windows: d.settings?.windowsToolsDir, linux: d.settings?.linuxToolsDir };
  const kali = method ? fill(method.kali.map((c) => ({ ...c, template: withToolsDirs(c.template, toolsDirs) }))) : [];
  const target = method ? fill(method.target) : [];

  return (
    <section aria-label="Transfer a file" className="grid gap-4">
      <h2 className="m-0 text-heading text-fg">Transfer a file</h2>
      <div className={cx("grid items-start gap-x-4 gap-y-3", FIELD_COLS[2 + Number(!contextOs) + Number(usesPort)])}>
        <label className="grid gap-2 text-meta text-muted-2">
          <span>File</span>
          <FilePicker ref={fileRef} name="FILE" os={os} className="max-w-full" value={file} onChange={setFile} />
        </label>
        {!contextOs && (
          <div className="grid gap-2 text-meta text-muted-2">
            <span>OS</span>
            <Select
              aria-label="Target OS" value={osPick} onValueChange={(v) => setOsPick(v as Os)} className="w-32"
              options={[{ value: "windows", label: "Windows" }, { value: "linux", label: "Linux" }]}
            />
          </div>
        )}
        <label className="grid gap-2 text-meta text-muted-2">
          <span>Folder</span>
          <Input
            mono
            aria-label="Folder"
            width="w-48"
            className="max-w-full"
            placeholder={DEFAULT_DIR[os]}
            value={dir}
            onChange={(e) => {
              setDirs((x) => ({ ...x, [os]: e.target.value }));
              saveDir(os, e.target.value);
            }}
          />
        </label>
        {usesPort && (
          <label className="grid gap-2 text-meta text-muted-2">
            <span>Port</span>
            <Input mono aria-label="Port" width="w-20" value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
        )}
      </div>

      <div className="grid gap-2">
        {METHOD_GROUPS.map(({ label, test }) => {
          const group = methods.map((m, i) => ({ m, i })).filter(({ m }) => test(m.group));
          if (group.length === 0) return null;
          return (
            <div key={label} className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-x-2">
              <span className={labelClass}>{label}</span>
              <ChipSet role="tablist" aria-label={`${label} methods`}>
                {group.map(({ m, i }) => (
                  <button
                    key={m.id}
                    ref={(el) => {
                      tabRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={m.id === method?.id}
                    tabIndex={m.id === method?.id ? 0 : -1}
                    onKeyDown={(e) => onTabKey(e, i)}
                    onClick={() => setMethodId(m.id)}
                    className={cx(
                      "cursor-default rounded-sm px-2 py-1 text-body whitespace-nowrap",
                      m.id === method?.id ? "bg-accent/10 text-accent" : "text-fg-2 hover:bg-surface-hi",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </ChipSet>
            </div>
          );
        })}
      </div>
      {methods.length === 0 && <p className="m-0 text-meta text-muted">No transfer methods are allowed here.</p>}

      {method && (
        <div className="grid gap-4">
          {kali.length > 0 && (
            <div className="grid gap-2">
              <h3 className="m-0 text-body text-fg-2">1. On Kali</h3>
              <CommandList commands={kali} hostName={shortName} focusToken={focusToken} />
            </div>
          )}
          {target.length > 0 && (
            <div className="grid gap-2">
              <h3 title={hostName} className="m-0 truncate text-body text-fg-2">{kali.length > 0 ? "2" : "1"}. On {hostName}</h3>
              <CommandList commands={target} hostName={shortName} focusToken={focusToken} guard={guard} {...(targetCmd ? { guardAs: targetCmd } : {})} />
              <p className="m-0 text-meta text-muted">
                <Kbd>⌘↵</Kbd> copies the {host ? hostName : "target"} half and logs it{host ? "" : " (pick a host)"}.
              </p>
            </div>
          )}
          {target.length === 0 && <p className="m-0 text-meta text-muted">Kali only: nothing to run on {hostName}.</p>}
        </div>
      )}
      {status && <p role="status" className="m-0 text-meta text-muted">{status}</p>}
    </section>
  );
}

