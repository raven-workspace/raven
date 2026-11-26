import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import { FIELD_MANUAL_CARDS } from '../../../engines/library/data/fieldManual';
import { currentLibrary, setImported, useLibrary, useToolkit } from '../../../engines/library/store';
import { libraryCommand as cmd } from '../../support/library';

afterEach(() => setImported({ commands: [], cards: [] }));

describe('library store', () => {
  it('the Toolkit is empty before an import and follows setImported, with the version', () => {
    const { result } = renderHook(() => useToolkit());
    expect(result.current.toolkit).toEqual([]);
    const t = { os: 'windows' as const, purpose: 'p', file: 'f.exe', note: '', where: '', staged: true };
    act(() => setImported({ commands: [], cards: [], toolkit: [t] }));
    expect(result.current.toolkit).toEqual([t]);
    expect(result.current.version).toBe(currentLibrary().version);
    act(() => setImported({ commands: [], cards: [] }));
    expect(result.current.toolkit).toEqual([]);
  });

  it('holds the built-ins before any import', () => {
    expect(currentLibrary().commands).toEqual(BUILTIN_LIBRARY);
    expect(currentLibrary().cards).toEqual(FIELD_MANUAL_CARDS);
  });

  it('setImported layers imported commands and hands out a new library with a new version', () => {
    const { result } = renderHook(() => useLibrary());
    const before = result.current;
    act(() => setImported({ commands: [{ ...cmd(BUILTIN_LIBRARY[0].id, { title: 'replaced' }) }, cmd('new-one')], cards: [] }));
    expect(result.current).not.toBe(before);
    expect(result.current.version).toBeGreaterThan(before.version);
    const lib = result.current.commands;
    expect(lib).toHaveLength(BUILTIN_LIBRARY.length + 1);
    expect(lib[0].title).toBe('replaced');
    expect(lib.at(-1)!.id).toBe('new-one');
  });

  it('is idempotent when the same list is applied twice', () => {
    const list = [cmd(BUILTIN_LIBRARY[1].id, { title: 'r' }), cmd('n1')];
    setImported({ commands: list, cards: [] });
    const once = currentLibrary().commands;
    setImported({ commands: list, cards: [] });
    expect(currentLibrary().commands).toEqual(once);
  });

  it('setImported with an empty layer restores exactly the built-ins', () => {
    setImported({ commands: [cmd('new-one')], cards: [] });
    setImported({ commands: [], cards: [] });
    expect(currentLibrary().commands).toEqual(BUILTIN_LIBRARY);
  });

  it('every built-in cardId has CardMeta', () => {
    const have = new Set(currentLibrary().cards.map((c) => c.id));
    const missing = BUILTIN_LIBRARY.flatMap((c) => (c.cardId && !have.has(c.cardId) ? [c.cardId] : []));
    expect(missing).toEqual([]);
  });
});
