import { describe, expect, it } from 'vitest';
import { mergeImport } from '../../../engines/fieldManual/merge';
import type { ParsedBlock, ParsedCard } from '../../../engines/fieldManual/parseCard';
import type { LibraryCommand } from '../../../engines/library/types';

const bi = (id: string, over: Partial<LibraryCommand> = {}): LibraryCommand => ({
  id, title: 'Old title', tool: 'nmap', template: 'nmap -sV {TARGET_IP}', os: 'any', runFrom: 'attacker',
  goals: ['g1'], why: 'old why', source: 'field-manual', cardId: 'c1',
  match: { bins: ['nmap'] }, matchExamples: { hit: ['nmap -sV 1.1.1.1'], miss: ['ls'] }, ...over,
});
const block = (over: Partial<ParsedBlock> = {}): ParsedBlock => ({
  title: 'Old title', why: 'old why', template: 'nmap -sV {TARGET_IP}', runFrom: 'attacker', index: 0, ...over,
});
const card = (blocks: ParsedBlock[], id = 'c1'): ParsedCard => ({
  meta: { id, title: 'C', stage: 's', category: 'c', os: 'any', file: `02-Cards/${id}.md` }, blocks,
});

describe('mergeImport', () => {
  it('a renamed block matches on template and keeps its id, matcher and goals', () => {
    const { commands, report } = mergeImport(
      [bi('fm-c1-2')],
      [card([block({ title: 'New title', template: 'nmap   -sV\n{TARGET_IP}' })])],
    );
    const c = commands.find((x) => x.id === 'fm-c1-2')!;
    expect(c.title).toBe('New title');
    expect(c.match).toEqual({ bins: ['nmap'] });
    expect(c.goals).toEqual(['g1']);
    expect(c.matchExamples).toBeDefined();
    expect(report.commandsChanged).toBe(1);
    expect(report.commandsAdded).toBe(0);
    expect(commands).toHaveLength(1);
  });

  it('a reworded block matches on title and is changed', () => {
    const { commands, report } = mergeImport(
      [bi('fm-c1-2')],
      [card([block({ why: 'new why', template: 'nmap -sC {TARGET_IP}' })])],
    );
    expect(commands[0]).toMatchObject({ id: 'fm-c1-2', why: 'new why', template: 'nmap -sC {TARGET_IP}', goals: ['g1'] });
    expect(report.commandsChanged).toBe(1);
  });

  it('an identical block is not counted as changed', () => {
    const { report } = mergeImport([bi('fm-c1-2')], [card([block()])]);
    expect(report.commandsChanged).toBe(0);
    expect(report.commandsAdded).toBe(0);
  });

  it('a new block gets fm-<card>-v<n>, the card goals and a classified exam rule', () => {
    const { commands, report } = mergeImport(
      [bi('fm-c1-2'), bi('fm-c1-3', { title: 'B', template: 'x', goals: ['g2', 'g1'] })],
      [card([block(), block({ title: 'B', template: 'x' }), block({ title: 'Brand new', template: 'msfconsole -q', index: 2 })])],
    );
    const n = commands.find((c) => c.id === 'fm-c1-v2')!;
    expect(n.goals.sort()).toEqual(['g1', 'g2']);
    expect(n.exam).toBe('metasploit');
    expect(n.source).toBe('field-manual');
    expect(n.cardId).toBe('c1');
    expect(report.commandsAdded).toBe(1);
    expect(report.classified).toEqual([{ id: 'fm-c1-v2', exam: 'metasploit' }]);
  });

  it('a block deleted in the vault keeps the built-in and is listed as removed-kept', () => {
    const { commands, report } = mergeImport([bi('fm-c1-2'), bi('fm-c1-3', { title: 'Gone', template: 'gone' })], [card([block()])]);
    expect(commands.map((c) => c.id)).toContain('fm-c1-3');
    expect(report.commandsRemovedKept).toEqual(['fm-c1-3']);
  });

  it('an existing exam rule is never weakened', () => {
    const { commands } = mergeImport(
      [bi('fm-c1-2', { exam: 'banned' })],
      [card([block({ template: 'nmap -sC {TARGET_IP}' })])],
    );
    expect(commands[0].exam).toBe('banned');
    const up = mergeImport([bi('fm-c1-2', { exam: 'metasploit' })], [card([block({ template: 'sqlmap -u {URL}' })])]);
    expect(up.commands[0].exam).toBe('banned');
  });

  it('raven-source commands are untouched', () => {
    const raven = bi('raven-1', { source: 'raven', cardId: 'c1', title: 'Old title' });
    const { commands } = mergeImport([raven, bi('fm-c1-2')], [card([block({ why: 'w2' })])]);
    expect(commands.find((c) => c.id === 'raven-1')).toEqual(raven);
  });

  it('counts card changes and keeps cards missing from the vault out of the removed-kept command list', () => {
    const prev = mergeImport([], [card([block()], 'zz')]);
    expect(prev.report.cardsAdded).toBe(1);
  });

  it('is idempotent against its own previous result', () => {
    const builtins = [bi('fm-c1-2')];
    const parsed = [card([block({ why: 'w2' }), block({ title: 'N', template: 'n', index: 1 })])];
    const first = mergeImport(builtins, parsed);
    const second = mergeImport(builtins, parsed, {
      importedAt: 1, cards: parsed.map((p) => p.meta), commands: first.commands, playbook: [], toolkit: [], report: first.report,
    });
    expect(second.commands).toEqual(first.commands);
    expect(second.report.commandsAdded).toBe(0);
    expect(second.report.commandsChanged).toBe(0);
  });
});
