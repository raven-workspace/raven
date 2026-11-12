import { ArrowDown, ArrowUp, TextAa, XIcon } from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import { defineSearchQuery } from "prosekit/extensions/search";
import { TextSelection } from "prosekit/pm/state";
import { useEditor, useExtension } from "prosekit/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Input, Toolbar } from "../../../ui";
import type { EditingExtension } from "./extension";

/** A match on the page: in the owner's text (editable, replaceable), or in a block drawn from the log (read-only). */
export type Hit = { kind: "text"; from: number; to: number; at: number } | { kind: "log"; range: Range; at: number };

/** Text inside a log block that is the page's chrome, not its content: never searched. */
const CHROME = "button, input, select, textarea, [data-trim], [role=toolbar]";

/**
 * Every match of `search` on the page, in page order: the owner's text from the document, and the text the log and
 * generated blocks show (their live content, which the document doesn't hold).
 */
export function findHits(editor: Editor, search: string, caseSensitive: boolean): Hit[] {
  if (search === "" || !editor.mounted) return [];
  const fold = (t: string) => (caseSensitive ? t : t.toLowerCase());
  const needle = fold(search);
  const hits: Hit[] = [];
  const view = editor.view;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      // One character per inline leaf (a hard break), so offsets are positions.
      const text = fold(node.textBetween(0, node.content.size, undefined, "￼"));
      for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length))
        hits.push({ kind: "text", from: pos + 1 + i, to: pos + 1 + i + needle.length, at: pos + 1 + i });
      return false;
    }
    if (!node.isAtom) return true;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;
    const walker = dom.ownerDocument.createTreeWalker(dom, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.parentElement?.closest(CHROME) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let k = 0;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = fold(t.textContent ?? "");
      for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
        const range = dom.ownerDocument.createRange();
        range.setStart(t, i);
        range.setEnd(t, i + needle.length);
        // Inside the block, in reading order: after its position, before the next one.
        hits.push({ kind: "log", range, at: pos + 0.5 + k++ / 1e6 });
      }
    }
    return false;
  });
  return hits.sort((a, b) => a.at - b.at);
}

/** CSS custom highlights for matches in log blocks (WebKit, Chromium); a no-op where the API is missing (jsdom). */
function paintLogHits(all: Range[], active: Range | null) {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const Make = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !Make) return;
  registry.set("report-find", new Make(...all));
  if (active) registry.set("report-find-active", new Make(active));
  else registry.delete("report-find-active");
}

/**
 * Find and replace on the page (ProseKit's search for the owner's text, plus the text log and generated blocks show):
 * every match is highlighted and counted; ↵ and ⇧↵ step through them in page order, scrolling to each. Matches in log
 * blocks are read-only: Replace changes the owner's text only, and says so. Esc closes and puts the cursor back.
 * In Replace, ↵ replaces the current match and moves on; ⌘↵ replaces them all.
 */
export function FindBar({ focusKey, onClose }: { focusKey: number; onClose(): void }) {
  const editor = useEditor<EditingExtension>({ update: true });
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [index, setIndex] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);

  useExtension(useMemo(() => defineSearchQuery(), []));

  // ⌘F again while open goes back to the field and selects what's in it.
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusKey]);

  const doc = editor.mounted ? editor.state.doc : null;
  // The page and its log blocks as drawn: collected on the next frame, once their node views have rendered.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = findHits(editor, search, caseSensitive);
      setHits(next);
      setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, doc, search, caseSensitive]);

  const current = hits[index] ?? null;
  useEffect(() => {
    paintLogHits(
      hits.flatMap((h) => (h.kind === "log" ? [h.range] : [])),
      current?.kind === "log" ? current.range : null,
    );
  }, [hits, current]);
  useEffect(() => () => paintLogHits([], null), []);

  /** Shows a match: the owner's text is selected (the search marks it current); a log block's match scrolls into view. */
  const show = (hit: Hit) => {
    const view = editor.view;
    if (hit.kind === "text") {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to)).scrollIntoView());
    } else {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from)));
      (hit.range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView?.({ block: "center" });
    }
  };
  const step = (dir: 1 | -1) => {
    if (hits.length === 0) return;
    const next = (index + dir + hits.length) % hits.length;
    setIndex(next);
    show(hits[next]);
  };
  const query = (next: { search?: string; replace?: string; caseSensitive?: boolean }) => {
    const q = { search, replace, caseSensitive, ...next };
    editor.commands.setSearchQuery(q);
    // The first match at or after the cursor, as the search selects it.
    const found = findHits(editor, q.search, q.caseSensitive);
    const from = editor.state.selection.from;
    const first = Math.max(0, found.findIndex((h) => h.at >= from));
    setHits(found);
    setIndex(first);
    if (found[first]?.kind === "log") show(found[first]);
  };
  const close = () => {
    editor.commands.setSearchQuery({ search: "" });
    paintLogHits([], null);
    onClose();
    editor.focus();
  };
  const replaceOne = () => {
    if (current?.kind === "text") editor.commands.replaceCurrent();
    else editor.commands.replaceNext();
  };
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
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
      else replaceOne();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const editable = hits.filter((h) => h.kind === "text").length;
  const inLog = hits.length - editable;
  const none = search !== "" && hits.length === 0;

  return (
    <div role="search" aria-label="Find on this page" className="grid gap-1 border-t border-line py-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
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
              {search === "" ? "" : hits.length === 0 ? "No matches" : `${index + 1} of ${hits.length}`}
            </span>
            <IconButton icon={ArrowUp} label="Previous match" shortcut="⇧↵" disabled={hits.length === 0} onClick={() => step(-1)} />
            <IconButton icon={ArrowDown} label="Next match" shortcut="↵" disabled={hits.length === 0} onClick={() => step(1)} />
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
            <Button size="sm" disabled={editable === 0} onClick={replaceOne}>
              Replace
            </Button>
            <Button size="sm" disabled={editable === 0} onClick={() => editor.commands.replaceAll()}>
              Replace all
            </Button>
          </Toolbar>
        </div>
        <IconButton icon={XIcon} label="Close" shortcut="Esc" onClick={close} />
      </div>
      {inLog > 0 && (
        <p className="m-0 text-meta text-muted-2">
          {current?.kind === "log" ? "This match is in a block from the log: read-only. " : ""}
          {`Replace changes your own text only; ${inLog} ${inLog === 1 ? "match" : "matches"} in log blocks stay as logged.`}
        </p>
      )}
    </div>
  );
}
