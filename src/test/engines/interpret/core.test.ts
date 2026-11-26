import { afterEach, describe, expect, it } from 'vitest'
import { PARSERS, interpret } from '../../../engines/interpret'
import { hasRedOnYellow, normalize } from '../../../engines/interpret/text'
import { EMPTY, type FoundAttempt, type FoundCredential, type Parser } from '../../../engines/interpret/types'

const cred = (secret: string, source: string): FoundCredential => ({
  username: 'zoe', domain: 'corp.lan', type: 'password', secret, hashType: null,
  scope: 'domain', host: null, source,
})
const attempt = (result: FoundAttempt['result']): FoundAttempt => ({
  username: 'zoe', domain: 'corp.lan', secret: 'Pw1', secretKind: 'password',
  host: { ip: '10.10.10.5' }, service: 'smb', result, authMode: 'domain',
})
const stub = (id: string, credentials: FoundCredential[]): Parser => ({
  id, detect: () => true, parse: () => ({ ...EMPTY, credentials }),
})

const saved = [...PARSERS]
afterEach(() => { PARSERS.splice(0, PARSERS.length, ...saved) })

describe('interpret core', () => {
  it('normalize strips ANSI and CRLF', () => {
    expect(normalize('\x1b[1;31;103mx\x1b[0m\r\ny')).toBe('x\ny')
  })

  it('hasRedOnYellow spots red on yellow', () => {
    expect(hasRedOnYellow('\x1b[1;31;103mx\x1b[0m')).toBe(true)
    expect(hasRedOnYellow('\x1b[1;32mx\x1b[0m')).toBe(false)
  })

  it('interpret with no matching parser returns EMPTY with parsers []', () => {
    expect(interpret({ command: 'ls', output: 'hi' })).toEqual(EMPTY)
  })

  it('parsers see normalized output', () => {
    let seen = ''
    PARSERS.push({ id: 'p', detect: (i) => { seen = i.output; return false }, parse: () => EMPTY })
    interpret({ command: '', output: '\x1b[0ma\r\nb' })
    expect(seen).toBe('a\nb')
  })

  it('interpret dedupes credentials on username+domain+secret', () => {
    PARSERS.push(stub('a', [cred('Pw1', 'a'), cred('Pw2', 'a')]), stub('b', [cred('Pw1', 'b')]))
    const r = interpret({ command: '', output: 'x' })
    expect(r.parsers).toEqual(['a', 'b'])
    expect(r.credentials.map((c) => [c.secret, c.source])).toEqual([['Pw1', 'a'], ['Pw2', 'a']])
  })

  it('john-style cracks with empty hash are not collapsed', () => {
    const crack = (username: string, plaintext: string) => ({ hash: '', plaintext, username })
    PARSERS.push({
      id: 'j', detect: () => true,
      parse: () => ({ ...EMPTY, cracks: [crack('zoe', 'a'), crack('omar', 'a'), crack('ZOE', 'a'), crack('zoe', 'b')] }),
    })
    const r = interpret({ command: '', output: 'x' })
    expect(r.cracks.map((c) => [c.username, c.plaintext])).toEqual([['zoe', 'a'], ['omar', 'a'], ['zoe', 'b']])
  })

  it('interpret never shares EMPTY\'s arrays, and EMPTY\'s arrays are frozen', () => {
    expect(Object.isFrozen(EMPTY.credentials)).toBe(true)
    expect(Object.isFrozen(EMPTY.parsers)).toBe(true)
    const none = interpret({ command: 'ls', output: 'hi' })
    for (const k of ['parsers', 'credentials', 'attempts', 'cracks', 'usernames', 'vectors', 'ticks'] as const) {
      expect(none[k]).not.toBe(EMPTY[k])
    }
    none.credentials.push(cred('x', 'x')) // must not throw or leak into EMPTY
    expect(EMPTY.credentials).toEqual([])
    PARSERS.push({ id: 'e', detect: () => true, parse: () => EMPTY })
    const hit = interpret({ command: '', output: 'x' })
    expect(hit.credentials).not.toBe(EMPTY.credentials)
    hit.attempts.push(attempt('failed'))
    expect(EMPTY.attempts).toEqual([])
  })

  it('attempt dedupe keeps the strongest result (admin > valid > errored > failed)', () => {
    const rs: FoundAttempt['result'][] = ['failed', 'errored', 'valid', 'admin']
    const parse = (order: FoundAttempt['result'][]) => {
      PARSERS.splice(0, PARSERS.length, ...order.map((r, n) => ({
        id: `p${n}`, detect: () => true, parse: () => ({ ...EMPTY, attempts: [attempt(r)] }),
      })))
      return interpret({ command: '', output: 'x' }).attempts
    }
    expect(parse(rs).map((a) => a.result)).toEqual(['admin'])
    expect(parse([...rs].reverse()).map((a) => a.result)).toEqual(['admin'])
    expect(parse(['failed', 'errored']).map((a) => a.result)).toEqual(['errored'])
    expect(parse(['errored', 'valid', 'failed']).map((a) => a.result)).toEqual(['valid'])
    // different services stay separate
    PARSERS.splice(0, PARSERS.length,
      { id: 'a', detect: () => true, parse: () => ({ ...EMPTY, attempts: [attempt('failed'), { ...attempt('admin'), service: 'winrm' }] }) })
    expect(interpret({ command: '', output: 'x' }).attempts.map((a) => [a.service, a.result])).toEqual([['smb', 'failed'], ['winrm', 'admin']])
  })
})
