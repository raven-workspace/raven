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

  it('classifyExam ignores note prose', () => {
    expect(classifyExam('x', 'allowed', 'Banned in the exam.')).toBeUndefined();
    expect(classifyExam('wpscan --url http://{TARGET_IP}', undefined, 'wpscan is not on the prohibited list')).toBeUndefined();
  });

  it('classifyExam bans prohibited automatic tools by command word', () => {
    expect(classifyExam('sqlmap -u http://{TARGET_IP}/?id=1')).toBe('banned');
    expect(classifyExam('sudo sqlmap -u x')).toBe('banned');
    expect(classifyExam('nessuscli update')).toBe('banned');
    expect(classifyExam('cd /tmp && python3 sqlmap.py -u x')).toBe('banned');
  });

  it('classifyExam bans responder without analyse mode and allows -A', () => {
    expect(classifyExam('responder -I tun0')).toBe('banned');
    expect(classifyExam('sudo responder -I tun0 -A')).toBeUndefined();
    expect(classifyExam('responder -I tun0 --analyze')).toBeUndefined();
  });

  it('classifyExam does not ban wpscan or a sqlmap mention in a comment', () => {
    expect(classifyExam('wpscan --url http://{TARGET_IP}')).toBeUndefined();
    expect(classifyExam("# don't use sqlmap\nsqlmap_notes=1\nls")).toBeUndefined();
  });

  it('classifyExam lets banned win over metasploit', () => {
    expect(classifyExam('msfconsole', 'prohibited')).toBe('banned');
  });
});
