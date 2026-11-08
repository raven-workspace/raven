import { describe, expect, it } from 'vitest'
import { interpret } from '../../../engines/interpret'
import { capVectors, sudoVectors, suidVectors } from '../../../engines/interpret/privescLinux'
import suidFind from '../../fixtures/interpret/suid-find.txt?raw'
import sudoL from '../../fixtures/interpret/sudo-l.txt?raw'
import getcap from '../../fixtures/interpret/getcap.txt?raw'
import pspy from '../../fixtures/interpret/pspy.txt?raw'

const ranOn = { ranOn: true as const }
const SUID_CMD = 'find / -type f -perm -u=s 2>/dev/null'
const titles = (vs: { title: string }[]) => vs.map((v) => v.title)

describe('SUID', () => {
  it('standard SUID binaries file nothing', () => {
    const std = ['/usr/bin/passwd', '/usr/bin/su', '/usr/bin/sudo', '/usr/bin/mount', '/usr/bin/pkexec',
      '/usr/lib/openssh/ssh-keysign', '/usr/lib/dbus-1.0/dbus-daemon-launch-helper'].join('\n')
    const r = interpret({ command: SUID_CMD, output: std })
    expect(r.parsers).toEqual(['suid'])
    expect(r.vectors).toEqual([])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-lin-suid', parser: 'suid' }])
  })

  it("find with SUID gives 'SUID /usr/bin/find (GTFOBins)'", () => {
    const r = interpret({ command: SUID_CMD, output: suidFind })
    expect(r.vectors).toEqual([{ host: ranOn, title: 'SUID /usr/bin/find (GTFOBins)' }])
    expect(suidVectors(suidFind)).toEqual(['SUID /usr/bin/find (GTFOBins)'])
  })

  it('a SUID binary without a GTFOBins entry files nothing', () => {
    const r = interpret({ command: SUID_CMD, output: '/usr/lib/xorg/Xorg.wrap\n/opt/acme/helper\n' })
    expect(r.vectors).toEqual([])
    expect(r.ticks).toHaveLength(1)
  })
})

describe('sudo -l', () => {
  it('lists only GTFOBins binaries and skips rules pinned to arguments', () => {
    const r = interpret({ command: 'sudo -l', output: sudoL })
    expect(r.parsers).toEqual(['sudo'])
    expect(titles(r.vectors)).toEqual(['sudo /usr/sbin/tcpdump as ALL (GTFOBins)', 'sudo /usr/bin/gcc as ALL (GTFOBins)'])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-lin-sudo', parser: 'sudo' }])
  })

  it('sudo NOPASSWD vim gives the GTFOBins vector', () => {
    const out = sudoL.replace(/ {4}\(ALL\) .*/, '    (root) NOPASSWD: /usr/bin/vim')
    expect(sudoVectors(out)).toEqual(['sudo /usr/bin/vim as root (GTFOBins)'])
  })

  it('(ALL : ALL) ALL gives full root', () => {
    const rule = (r: string) => `User jay may run the following commands on web01:\n    ${r}\n`
    expect(sudoVectors(rule('(ALL : ALL) ALL'))).toEqual(['sudo: full root (ALL : ALL)'])
    expect(sudoVectors(rule('(ALL) ALL'))).toEqual(['sudo: full root (ALL : ALL)'])
    expect(sudoVectors(rule('(ALL : ALL) NOPASSWD: ALL'))).toEqual(['sudo: full root (ALL : ALL) NOPASSWD'])
  })

  it('a * argument wildcard leaves room to abuse; fixed arguments do not', () => {
    const rule = (r: string) => `User jay may run the following commands on web01:\n    ${r}\n`
    expect(sudoVectors(rule('(root) NOPASSWD: /usr/bin/apt-get *'))).toEqual(['sudo /usr/bin/apt-get as root (GTFOBins)'])
    expect(sudoVectors(rule('(root) NOPASSWD: /usr/bin/find *'))).toEqual(['sudo /usr/bin/find as root (GTFOBins)'])
    expect(sudoVectors(rule('(root) /usr/bin/crontab -l'))).toEqual([])
  })

  it('(root) ALL is full root, with NOPASSWD when present', () => {
    const rule = (r: string) => `User jay may run the following commands on web01:\n    ${r}\n`
    expect(sudoVectors(rule('(root) ALL'))).toEqual(['sudo: full root (root)'])
    expect(sudoVectors(rule('(root) NOPASSWD: ALL'))).toEqual(['sudo: full root (root) NOPASSWD'])
  })

  it('a NOEXEC rule files nothing', () => {
    const rule = 'User jay may run the following commands on web01:\n    (root) NOEXEC: /usr/bin/vim\n'
    expect(sudoVectors(rule)).toEqual([])
  })

  it('env_keep+=LD_PRELOAD is a vector', () => {
    const out = 'Matching Defaults entries for jay on web01:\n    env_reset, env_keep+=LD_PRELOAD\nUser jay may run the following commands on web01:\n    (root) /bin/ls\n'
    expect(sudoVectors(out)).toEqual(['sudo LD_PRELOAD kept'])
  })
})

describe('getcap', () => {
  it('cap_setuid on python3 gives the capability vector', () => {
    const out = '/usr/bin/python3.8 = cap_setuid+ep\n/usr/bin/ping = cap_net_raw+ep\n'
    expect(capVectors(out)).toEqual(['Capability cap_setuid on /usr/bin/python3.8 (GTFOBins)'])
    expect(capVectors('/usr/bin/python3 cap_setuid=ep')).toEqual(['Capability cap_setuid on /usr/bin/python3 (GTFOBins)'])
  })

  it('files perl from the fixture and ignores harmless capabilities', () => {
    const r = interpret({ command: '/usr/sbin/getcap -r / 2>/dev/null', output: getcap })
    expect(titles(r.vectors)).toEqual([
      'Capability cap_setuid on /usr/bin/perl (GTFOBins)',
      'Capability cap_setuid on /usr/bin/perl5.28.1 (GTFOBins)',
    ])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-lin-caps', parser: 'caps' }])
  })
})

describe('cron', () => {
  const script = '/home/jay/.scripts/nightly_backup.sh'

  it('a root cron job without proof of writability files nothing', () => {
    const r = interpret({ command: './pspy64', output: pspy })
    expect(r.parsers).toEqual(['cron'])
    expect(r.vectors).toEqual([])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-lin-cron', parser: 'cron' }])
  })

  it('with a world-writable ls -l line it files the vector', () => {
    const out = `${pspy}\n-rwxrwxrw- 1 root root 50 Jan  1  2026 ${script}\n`
    const r = interpret({ command: './pspy64', output: out })
    expect(r.vectors).toEqual([{ host: ranOn, title: `Writable root cron script ${script}` }])
  })

  it('a script only the owner can write files nothing', () => {
    const out = `${pspy}\n-rwxr-xr-x 1 root root 50 Jan  1  2026 ${script}\n`
    expect(interpret({ command: './pspy64', output: out }).vectors).toEqual([])
  })

  it('a symlink never proves writability', () => {
    const out = `${pspy}\nlrwxrwxrwx 1 root root 50 Jan  1  2026 ${script}\n`
    expect(interpret({ command: './pspy64', output: out }).vectors).toEqual([])
  })

  it('syslog CRON lines name root jobs too', () => {
    const out = `Jan  1 00:00:01 web01 CRON[1330]: (root) CMD (/bin/bash ${script})\n-rwxrwxrw- 1 root root 50 Jan  1 00:00 ${script}\n`
    expect(titles(interpret({ command: 'grep CRON /var/log/syslog', output: out }).vectors)).toEqual([`Writable root cron script ${script}`])
  })
})
