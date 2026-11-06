import { describe, expect, it } from 'vitest';
import { parsePlaybook } from '../../../engines/fieldManual/parsePlaybook';

const PB = `---
id: pb-x
type: playbook
---
# 04 - Privilege Escalation

## Checklist

### Linux
- [ ] \`sudo -l\` (always)   → [[Sudo-Abuse]]
- [x] Non-standard SUID binaries → [[SUID-SGID-Abuse]] (compare against [[Linux-Is-This-Normal]])
- [ ] Plain item, no link

### Windows
- [ ] Check [[Token-Privileges]] first → [[Potato]], [[Other]]
- not a checkbox
`;

describe('parsePlaybook', () => {
  it('parsePlaybook strips the arrow tail and returns one item per checkbox', () => {
    const items = parsePlaybook('01-Playbook/04 - Privilege Escalation.md', PB);
    expect(items.map((i) => i.text)).toEqual([
      '`sudo -l` (always)',
      'Non-standard SUID binaries',
      'Plain item, no link',
      'Check Token-Privileges first',
    ]);
  });

  it('parsePlaybook records the file and the nearest heading', () => {
    const items = parsePlaybook('f.md', PB);
    expect(items.map((i) => i.heading)).toEqual(['Linux', 'Linux', 'Linux', 'Windows']);
    expect(items[0].file).toBe('f.md');
  });

  it('parsePlaybook unwraps wiki-links that stay in the text', () => {
    expect(parsePlaybook('f.md', '- [ ] See [[A|the A note]] and [[B]]')[0].text).toBe('See the A note and B');
  });

  it('parsePlaybook leaves heading unset before any heading', () => {
    expect(parsePlaybook('f.md', '- [ ] x')[0].heading).toBeUndefined();
  });
});
