import { describe, it, expect } from 'vitest';
import { scanCommandLines } from '../../../engines/checklist';

const BODY = `Nmap scan report for 10.10.10.5
Host is up (0.050s latency).
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.9p1
80/tcp open  http    Apache httpd 2.4.52
# Nmap done at Mon Nov  2 10:05:00 2026 -- 1 IP address (1 host up) scanned in 30.00 seconds`;
const header = (cmd: string) => `# Nmap 7.94 scan initiated Mon Nov  2 10:00:00 2026 as: ${cmd}\n${BODY}`;
const NO_COMMAND = BODY.split('\n').slice(0, 5).join('\n');

describe('scanCommandLines', () => {
  it('reads the nmap as: header', () => {
    expect(scanCommandLines(header('nmap -p- -T4 -oN full.nmap 10.10.10.5'))).toEqual(['nmap -p- -T4 -oN full.nmap 10.10.10.5']);
  });

  it('output with no command yields nothing', () => {
    expect(scanCommandLines(NO_COMMAND)).toEqual([]);
  });

  it('reads a pasted prompt line and the XML args attribute', () => {
    expect(scanCommandLines(`kali@kali:~$ nmap -p- 10.10.10.5\n${NO_COMMAND}`)).toEqual(['nmap -p- 10.10.10.5']);
    expect(scanCommandLines(`└─$ sudo nmap -p- 10.10.10.5\n${NO_COMMAND}`)).toEqual(['sudo nmap -p- 10.10.10.5']);
    expect(scanCommandLines(`# nmap -p- 10.10.10.5\n${NO_COMMAND}`)).toEqual(['nmap -p- 10.10.10.5']);
    expect(scanCommandLines(`nmap -p- 10.10.10.5\n${NO_COMMAND}`)).toEqual(['nmap -p- 10.10.10.5']);
    const xml = '<?xml version="1.0"?>\n<nmaprun scanner="nmap" args="nmap -p- -oX full.xml 10.10.10.5" start="1">\n</nmaprun>';
    expect(scanCommandLines(xml)).toEqual(['nmap -p- -oX full.xml 10.10.10.5']);
  });
});
