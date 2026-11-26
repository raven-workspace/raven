import { describe, it, expect } from 'vitest';
import { buildDraft } from '../../../engines/capture';
import { TEST_LIBRARY } from '../../support/library';

const base = { image: null, hosts: [], scope: [], domain: '', machines: ['Kali (VM)'], lastRanOn: null, library: TEST_LIBRARY };
const EW = '*Evil-WinRM* PS C:\\Users\\carol\\Documents> ';

describe('log titles carry the command, not the prompt', () => {
  it('Evil-WinRM prompt is stripped from a multi-line paste', () => {
    const d = buildDraft({ ...base, text: `${EW}whoami /priv\nPRIVILEGES INFORMATION` });
    expect(d.title).not.toMatch(/Evil-WinRM|PS C:/);
  });
  it('Evil-WinRM prompt is stripped from a single-line paste', () => {
    const d = buildDraft({ ...base, text: `${EW}whoami /priv` });
    expect(d.title).not.toMatch(/Evil-WinRM|PS C:/);
  });
  it('Evil-WinRM prompt with a path containing spaces and a bare line', () => {
    const d = buildDraft({ ...base, text: `*Evil-WinRM* PS C:\\Program Files\\App> dir` });
    expect(d.title).not.toMatch(/Evil-WinRM|PS C:/);
  });
});

describe('kind and exact title', () => {
  it('is a command titled by the command line', () => {
    const d = buildDraft({ ...base, text: `${EW}.\\seatbelt.exe -group=all\nout` });
    expect(d.kind).toBe('command');
    expect(d.title).toBe('.\\seatbelt.exe -group=all');
  });
});
