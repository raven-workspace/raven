import { describe, expect, it } from 'vitest'
import { interpret } from '../../../engines/interpret'
import { resolveInterpretation } from '../../../engines/interpret/resolve'
import { EMPTY, type Interpretation } from '../../../engines/interpret/types'
import type { Host } from '../../../types/host'

const host = (id: string, ip: string) => ({ id, ip }) as Host
const hosts = [host('h1', '10.10.1.10')]
const line = (ip: string, mark: string, tail: string) =>
  `SMB         ${ip}   445    DC01             [${mark}] corp.lan\\jay:Passw0rd1 ${tail}`.trimEnd()
const cmd = 'nxc smb 10.10.1.0/24 -u jay -p Passw0rd1'

describe('nxc results', () => {
  it('maps admin, local and hash semantics', () => {
    const i = interpret({ command: 'nxc smb 10.10.1.10 -u jay -H 31d6cfe0d16ae931b73c59d7e0c089c0 --local-auth',
      output: line('10.10.1.10', '+', '(Pwn3d!)').replace('Passw0rd1', '31d6cfe0d16ae931b73c59d7e0c089c0') })
    expect(i.parsers).toEqual(['nxc-results'])
    expect(i.attempts).toEqual([{ username: 'jay', domain: null, secret: '31d6cfe0d16ae931b73c59d7e0c089c0',
      secretKind: 'hash', host: { ip: '10.10.1.10' }, service: 'smb', result: 'admin', authMode: 'local' }])
    expect(i.ticks).toEqual([{ host: { ip: '10.10.1.10' }, goalId: 'h-vuln-spray', parser: 'nxc-results' }])
  })
})

describe('resolveInterpretation', () => {
  it('a valid login on an unknown IP yields newIps', () => {
    const r = resolveInterpretation(
      interpret({ command: cmd, output: line('10.10.1.10', '+', '') + '\n' + line('10.10.1.20', '+', '(Pwn3d!)') }),
      { entryHostIds: [], hosts })
    expect(r.newIps).toEqual(['10.10.1.20'])
    expect(r.attempts.map((a) => ('newIp' in a ? a.newIp : a.hostId))).toEqual(['h1', '10.10.1.20'])
    expect(r.ticks.map((t) => ('newIp' in t ? t.newIp : t.hostId))).toEqual(['h1', '10.10.1.20'])
    expect(r.droppedUnknown).toBe(0)
  })

  it('failed-only lines on an unknown IP yield no host and count droppedUnknown', () => {
    const r = resolveInterpretation(
      interpret({ command: cmd, output: line('10.10.1.30', '-', 'STATUS_LOGON_FAILURE') + '\n' + line('10.10.1.31', '-', 'STATUS_LOGON_FAILURE') }),
      { entryHostIds: [], hosts })
    expect(r.newIps).toEqual([])
    expect(r.attempts).toEqual([])
    expect(r.ticks).toEqual([])
    expect(r.droppedUnknown).toBe(2)
  })

  it('ranOn with no tagged host drops the item; with one it resolves to it', () => {
    const i: Interpretation = {
      ...EMPTY,
      parsers: ['x'],
      vectors: [{ host: { ranOn: true }, title: 'SUID find' }],
      ticks: [{ host: { ranOn: true }, goalId: 'g', parser: 'x' }, { host: 'engagement', goalId: 'e', parser: 'x' }],
    }
    const none = resolveInterpretation(i, { entryHostIds: [], hosts })
    expect(none.vectors).toEqual([])
    expect(none.ticks).toEqual([{ goalId: 'e', parser: 'x', hostId: null }])
    const tagged = resolveInterpretation(i, { entryHostIds: ['h1', 'h2'], hosts })
    expect(tagged.vectors).toEqual([{ title: 'SUID find', hostId: 'h1' }])
    expect(tagged.ticks).toHaveLength(2)
  })

  it('credentials and usernames on unknown IPs prove the host; null host is engagement-level', () => {
    const i: Interpretation = {
      ...EMPTY,
      parsers: ['x'],
      credentials: [{ username: 'jay', domain: null, type: 'password', secret: 's', hashType: null, scope: 'local', host: { ip: '10.10.1.40' }, source: 'x' },
        { username: 'drew', domain: 'corp.lan', type: 'password', secret: 't', hashType: null, scope: 'domain', host: null, source: 'x' }],
      usernames: [{ username: 'amy', domain: null, host: { ip: '10.10.1.40' }, source: 'x' }],
    }
    const r = resolveInterpretation(i, { entryHostIds: [], hosts })
    expect(r.newIps).toEqual(['10.10.1.40'])
    expect(r.credentials.map((c) => ('newIp' in c ? c.newIp : c.hostId))).toEqual(['10.10.1.40', null])
    expect(r.usernames).toHaveLength(1)
  })

  it('failed attempts on an IP another item proved are kept; unproven ones are dropped and counted', () => {
    const out = [
      line('10.10.1.50', '+', ''),
      line('10.10.1.50', '-', 'STATUS_LOGON_FAILURE').replace('Passw0rd1', 'Other1'),
      line('10.10.1.51', '-', 'Connection reset by peer'),
    ].join('\n')
    const r = resolveInterpretation(interpret({ command: cmd + ' Other1', output: out }), { entryHostIds: [], hosts })
    expect(r.newIps).toEqual(['10.10.1.50'])
    expect(r.attempts.map((a) => [('newIp' in a ? a.newIp : a.hostId), a.result])).toEqual([
      ['10.10.1.50', 'valid'], ['10.10.1.50', 'failed'],
    ])
    expect(r.droppedUnknown).toBe(1)
  })

  it('two proving items on one IP list it once', () => {
    const i: Interpretation = {
      ...EMPTY,
      parsers: ['x'],
      vectors: [{ host: { ip: '10.10.1.60' }, title: 'a' }, { host: { ip: '10.10.1.60' }, title: 'b' }],
    }
    expect(resolveInterpretation(i, { entryHostIds: [], hosts }).newIps).toEqual(['10.10.1.60'])
  })
})
