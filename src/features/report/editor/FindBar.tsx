import { ArrowDown, ArrowUp, TextAa, XIcon } from "@phosphor-icons/react";
import type { Editor } from "prosekit/core";
import { defineSearchQuery } from "prosekit/extensions/search";
import { TextSelection } from "prosekit/pm/state";
import { useEditor, useExtension } from "prosekit/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Input, Toolbar } from "../../../ui";
import type { EditingExtension } from "./extension";
import "./FindBar.scss";

/** A match in the page's text: its range in the document. */
export type Hit = { from: number; to: number };

/** Every match of `search` in the page's text (code blocks and table cells too), in page order. */
export function findHits(editor: Editor, search: string, caseSensitive: boolean): Hit[] {
  if (search === "" || !editor.mounted) return [];
  const fold = (t: string) => (caseSensitive ? t : t.toLowerCase());
  const needle = fold(search);
  const hits: Hit[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One character per inline leaf (a hard break), so offsets are positions.
    const text = fold(node.textBetween(0, node.content.size, undefined, "￼"));
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) hits.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length });
    return false;
  });
  return hits;
}

/**
 * Find and replace on the page (ProseKit's search): every match is highlighted and counted; ↵ and ⇧↵ step through
 * them in page order, scrolling to each. Matches are collected again when the page changes. Esc closes and puts the
 * cursor back. In Replace, ↵ replaces the current match and moves on; ⌘↵ replaces them all.
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
  // The page's matches, collected on the next frame, once the editor has drawn.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = findHits(editor, search, caseSensitive);
      setHits(next);
      setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, doc, search, caseSensitive]);

  /** Selects a match (the search marks it current) and scrolls to it. */
  const show = (hit: Hit) => {
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to)).scrollIntoView());
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
    setHits(found);
    setIndex(Math.max(0, found.findIndex((h) => h.from >= from)));
  };
  const close = () => {
    editor.commands.setSearchQuery({ search: "" });
    onClose();
    editor.focus();
  };
  const replaceOne = () => {
    if (hits.length > 0) editor.commands.replaceCurrent();
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
  const none = search !== "" && hits.length === 0;

  return (
    <div role="search" aria-label="Find on this page" className="find-bar">
      <div className="find-bar__row">
        <div className="find-bar__fields">
          <Input
            ref={findRef}
            aria-label="Find"
            placeholder="Find"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              query({ search: e.target.value });
            }}
            onKeyDown={onFindKey}
          />
          <Toolbar gap={2}>
            <span aria-live="polite" className={none ? "find-bar__count find-bar__count--none" : "find-bar__count"}>
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
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value);
              query({ replace: e.target.value });
            }}
            onKeyDown={onReplaceKey}
          />
          <Toolbar gap={2}>
            <Button size="sm" disabled={hits.length === 0} onClick={replaceOne}>
              Replace
            </Button>
            <Button size="sm" disabled={hits.length === 0} onClick={() => editor.commands.replaceAll()}>
              Replace all
            </Button>
          </Toolbar>
        </div>
        <IconButton icon={XIcon} label="Close" shortcut="Esc" onClick={close} />
      </div>
    </div>
  );
}
