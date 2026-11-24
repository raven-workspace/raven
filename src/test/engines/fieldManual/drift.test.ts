import { describe, expect, it } from 'vitest';
import { computeDrift } from '../../../engines/fieldManual/drift';
import { parseNote } from '../../../engines/manual';
import type { ParsedCard } from '../../../engines/fieldManual/parseCard';
import type { PlaybookItem } from '../../../engines/fieldManual/parsePlaybook';
import type { ChecklistGoal } from '../../../engines/checklist/types';
import type { LibraryCommand } from '../../../engines/library/types';

const F = '04 - Privilege Escalation.md';
const item = (text: string, file = `01-Playbook/${F}`): PlaybookItem => ({ file, text });
const goal = (id: string, ...playbook: { file: string; text: string }[]): ChecklistGoal => ({
  id, stage: 's', title: id, ...(playbook.length ? { playbook } : {}),
});
const cmd = (id: string, template: string, source: LibraryCommand['source'] = 'field-manual'): LibraryCommand => ({
  id, title: id, tool: 'x', template, os: 'any', runFrom: 'attacker', goals: [], source,
});
const card = (templates: string[]): ParsedCard => ({
  meta: { id: 'c', title: 'C', stage: 's', category: 'c', os: 'any', file: '02-Cards/c.md' },
  blocks: templates.map((template, index) => ({ title: `b${index}`, template, runFrom: 'attacker' as const, index })),
});

describe('computeDrift', () => {
  it('an unmapped playbook item is noStep', () => {
    const d = computeDrift([goal('g1', { file: F, text: 'Capabilities' })], [item('Capabilities'), item('Kernel exploits')], [], [], []);
    expect(d.noStep.map((i) => i.text)).toEqual(['Kernel exploits']);
  });

  it('a goal can claim several items', () => {
    const d = computeDrift(
      [goal('g1', { file: F, text: 'A' }, { file: F, text: 'B' }, { file: F, text: 'Old B' })],
      [item('A'), item('B'), item('C')],
      [], [], [],
    );
    expect(d.noStep.map((i) => i.text)).toEqual(['C']);
    expect(d.reworded).toEqual([{ goalId: 'g1', text: 'Old B' }]);
    expect(d.ravenOnlySteps).toEqual([]);
  });

  it('matching also needs the file, not only the text', () => {
    const d = computeDrift([goal('g1', { file: '05 - Post-Exploitation.md', text: 'Capabilities' })], [item('Capabilities')], [], [], []);
    expect(d.noStep).toHaveLength(1);
  });

  it('a goal whose text left its file is reworded', () => {
    const d = computeDrift(
      [goal('g1', { file: F, text: 'Capabilities' }), goal('g2', { file: F, text: 'Gone item' })],
      [item('Capabilities'), item('Gone item', '01-Playbook/05 - Post-Exploitation.md')],
      [], [], [],
    );
    expect(d.reworded).toEqual([{ goalId: 'g2', text: 'Gone item' }]);
  });

  it('goals without playbook are ravenOnlySteps', () => {
    const d = computeDrift([goal('g1'), goal('g2', { file: F, text: 'x' })], [item('x')], [], [], []);
    expect(d.ravenOnlySteps).toEqual(['g1']);
  });

  it('manual tokens are labelled manual', () => {
    const d = computeDrift(
      [],
      [],
      [
        cmd('a', 'cp {FILE} {OUTPUT} {WHATEVER} {LHOST} {KALI_USER}'),
        cmd('b', 'x {FILE} {WHATEVER} {WHATEVER} ${HOME} %{http_code}'),
      ],
      [],
      [],
    );
    expect(d.unfillable).toEqual([
      { token: 'FILE', count: 2, manual: true, from: { arsenal: 2, notes: 0 } },
      { token: 'WHATEVER', count: 2, manual: false, from: { arsenal: 2, notes: 0 } },
      { token: 'OUTPUT', count: 1, manual: true, from: { arsenal: 1, notes: 0 } },
    ]);
  });

  it('FILL_ tokens are manual', () => {
    const d = computeDrift([], [], [cmd('a', 'plink -pw {FILL_KALI_PASS} {FILL_ANYTHING}')], [], []);
    expect(d.unfillable).toEqual([
      { token: 'FILL_ANYTHING', count: 1, manual: true, from: { arsenal: 1, notes: 0 } },
      { token: 'FILL_KALI_PASS', count: 1, manual: true, from: { arsenal: 1, notes: 0 } },
    ]);
  });

  it('a raven-source command is a ravenOnlyCommand', () => {
    const d = computeDrift(
      [], [],
      [cmd('r1', 'raven only', 'raven'), cmd('r2', 'in  a\ncard', 'raven'), cmd('f1', 'nope', 'field-manual')],
      [card(['in a card'])],
      [],
    );
    expect(d.ravenOnlyCommands).toEqual(['r1']);
  });

  it('toolkit files no card mentions are toolkitUnused', () => {
    const toolkit = [
      { os: 'windows' as const, purpose: 'p', file: 'a.exe', note: '', where: '', staged: true },
      { os: 'windows' as const, purpose: 'p', file: 'b.exe', note: '', where: '', staged: true },
    ];
    const d = computeDrift([], [], [], [card(['iwr http://x/a.exe -o a.exe'])], toolkit);
    expect(d.toolkitUnused).toEqual(['b.exe']);
  });

  it('toolkit names match whole words, not substrings', () => {
    const toolkit = ['GodPotato-NET4.exe', 'GodPotato-NET40.exe'].map((file) => ({
      os: 'windows' as const, purpose: 'p', file, note: '', where: '', staged: true,
    }));
    const d = computeDrift([], [], [], [card(['iwr http://x/GodPotato-NET40.exe -o gp.exe'])], toolkit);
    expect(d.toolkitUnused).toEqual(['GodPotato-NET4.exe']);
  });

  it('only the 00-06 playbooks count for noStep and reworded', () => {
    const d = computeDrift(
      [goal('g1', { file: '99 - Im Stuck.md', text: 'Gone' }, { file: 'New Credential Routine.md', text: 'Gone too' })],
      [item('Try harder', '01-Playbook/99 - Im Stuck.md'), item('Spray it', '01-Playbook/New Credential Routine.md'), item('Kernel exploits')],
      [], [], [],
    );
    expect(d.noStep.map((i) => i.text)).toEqual(['Kernel exploits']);
    expect(d.reworded).toEqual([]);
  });

  it('unfillable lists only UPPER_SNAKE tokens', () => {
    const d = computeDrift([], [], [cmd('a', 'x {11111111-2222-4333-8444-555555555555} {name} {pos} {MY_TOKEN} {SUBNET_2}')], [], []);
    expect(d.unfillable.map((u) => u.token)).toEqual(['MY_TOKEN', 'SUBNET_2']);
  });

  it('Manual note commands count too, with where each token was seen; output fences do not (RAV-21)', () => {
    const note = parseNote('03-Tools/Zz Drift.md', [
      '# Zz Drift',
      '```bash',
      'zzscan -t {TARGET_IP} --key {NEWTOKEN}',
      '```',
      '```text',
      'banner says {OUTTOKEN}',
      '```',
      '**Table 1 — Zz codes**',
      '| Code | Means | Do this |',
      '| - | - | - |',
      '| `ZZ_ONE` | Broke. | `zzfix {NEWTOKEN} {ROWTOKEN}` |',
    ].join('\n'))!;
    const d = computeDrift([], [], [cmd('a', 'zzarsenal {NEWTOKEN}')], [], [], [note]);
    expect(d.unfillable).toEqual([
      { token: 'NEWTOKEN', count: 3, manual: false, from: { arsenal: 1, notes: 2 } },
      { token: 'ROWTOKEN', count: 1, manual: false, from: { arsenal: 0, notes: 1 } },
    ]);
  });
});
