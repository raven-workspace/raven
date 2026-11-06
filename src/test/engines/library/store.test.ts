import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import { getCards, getLibrary, setImported, useLibraryVersion } from '../../../engines/library/store';
import type { LibraryCommand } from '../../../engines/library/types';
import { renderHook } from '@testing-library/react';

const cmd = (id: string, title = 't'): LibraryCommand => ({
  id, title, tool: 'x', template: 'x', os: 'any', runFrom: 'attacker', goals: [], source: 'operator',
});

afterEach(() => setImported({ commands: [], cards: [] }));

describe('library store', () => {
  it('getLibrary returns the built-ins before any import', () => {
    expect(getLibrary()).toEqual(BUILTIN_LIBRARY);
  });

  it('setImported layers imported commands and bumps the version', () => {
    const { result, rerender } = renderHook(() => useLibraryVersion());
    const before = result.current;
    setImported({ commands: [{ ...cmd(BUILTIN_LIBRARY[0].id, 'replaced') }, cmd('new-one')], cards: [] });
    rerender();
    expect(result.current).toBeGreaterThan(before);
    const lib = getLibrary();
    expect(lib).toHaveLength(BUILTIN_LIBRARY.length + 1);
    expect(lib[0].title).toBe('replaced');
    expect(lib.at(-1)!.id).toBe('new-one');
  });

  it('is idempotent when the same list is applied twice', () => {
    const list = [cmd(BUILTIN_LIBRARY[1].id, 'r'), cmd('n1')];
    setImported({ commands: list, cards: [] });
    const once = getLibrary();
    setImported({ commands: list, cards: [] });
    expect(getLibrary()).toEqual(once);
  });

  it('setImported with an empty layer restores exactly the built-ins', () => {
    setImported({ commands: [cmd('new-one')], cards: [] });
    setImported({ commands: [], cards: [] });
    expect(getLibrary()).toEqual(BUILTIN_LIBRARY);
  });

  it('every built-in cardId has CardMeta', () => {
    const have = new Set(getCards().map((c) => c.id));
    const missing = BUILTIN_LIBRARY.flatMap((c) => (c.cardId && !have.has(c.cardId) ? [c.cardId] : []));
    expect(missing).toEqual([]);
  });
});
