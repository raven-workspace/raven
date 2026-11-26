import { describe, expect, it } from 'vitest'
import { interpret } from '../../../engines/interpret'
import type { FoundUsername } from '../../../engines/interpret/types'
import nxcUsers from '../../fixtures/interpret/nxc-users.txt?raw'
import nxcRid from '../../fixtures/interpret/nxc-rid-brute.txt?raw'
import kerbrute from '../../fixtures/interpret/kerbrute.txt?raw'
import rpc from '../../fixtures/interpret/rpcclient-enumdomusers.txt?raw'
import lookupsid from '../../fixtures/interpret/lookupsid.txt?raw'

const view = (us: FoundUsername[]) => us.map((u) => [u.username, u.domain])
const ip = { ip: '10.10.1.10' }

describe('username lists', () => {
  it('each format yields its usernames with domain', () => {
    const a = interpret({ command: 'nxc smb 10.10.1.10 -u zoe -p x --users', output: nxcUsers })
    expect(a.parsers).toEqual(['usernames', 'nxc-results']) // the [+] login line in the header is a real attempt too
    expect(view(a.usernames)).toEqual([
      ['Administrator', 'corp.lan'], ['Guest', 'corp.lan'], ['krbtgt', 'corp.lan'],
      ['tom', 'corp.lan'], ['amy', 'corp.lan'], ['bob', 'corp.lan'],
    ])
    expect(a.usernames.every((u) => u.source === 'nxc-users' && 'ip' in u.host! && u.host.ip === '10.10.1.10')).toBe(true)
    expect(a.ticks).toEqual([
      { host: ip, goalId: 'h-enum-ad-users', parser: 'usernames' },
      { host: ip, goalId: 'h-vuln-spray', parser: 'nxc-results' },
    ])

    const rid = interpret({ command: 'nxc smb 10.10.1.10 -u zoe -p x --rid-brute', output: nxcRid })
    expect(view(rid.usernames)).toEqual([['Administrator', 'CORP'], ['zoe', 'CORP'], ['tom', 'CORP']])
    expect(rid.usernames[0].host).toEqual(ip)

    const k = interpret({ command: 'kerbrute userenum --dc 10.10.1.10 -d corp.lan users.txt', output: kerbrute })
    expect(view(k.usernames)).toEqual([['zoe', 'corp.lan'], ['tom', 'corp.lan']])
    expect(k.usernames[0].host).toEqual(ip)

    const r = interpret({ command: 'rpcclient -U "" -N 10.10.1.10 -c enumdomusers', output: rpc })
    expect(view(r.usernames)).toEqual([['Administrator', null], ['Guest', null], ['krbtgt', null], ['zoe', null], ['tom', null]])

    const l = interpret({ command: 'impacket-lookupsid corp.lan/zoe:x@10.10.1.10', output: lookupsid })
    expect(view(l.usernames)).toEqual([['Administrator', 'CORP'], ['zoe', 'CORP'], ['tom', 'CORP']])
    expect(l.ticks[0].host).toEqual(ip)
  })

  it('nxc --users rows in domain\\user form and with spaced names keep later rows', () => {
    const row = (n: string, rest: string) => `SMB  10.10.1.10  445  DC01  ${n.padEnd(30)}${rest}`
    const out = [
      row('-Username-', '-Last PW Set-       -BadPW- -Description-'),
      row('corp.lan\\zoe', '2026-01-01 00:00:00 0  '),
      row('Help Desk', '<never>             0  shared'),
      row('amy', '2026-01-01 00:00:00 0  '),
    ].join('\n')
    const r = interpret({ command: 'nxc smb 10.10.1.10 --users', output: out })
    expect(view(r.usernames)).toEqual([['zoe', 'corp.lan'], ['Help Desk', null], ['amy', null]])
  })

  it('RID names with spaces are kept', () => {
    const out = '1106: CORP\\Help Desk (SidTypeUser)\n1107: CORP\\amy (SidTypeUser)\n'
    const r = interpret({ command: 'impacket-lookupsid x@10.10.1.10', output: out })
    expect(view(r.usernames)).toEqual([['Help Desk', 'CORP'], ['amy', 'CORP']])
  })

  it('falls back to the entry host when the command names no IP', () => {
    const r = interpret({ command: 'rpcclient -c enumdomusers target', output: rpc })
    expect(r.usernames[0].host).toEqual({ ranOn: true })
    expect(r.ticks[0].host).toEqual({ ranOn: true })
  })

  it('machine accounts and groups (SidTypeGroup) are skipped', () => {
    const l = interpret({ command: 'impacket-lookupsid x@10.10.1.10', output: lookupsid })
    const names = l.usernames.map((u) => u.username)
    expect(names).not.toContain('MS01$')
    expect(names).not.toContain('Domain Admins')
    const rid = interpret({ command: 'nxc smb 10.10.1.10 --rid-brute', output: nxcRid })
    expect(rid.usernames.map((u) => u.username)).not.toContain('MS01$')
    const rp = interpret({ command: 'rpcclient 10.10.1.10', output: rpc + 'user:[MS01$] rid:[0x451]\n' })
    expect(rp.usernames.map((u) => u.username)).not.toContain('MS01$')
    expect(interpret({ command: 'kerbrute', output: kerbrute }).usernames.map((u) => u.username)).not.toContain('MS01$')
  })

  it('nxc login lines ([+]/[-]) are not usernames output', () => {
    const out = 'SMB  10.10.1.10  445  DC01  [+] corp.lan\\zoe:Synthetic123! (Pwn3d!)\nSMB  10.10.1.10  445  DC01  [-] corp.lan\\tom:wrong STATUS_LOGON_FAILURE\n'
    const r = interpret({ command: 'nxc smb 10.10.1.10 -u zoe -p x', output: out })
    expect(r.parsers).not.toContain('usernames')
    expect(r.usernames).toEqual([])
  })
})
