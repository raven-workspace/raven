import { describe, expect, it } from 'vitest';
import { applyOverlay, mergeImport, normalizeSnapshot, type FieldManualSnapshot } from '../../../engines/fieldManual/merge';
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
      [card([block(), block({ title: 'B', template: 'x' }), block({ title: 'Brand new', template: 'msfconsole -q -x "use exploit/unix/ftp/vsftpd_234_backdoor"', index: 2 })])],
    );
    const n = commands.find((c) => c.id === 'fm-c1-v2')!;
    expect(n.goals.sort()).toEqual(['g1', 'g2']);
    expect(n.exam).toBe('metasploit');
    expect(n.source).toBe('field-manual');
    expect(n.cardId).toBe('c1');
    expect(report.commandsAdded).toBe(1);
    expect(report.classified).toEqual([{ id: 'fm-c1-v2', exam: 'metasploit' }]);
  });

  it('a new block keeps its Sub-method group as a tag', () => {
    const { commands } = mergeImport([bi('fm-c1-1')], [card([block(), block({ title: 'New', template: 'x', index: 1, group: 'SMB share on Kali' })])]);
    expect(commands.find((c) => c.id === 'fm-c1-v1')!.tags).toEqual(['group:SMB share on Kali']);
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
  });

  it('a matched built-in keeps its own exam rule; classification never changes it', () => {
    const up = mergeImport([bi('fm-c1-2', { exam: 'metasploit' })], [card([block({ template: 'sqlmap -u {URL}' })])]);
    expect(up.commands[0].exam).toBe('metasploit');
    expect(up.overlay['fm-c1-2'].exam).toBeUndefined();
    expect(up.report.classified).toEqual([]);
    const none = mergeImport([bi('fm-c1-2')], [card([block({ template: 'msfvenom -p windows/x64/meterpreter_reverse_tcp -f exe' })])]);
    expect(none.commands[0].exam).toBeUndefined();
    expect(none.report.classified).toEqual([]);
  });

  it('an overlay exam rule from an older snapshot is ignored', () => {
    const builtins = [bi('fm-c1-2')];
    const applied = applyOverlay(builtins, { overlay: { 'fm-c1-2': { title: 'T', template: 't', exam: 'metasploit' } }, added: [] });
    expect(applied[0].exam).toBeUndefined();
  });

  it('a staged shell handler built-in stays unrestricted after import', () => {
    const tpl = 'msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/shell/reverse_tcp; set LHOST {LHOST}; set LPORT {LPORT}; set ExitOnSession false; run -j"';
    const { commands, report } = mergeImport(
      [bi('fm-shell-listeners-10', { template: tpl, title: 'multi/handler' })],
      [card([block({ title: 'multi/handler', template: tpl })])],
    );
    expect(commands[0].exam).toBeUndefined();
    expect(report.classified).toEqual([]);
  });

  it('raven-source commands are untouched', () => {
    const raven = bi('raven-1', { source: 'raven', cardId: 'c1', title: 'Old title' });
    const { commands } = mergeImport([raven, bi('fm-c1-2')], [card([block({ why: 'w2' })])]);
    expect(commands.find((c) => c.id === 'raven-1')).toEqual(raven);
  });

  it('counts a card new to the app as added', () => {
    const r = mergeImport([], [card([block()], 'zz')]);
    expect(r.report.cardsAdded).toBe(1);
  });

  it('is idempotent against its own previous result', () => {
    const builtins = [bi('fm-c1-2')];
    const parsed = [card([block({ why: 'w2' }), block({ title: 'N', template: 'n', index: 1 })])];
    const first = mergeImport(builtins, parsed);
    const snap: FieldManualSnapshot = {
      importedAt: 1, cards: parsed.map((p) => p.meta), overlay: first.overlay, added: first.added,
      playbook: [], toolkit: [], report: first.report,
    };
    const second = mergeImport(builtins, parsed, snap);
    expect(second.commands).toEqual(first.commands);
    expect(second.report.commandsAdded).toBe(0);
    expect(second.report.commandsChanged).toBe(0);
  });

  it('stale built-in copies in a previous snapshot lose to the current built-ins, except the vault overlay', () => {
    const current = [
      bi('fm-c1-2', { goals: ['new-goal'], exam: 'banned', match: { bins: ['nmap', 'x'] }, tool: 'nmap2' }),
      bi('rv-1', { source: 'raven', goals: ['rg'], exam: 'banned', cardId: undefined }),
    ];
    const stale = [
      bi('fm-c1-2', { title: 'Vault title', goals: ['old'], exam: undefined, match: { bins: ['old'] }, tool: 'old' }),
      bi('rv-1', { source: 'raven', goals: ['stale'], exam: undefined, cardId: undefined }),
    ];
    const prev = { importedAt: 1, cards: [], commands: stale, playbook: [], toolkit: [], report: {} as never };
    const parsed = [card([block({ title: 'Vault title' })])];
    const out = mergeImport(current, parsed, prev);
    const fm = out.commands.find((c) => c.id === 'fm-c1-2')!;
    expect(fm).toMatchObject({ title: 'Vault title', goals: ['new-goal'], exam: 'banned', tool: 'nmap2', match: { bins: ['nmap', 'x'] } });
    expect(out.commands.find((c) => c.id === 'rv-1')).toEqual(current[1]);
    const applied = applyOverlay(current, normalizeSnapshot(prev, current));
    expect(applied.find((c) => c.id === 'fm-c1-2')).toMatchObject({ title: 'Vault title', goals: ['new-goal'], exam: 'banned' });
    expect(applied.find((c) => c.id === 'rv-1')).toEqual(current[1]);
  });

  it('reads an old full-list snapshot: field-manual title/why/template and -v commands only', () => {
    const builtins = [bi('fm-c1-2'), bi('rv-1', { source: 'raven', cardId: undefined })];
    const added = bi('fm-c1-v3', { title: 'Added', source: 'field-manual' });
    const n = normalizeSnapshot({ commands: [bi('fm-c1-2', { title: 'T', why: 'W', template: 'tt', goals: ['stale'] }), bi('rv-1', { source: 'raven', title: 'stale' }), added] }, builtins);
    expect(n.overlay).toEqual({ 'fm-c1-2': { title: 'T', why: 'W', template: 'tt' } });
    expect(n.added).toEqual([added]);
  });

  it('card-level exam: prohibited bans every new block', () => {
    const c = { ...card([block({ title: 'A', template: 'x', index: 0 }), block({ title: 'B', template: 'y', index: 1 })], 'cz'), exam: 'prohibited' };
    const { commands } = mergeImport([], [c]);
    expect(commands.map((x) => x.exam)).toEqual(['banned', 'banned']);
  });

  it('a card missing from the vault keeps its commands and lists them; vault-added ones are listed separately', () => {
    const builtins = [bi('fm-c1-2')];
    const gone = bi('fm-c1-v5', { title: 'Added' });
    const prev: FieldManualSnapshot = { importedAt: 1, cards: [], overlay: {}, added: [gone], playbook: [], toolkit: [], report: {} as never };
    const { commands, report } = mergeImport(builtins, [card([block()], 'other')], prev);
    expect(commands.map((c) => c.id)).toEqual(expect.arrayContaining(['fm-c1-2', 'fm-c1-v5']));
    expect(report.commandsRemovedKept).toEqual(['fm-c1-2']);
    expect(report.addedRemoved).toEqual(['fm-c1-v5']);
  });
});
