import { describe, expect, it } from 'vitest'
import { interpret } from '../../../engines/interpret'
import type { FoundCredential } from '../../../engines/interpret/types'
import sam from '../../fixtures/interpret/secretsdump-sam.txt?raw'
import ntds from '../../fixtures/interpret/secretsdump-ntds.txt?raw'
import logon from '../../fixtures/interpret/mimikatz-logonpasswords.txt?raw'
import dcsync from '../../fixtures/interpret/mimikatz-dcsync.txt?raw'
import hashcatShow from '../../fixtures/interpret/hashcat-show.txt?raw'
import johnShow from '../../fixtures/interpret/john-show.txt?raw'
import johnLive from '../../fixtures/interpret/john-live.txt?raw'
import lsassy from '../../fixtures/interpret/lsassy.txt?raw'

const ranOn = { ranOn: true } as const
const view = (cs: FoundCredential[]) =>
  cs.map((c) => [c.username, c.domain, c.type, c.secret, c.scope, c.machine === true])

describe('secretsdump', () => {
  it('SAM gives local NTLM hashes on the target and skips machine accounts and the empty hash', () => {
    const r = interpret({ command: 'impacket-secretsdump -sam sam.save -system system.save -security security.save LOCAL', output: sam })
    expect(r.parsers).toEqual(['secretsdump'])
    const local = r.credentials.filter((c) => c.scope === 'local')
    expect(view(local)).toEqual([
      ['Administrator', null, 'hash', '00020002000200020002000200020002', 'local', false],
      ['WDAGUtilityAccount', null, 'hash', '00030003000300030003000300030003', 'local', false],
      ['drew', null, 'hash', '00040004000400040004000400040004', 'local', false],
      ['support', null, 'hash', '00050005000500050005000500050005', 'local', false],
      ['svc_backup', null, 'hash', '00060006000600060006000600060006', 'local', false],
      ['Admin', null, 'hash', '00070007000700070007000700070007', 'local', false],
    ])
    for (const c of local) {
      expect(c.host).toEqual(ranOn)
      expect(c.hashType).toBe('NTLM')
      expect(c.source).toBe('secretsdump')
    }
    // Guest and DefaultAccount carry the empty NT hash and are never filed.
    expect(r.credentials.some((c) => c.secret === '31d6cfe0d16ae931b73c59d7e0c089c0')).toBe(false)
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-loot-hashes', parser: 'secretsdump' }])
  })

  it('cached DCC2 lines give DCC2 hashes with their domain', () => {
    const r = interpret({ command: '', output: sam })
    const dcc2 = r.credentials.filter((c) => c.hashType === 'DCC2')
    expect(dcc2.map((c) => [c.username, c.domain, c.secret, c.scope, c.host])).toEqual([
      ['jay', 'CORP', '$DCC2$10240#jay#00080008000800080008000800080008', 'domain', null],
      ['Administrator', 'CORP', '$DCC2$10240#Administrator#00090009000900090009000900090009', 'domain', null],
      ['paul', 'CORP', '$DCC2$10240#paul#000a000a000a000a000a000a000a000a', 'domain', null],
    ])
    expect(dcc2.every((c) => c.type === 'hash' && c.machine === false)).toBe(true)
  })

  it('machine accounts are filed with machine: true, including $MACHINE.ACC as the target host\'s account', () => {
    const r = interpret({ command: '', output: sam })
    const acc = r.credentials.filter((c) => c.username === '$MACHINE.ACC')
    // Only the NT hash form; plain_password_hex is skipped.
    expect(acc).toEqual([{
      username: '$MACHINE.ACC', domain: null, type: 'hash', secret: '000c000c000c000c000c000c000c000c',
      hashType: 'NTLM', scope: 'domain', host: ranOn, source: 'secretsdump', machine: true,
    }])
    const n = interpret({ command: '', output: ntds })
    expect(view(n.credentials.filter((c) => c.machine))).toEqual([
      ['DC01$', null, 'hash', '00180018001800180018001800180018', 'domain', true],
      ['MS01$', null, 'hash', '00190019001900190019001900190019', 'domain', true],
      ['MS02$', null, 'hash', '001a001a001a001a001a001a001a001a', 'domain', true],
      ['MS03$', null, 'hash', '001b001b001b001b001b001b001b001b', 'domain', true],
      ['MS04$', null, 'hash', '001c001c001c001c001c001c001c001c', 'domain', true],
      ['MS05$', null, 'hash', '001d001d001d001d001d001d001d001d', 'domain', true],
      ['MS06$', null, 'hash', '001e001e001e001e001e001e001e001e', 'domain', true],
    ])
  })

  it('NTDS gives domain hashes and ticks h-loot-domain', () => {
    const r = interpret({ command: 'impacket-secretsdump -just-dc corp.lan/DC01$@10.10.10.5', output: ntds })
    expect(r.parsers).toEqual(['secretsdump'])
    expect(r.credentials.every((c) => c.scope === 'domain' && c.hashType === 'NTLM' && c.host === null)).toBe(true)
    expect(view(r.credentials.filter((c) => !c.machine))).toEqual([
      ['Administrator', null, 'hash', '00100010001000100010001000100010', 'domain', false],
      ['krbtgt', null, 'hash', '00110011001100110011001100110011', 'domain', false],
      ['drew', null, 'hash', '00120012001200120012001200120012', 'domain', false],
      ['jay', null, 'hash', '00130013001300130013001300130013', 'domain', false],
      ['paul', null, 'hash', '00140014001400140014001400140014', 'domain', false],
      ['amy', null, 'hash', '00150015001500150015001500150015', 'domain', false],
      ['bob', null, 'hash', '00160016001600160016001600160016', 'domain', false],
      ['cal', null, 'hash', '00170017001700170017001700170017', 'domain', false],
      ['dan', null, 'hash', '00170017001700170017001700170017', 'domain', false],
    ])
    expect(r.credentials).toHaveLength(16) // Guest's empty hash and the Kerberos key lines are not filed
    expect(r.ticks).toEqual([
      { host: ranOn, goalId: 'h-loot-hashes', parser: 'secretsdump' },
      { host: ranOn, goalId: 'h-loot-domain', parser: 'secretsdump' },
    ])
  })

  it('a domain\\user prefix sets the domain; LSA cleartext DOMAIN\\user:password lines give passwords', () => {
    const out = [
      '[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)',
      'corp.lan\\jay:1105:aad3b435b51404eeaad3b435b51404ee:00130013001300130013001300130013:::',
      'jen_history0:1105:aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef:::',
      '[*] Dumping LSA Secrets',
      '[*] _SC_MSSQLSERVER',
      'CORP\\svc_sql:Winter2026!',
      'CORP\\MS01$:5f3a91c0deadbeef',
      '(Unknown User):Zx4QwRtYuIoPaS9',
      '[*] Cleaning up...',
    ].join('\n')
    const r = interpret({ command: '', output: out })
    expect(view(r.credentials)).toEqual([
      ['jay', 'corp.lan', 'hash', '00130013001300130013001300130013', 'domain', false],
      ['svc_sql', 'CORP', 'password', 'Winter2026!', 'domain', false],
    ])
    expect(r.credentials[1].hashType).toBeNull()
  })

  it('a CRLF + ANSI copy of the SAM fixture parses identically', () => {
    const noisy = sam.split('\n').map((l) => `\x1b[1;32m${l}\x1b[0m`).join('\r\n')
    expect(interpret({ command: '', output: noisy })).toEqual(interpret({ command: '', output: sam }))
  })
})

describe('mimikatz', () => {
  it('logonpasswords gives NTLM and cleartext, never (null)', () => {
    const r = interpret({ command: 'sekurlsa::logonpasswords', output: logon })
    expect(r.parsers).toEqual(['mimikatz'])
    const people = r.credentials.filter((c) => !c.machine)
    expect(view(people)).toEqual([
      ['jay', 'CORP', 'hash', '00510051005100510051005100510051', 'domain', false],
      ['paul', 'CORP', 'hash', '00560056005600560056005600560056', 'domain', false],
      ['drew', 'CORP', 'hash', '00140014001400140014001400140014', 'domain', false],
      ['drew', 'CORP.LAN', 'password', 'Winter2000!', 'domain', false],
      ['svc_backup', 'MS01', 'hash', '005b005b005b005b005b005b005b005b', 'local', false],
    ])
    expect(people.find((c) => c.username === 'svc_backup')?.host).toEqual(ranOn) // domain == logon server: a local account
    expect(people.find((c) => c.username === 'jay')?.host).toBeNull()
    expect(r.credentials.some((c) => c.secret === '(null)')).toBe(false)
    // machine accounts keep their hash (flagged) but their random machine "passwords" are never filed
    const machines = r.credentials.filter((c) => c.machine)
    expect(machines.length).toBeGreaterThan(0)
    expect(machines.every((c) => c.type === 'hash' && c.username.endsWith('$'))).toBe(true)
    expect(r.credentials.filter((c) => c.type === 'password')).toHaveLength(1)
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-loot-hashes', parser: 'mimikatz' }])
  })

  it('dcsync gives the domain hash', () => {
    const r = interpret({ command: 'lsadump::dcsync /user:corp\\krbtgt', output: dcsync })
    expect(r.parsers).toEqual(['mimikatz'])
    expect(r.credentials.map((c) => [c.username, c.domain, c.type, c.secret, c.hashType, c.scope, c.host, c.machine])).toEqual([
      ['krbtgt', 'corp.lan', 'hash', '005f005f005f005f005f005f005f005f', 'NTLM', 'domain', null, false],
      ['Administrator', 'corp.lan', 'hash', '00120012001200120012001200120012', 'NTLM', 'domain', null, false],
    ])
    expect(r.ticks).toEqual([
      { host: ranOn, goalId: 'h-loot-hashes', parser: 'mimikatz' },
      { host: ranOn, goalId: 'h-loot-domain', parser: 'mimikatz' },
    ])
  })

  // unverified: no real lsadump::sam sample in the vault; written from mimikatz's documented layout.
  it('lsadump::sam gives local hashes and flags machine accounts', () => {
    const out = [
      'mimikatz # lsadump::sam',
      'Domain : MS01',
      'SysKey : 0123456789abcdef0123456789abcdef',
      'Local SID : S-1-5-21-111111111-222222222-333333333',
      '',
      'SAMKey : fedcba9876543210fedcba9876543210',
      '',
      'RID  : 000001f4 (500)',
      'User : Administrator',
      '  Hash NTLM: aaaabbbbccccddddeeeeffff00001111',
      '',
      'RID  : 000001f5 (501)',
      'User : Guest',
      '  Hash NTLM: 31d6cfe0d16ae931b73c59d7e0c089c0',
      '',
      'RID  : 000003e9 (1001)',
      'User : WKS$',
      '  Hash NTLM: 11112222333344445555666677778888',
    ].join('\n')
    const r = interpret({ command: '', output: out })
    expect(r.credentials.map((c) => [c.username, c.domain, c.secret, c.scope, c.host, c.machine])).toEqual([
      ['Administrator', null, 'aaaabbbbccccddddeeeeffff00001111', 'local', ranOn, false],
      ['WKS$', null, '11112222333344445555666677778888', 'local', ranOn, true],
    ])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-loot-hashes', parser: 'mimikatz' }])
  })
})

// unverified: no real sample yet (owner collects in next lab)
describe('lsassy', () => {
  it('NT and PWD lines give hashes and passwords; machine accounts get no password', () => {
    const r = interpret({ command: 'lsassy -u jay -p x 10.10.10.5', output: lsassy })
    expect(r.parsers).toEqual(['lsassy'])
    expect(view(r.credentials)).toEqual([
      ['jay', 'CORP', 'hash', '33333333333333333333333333333333', 'domain', false],
      ['drew', 'CORP', 'password', 'Spring2026x', 'domain', false],
      ['MS01$', 'CORP', 'hash', '44444444444444444444444444444444', 'domain', true],
    ])
    expect(r.ticks).toEqual([{ host: ranOn, goalId: 'h-loot-hashes', parser: 'lsassy' }])
  })
})

describe('cracked', () => {
  it('hashcat --show pairs hash with plaintext', () => {
    const r = interpret({ command: 'hashcat -m 13100 roasted.txt --show', output: hashcatShow })
    expect(r.parsers).toEqual(['cracked'])
    expect(r.cracks).toHaveLength(1)
    expect(r.cracks[0].hash.startsWith('$krb5tgs$23$*paul$CORP.LAN$CORP.LAN/paul*$004f004f004f004f004f004f004f004f$')).toBe(true)
    expect(r.cracks[0].hash.includes(':')).toBe(false)
    expect(r.cracks[0].plaintext).toBe('Password123!')
    expect(r.cracks[0].username).toBeUndefined()
  })

  it('hashcat: NTLM, DCC2, asrep and an SPN with a colon', () => {
    const out = [
      '77777777777777777777777777777777:Pass:word1',
      '$DCC2$10240#jay#00080008000800080008000800080008:Winter2000!',
      '$krb5asrep$23$jay@CORP.LAN:55555555555555555555555555555555$66666666666666666666:Winter2026',
      '$krb5tgs$23$*sql$CORP.LAN$MSSQLSvc/db.corp.lan:1433*$55555555555555555555555555555555$66666666666666666666:Autumn2026',
      '$krb5tgs$23$*nope$CORP.LAN$x/y*$55555555555555555555555555555555$66666666666666666666',
      'Session..........: hashcat',
    ].join('\n')
    const r = interpret({ command: 'hashcat --show hashes.txt', output: out })
    expect(r.cracks.map((c) => [c.hash, c.plaintext])).toEqual([
      ['77777777777777777777777777777777', 'Pass:word1'],
      ['$DCC2$10240#jay#00080008000800080008000800080008', 'Winter2000!'],
      ['$krb5asrep$23$jay@CORP.LAN:55555555555555555555555555555555$66666666666666666666', 'Winter2026'],
      ['$krb5tgs$23$*sql$CORP.LAN$MSSQLSvc/db.corp.lan:1433*$55555555555555555555555555555555$66666666666666666666', 'Autumn2026'],
    ])
  })

  it('a bare 32-hex pair is not a crack unless the command is hashcat', () => {
    const out = 'aad3b435b51404eeaad3b435b51404ee:77777777777777777777777777777777'
    expect(interpret({ command: 'cat pairs.txt', output: out }).cracks).toEqual([])
  })

  it('john --show and live lines give user+plaintext', () => {
    const show = interpret({ command: 'john --show config.hash', output: johnShow })
    expect(show.parsers).toEqual(['cracked'])
    expect(show.cracks).toEqual([{ hash: '', plaintext: 'Winter2000!', username: 'archive.zip/web/app.conf' }])
    const live = interpret({ command: 'john --wordlist=rockyou.txt config.hash', output: johnLive })
    expect(live.cracks).toEqual([{ hash: '', plaintext: 'Winter2000!', username: 'archive.zip/web/app.conf' }])
    // Loaded/Cost/status lines that end in ")" are never read as cracks
    const noisy = interpret({ command: 'john x', output: johnLive + '\n' + johnShow })
    expect(noisy.cracks).toHaveLength(1)
  })

  it('john --show with pwdump fields keeps a colon in the password and stops at the footer', () => {
    const out = [
      'jay:Pass:word1:1001:aad3b435b51404eeaad3b435b51404ee:88888888888888888888888888888888:::',
      'drew:Winter2000!:1002:aad3b435b51404eeaad3b435b51404ee:99999999999999999999999999999999:::',
      '',
      '2 password hashes cracked, 1 left',
    ].join('\n')
    expect(interpret({ command: 'john --show --format=NT h.txt', output: out }).cracks).toEqual([
      { hash: '', plaintext: 'Pass:word1', username: 'jay' },
      { hash: '', plaintext: 'Winter2000!', username: 'drew' },
    ])
  })

  it('hashcat --show NetNTLMv2 and v1: the hash is everything before the final :plain', () => {
    const v2 = 'JAY::CORP:1122334455667788:0123456789ABCDEF0123456789ABCDEF:0101000000000000AABBCCDD00000000'
    const v1 = 'drew::CORP:' + 'a'.repeat(48) + ':' + 'b'.repeat(48) + ':1122334455667788'
    const out = [`${v2}:Password1`, `${v1}:Pass:word1`, 'Session..........: hashcat'].join('\n')
    const r = interpret({ command: 'hashcat -m 5600 responder.txt --show', output: out })
    expect(r.parsers).toEqual(['cracked'])
    expect(r.cracks.map((c) => [c.hash, c.plaintext])).toEqual([[v2, 'Password1'], [v1, 'Pass:word1']])
  })

  it('john --show keeps colons in a plain user:password line; a container file cuts at field 2', () => {
    const out = ['jay:Pa:ss:2026', 'archive.zip/web/app.conf:Winter2000!:web/app.conf:archive.zip:loot/archive.zip', '', '2 password hashes cracked, 0 left'].join('\n')
    expect(interpret({ command: 'john --show h.txt', output: out }).cracks).toEqual([
      { hash: '', plaintext: 'Pa:ss:2026', username: 'jay' },
      { hash: '', plaintext: 'Winter2000!', username: 'archive.zip/web/app.conf' },
    ])
  })

  it('john --show drops the input line\'s trailing hash fields (NetNTLMv2, NetNTLMv1, DCC2)', () => {
    const v2Tail = 'CORP:1122334455667788:0123456789ABCDEF0123456789ABCDEF:0101000000000000AABBCCDD00000000'
    const v1Tail = 'CORP:' + 'a'.repeat(48) + ':' + 'b'.repeat(48) + ':1122334455667788'
    const out = [
      `jay:Password1::${v2Tail}`,
      `paul:Pa:ss1::${v2Tail}`,
      `sam:Pa:ss2:${v2Tail}`,
      `drew:Winter2000!::${v1Tail}`,
      'CORP/stan:Summer2000!: (2026-01-01 00:00:00)',
      'user:pa:ss',
      '',
      '6 password hashes cracked, 0 left',
    ].join('\n')
    expect(interpret({ command: 'john --show responder.txt', output: out }).cracks).toEqual([
      { hash: '', plaintext: 'Password1', username: 'jay' },
      { hash: '', plaintext: 'Pa:ss1', username: 'paul' },
      { hash: '', plaintext: 'Pa:ss2', username: 'sam' },
      { hash: '', plaintext: 'Winter2000!', username: 'drew' },
      { hash: '', plaintext: 'Summer2000!', username: 'CORP/stan' },
      { hash: '', plaintext: 'pa:ss', username: 'user' },
    ])
  })

  it('john --show on an unshadowed passwd file takes field 2 only', () => {
    const out = 'jay:Winter2000!:1000:1000:Jay,,,:/home/jay:/bin/bash\n\n1 password hash cracked, 0 left'
    expect(interpret({ command: 'john --show unshadowed.txt', output: out }).cracks).toEqual([
      { hash: '', plaintext: 'Winter2000!', username: 'jay' },
    ])
  })

  it('john --show with 0 cracked parses nothing', () => {
    const out = 'jay:Winter2000!\n\n0 password hashes cracked, 2 left'
    expect(interpret({ command: 'john --show h.txt', output: out }).cracks).toEqual([])
  })
})
