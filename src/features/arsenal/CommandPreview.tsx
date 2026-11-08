import { useEffect, useRef, useState } from "react";
import type { FillInput } from "../../engines/checklist";
import { getToolkit } from "../../engines/library/store";
import type { LibraryCommand } from "../../engines/library/types";
import type { Host } from "../../types/host";
import { Chip } from "../../ui";
import type { FilledCommand } from "../checklist/CommandList";
import { COMMAND_PRE, MarkedText } from "../checklist/commandPre";
import { fillLibraryCommand } from "../checklist/goalCommands";
import type { SuggestContext } from "../palette/suggest";
import { FillBar } from "./FillBar";
import { autoFill, tokensOf } from "./fillTokens";

export interface FilledPreview {
  cmd: FilledCommand;
  input: FillInput;
  tokens: string[];
  /** What each field fills with before anything is typed (a staged Toolkit file counts). */
  auto: ReturnType<typeof autoFill>;
}

/** One library command filled for the host in view: `prefill` seeds fields, `overrides` (what the user typed) win. */
export function fillPreview(
  command: LibraryCommand, msfMarker: boolean, makeInput: (o: Record<string, string>) => FillInput,
  overrides: Record<string, string>, prefill: Record<string, string> = {},
): FilledPreview {
  const input = makeInput({ ...prefill, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k.toUpperCase(), v])) });
  const tokens = tokensOf([command.template]);
  return { cmd: fillLibraryCommand(command, input, msfMarker), input, tokens, auto: autoFill(tokens, makeInput(prefill)) };
}

/** The best staged Toolkit file whose name contains a query word: it pre-fills {FILE}. */
export function toolPrefill(query: string, os: Host["os"]): Record<string, string> {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return {};
  const hits = getToolkit()
    .filter((t) => t.staged && words.some((w) => t.file.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.os === os) - Number(a.os === os));
  return hits[0] ? { FILE: hits[0].file } : {};
}

const FLASH_MS = 600;

/**
 * The filled command under a result list, with its fill fields (⌘K and the drawer). `hostKey` is the host it is filled
 * for: when it changes, the block flashes once (`data-flash`).
 */
export function CommandPreview({ filled, hasCred, hostKey, suggest, os, overrides, onOverrides, fieldRef }: {
  filled: FilledPreview; hasCred: boolean; hostKey: string | null; suggest: SuggestContext; os: "linux" | "windows" | null;
  overrides: Record<string, string>; onOverrides: (next: Record<string, string>) => void;
  fieldRef: (token: string, el: HTMLInputElement | null) => void;
}) {
  const [flash, setFlash] = useState(false);
  const seen = useRef(hostKey);
  useEffect(() => {
    if (seen.current === hostKey) return;
    seen.current = hostKey;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [hostKey]);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <pre className={`${COMMAND_PRE} max-h-48 overflow-y-auto`} tabIndex={0} role="group" aria-label={`Command: ${filled.cmd.title}`} {...(flash ? { "data-flash": "" } : {})}><MarkedText text={filled.cmd.text} tokens={filled.cmd.tokens ?? []} /></pre>
      {filled.cmd.msfMarker && <Chip>uses your one Metasploit host</Chip>}
      <FillBar tokens={filled.tokens} hasCred={hasCred} auto={filled.auto} suggest={suggest} os={os} overrides={overrides} onOverrides={onOverrides} fieldRef={fieldRef} />
    </div>
  );
}
