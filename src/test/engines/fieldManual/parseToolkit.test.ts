import { describe, expect, it } from 'vitest';
import { parseToolkit } from '../../../engines/fieldManual/parseToolkit';

const TK = `---
type: meta
---
# Toolkit

## Windows targets

| Purpose | File to transfer | Where to get it |
|---|---|---|
| **Privesc enumeration** | \`winPEASx64_ofs.exe\` (obfuscated) + \`winPEASany_ofs.exe\` (fallback) | PEASS-ng releases. Not in the Kali package. |
| | \`PowerUp.ps1\` | \`/usr/share/powersploit/Privesc/\` |
| **SeImpersonate** | \`PrintSpoofer64.exe\` / \`PrintSpoofer32.exe\` ✅ | itm4n releases |
| | \`SigmaPotato.exe\` | tylerdotrar releases |

## Linux targets

| Purpose | File to transfer | Where to get it |
|---|---|---|
| **Process snooping** | \`pspy64\` / \`pspy32\` ✅ | DominicBreuker releases |
| **Shells** | \`nc\` | apt |

Some trailing prose.
`;

describe('parseToolkit', () => {
  const entries = parseToolkit(TK);

  it('parseToolkit emits one entry per backticked file in a cell', () => {
    expect(entries.filter((e) => e.os === 'windows').map((e) => e.file)).toEqual([
      'winPEASx64_ofs.exe', 'winPEASany_ofs.exe', 'PowerUp.ps1', 'PrintSpoofer64.exe', 'PrintSpoofer32.exe', 'SigmaPotato.exe',
    ]);
  });

  it('parseToolkit lets a blank Purpose inherit from the row above', () => {
    expect(entries.find((e) => e.file === 'PowerUp.ps1')!.purpose).toBe('Privesc enumeration');
    expect(entries.find((e) => e.file === 'SigmaPotato.exe')!.purpose).toBe('SeImpersonate');
    expect(entries[0].purpose).toBe('Privesc enumeration');
  });

  it('parseToolkit applies a check mark to every file in its cell', () => {
    const staged = entries.filter((e) => e.staged).map((e) => e.file);
    expect(staged).toEqual(['PrintSpoofer64.exe', 'PrintSpoofer32.exe', 'pspy64', 'pspy32']);
  });

  it('parseToolkit assigns the OS from the section heading', () => {
    expect(entries.filter((e) => e.os === 'linux').map((e) => e.file)).toEqual(['pspy64', 'pspy32', 'nc']);
  });

  it('parseToolkit keeps the where-to-get-it text and puts the cell remainder in note', () => {
    const e = entries[0];
    expect(e.where).toBe('PEASS-ng releases. Not in the Kali package.');
    expect(e.note).toContain('fallback');
  });
});
