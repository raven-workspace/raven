import { ArrowDown, ArrowUp, TextAa, XIcon } from "@phosphor-icons/react";
import { defineSearchQuery, defineSearchStatusHandler, type SearchStatus } from "prosekit/extensions/search";
import { useEditor, useExtension } from "prosekit/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Input, Toolbar } from "../../../ui";
import type { EditingExtension } from "./extension";

/**
 * Find and replace on the page (ProseKit's search): matches highlight on the paper as you type and the first one at or
 * after the cursor is selected. ↵ and ⇧↵ step through them, Esc closes and puts the cursor on the match.
 * In Replace, ↵ replaces the current match and moves on; ⌘↵ replaces them all.
 */
export function FindBar({ focusKey, onClose }: { focusKey: number; onClose(): void }) {
  const editor = useEditor<EditingExtension>();
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [status, setStatus] = useState<SearchStatus>({ total: 0, active: 0 });
  const findRef = useRef<HTMLInputElement>(null);

  useExtension(useMemo(() => defineSearchQuery(), []));
  useExtension(useMemo(() => defineSearchStatusHandler(setStatus), []));

  // ⌘F again while open goes back to the field and selects what's in it.
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusKey]);

  const query = (next: { search?: string; replace?: string; caseSensitive?: boolean }) => {
    const q = { search, replace, caseSensitive, ...next };
    editor.commands.setSearchQuery(q);
  };
  const close = () => {
    editor.commands.setSearchQuery({ search: "" });
    onClose();
    editor.focus();
  };
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) editor.commands.findPrev();
      else editor.commands.findNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey) editor.commands.replaceAll();
      else editor.commands.replaceNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const none = search !== "" && status.total === 0;

  return (
    <div role="search" aria-label="Find on this page" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-line py-1">
      <div className="grid grid-cols-[minmax(0,240px)_auto_minmax(0,240px)_auto] items-center gap-2">
        <Input
          ref={findRef}
          aria-label="Find"
          placeholder="Find"
          className="h-7"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            query({ search: e.target.value });
          }}
          onKeyDown={onFindKey}
        />
        <Toolbar gap={2}>
          <span aria-live="polite" className={none ? "min-w-16 text-meta text-warn tabular-nums" : "min-w-16 text-meta text-muted-2 tabular-nums"}>
            {search === "" ? "" : status.total === 0 ? "No matches" : `${status.active || "–"} of ${status.total}`}
          </span>
          <IconButton icon={ArrowUp} label="Previous match" shortcut="⇧↵" disabled={status.total === 0} onClick={() => editor.commands.findPrev()} />
          <IconButton icon={ArrowDown} label="Next match" shortcut="↵" disabled={status.total === 0} onClick={() => editor.commands.findNext()} />
          <IconButton
            icon={TextAa}
            label="Match case"
            active={caseSensitive}
            onClick={() => {
              setCaseSensitive(!caseSensitive);
              query({ caseSensitive: !caseSensitive });
            }}
          />
        </Toolbar>
        <Input
          aria-label="Replace with"
          placeholder="Replace with"
          className="h-7"
          value={replace}
          onChange={(e) => {
            setReplace(e.target.value);
            query({ replace: e.target.value });
          }}
          onKeyDown={onReplaceKey}
        />
        <Toolbar gap={2}>
          <Button size="sm" disabled={status.total === 0} onClick={() => editor.commands.replaceNext()}>
            Replace
          </Button>
          <Button size="sm" disabled={status.total === 0} onClick={() => editor.commands.replaceAll()}>
            Replace all
          </Button>
        </Toolbar>
      </div>
      <IconButton icon={XIcon} label="Close" shortcut="Esc" onClick={close} />
    </div>
  );
}
