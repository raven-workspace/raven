import { isUsableNt } from './text'
import type { FoundCredential, Parser } from './types'

const HEADER = /^\[\*\] Dumping (local SAM hashes|Domain Credentials|cached domain logon information|LSA Secrets)/
type Section = 'sam' | 'ntds' | 'cached' | 'lsa' | 'other'
const SECTIONS: Record<string, Section> = {
  'local SAM hashes': 'sam',
  'Domain Credentials': 'ntds',
  'cached domain logon information': 'cached',
  'LSA Secrets': 'lsa',
}

// [domain\]user:rid:lm:nt:::
const HASH_LINE = /^(?:([^\\\s:]+)\\)?([^:\s][^:]*):\d+:[0-9a-fA-F]{32}:([0-9a-fA-F]{32}):::\s*$/
// DOMAIN/user:$DCC2$10240#user#<32 hex>: (date)
const DCC2_LINE = /^(?:([^/\s:]+)\/)?([^:\s]+):(\$DCC2\$\d+#[^#\s]+#[0-9a-fA-F]{32}):/
const MACHINE_ACC = /^\$MACHINE\.ACC:\s*[0-9a-fA-F]{32}:([0-9a-fA-F]{32})\s*$/
const LSA_CLEARTEXT = /^([^\\\s:]+)\\([^:]+):(.+)$/

const hash = (
  username: string, domain: string | null, secret: string, hashType: string,
  scope: FoundCredential['scope'], host: FoundCredential['host'],
): FoundCredential => ({
  username, domain, type: 'hash', secret, hashType, scope, host, source: 'secretsdump',
  machine: username.endsWith('$'),
})

export const secretsdump: Parser = {
  id: 'secretsdump',
  detect: (i) => i.output.split('\n').some((l) => HEADER.test(l)),
  parse: (i) => {
    const credentials: FoundCredential[] = []
    let section: Section = 'other'
    let ntdsHashes = 0
    let hashes = 0
    for (const line of i.output.split('\n')) {
      const h = HEADER.exec(line)
      if (h) { section = SECTIONS[h[1]]; continue }
      if (/^\[\*\] (Kerberos keys grabbed|Cleaning up)/.test(line) || line.startsWith('[-]')) { section = 'other'; continue }

      if (section === 'sam' || section === 'ntds') {
        const m = HASH_LINE.exec(line)
        if (!m || !isUsableNt(m[3]) || /_history\d+$/.test(m[2])) continue
        const domain = m[1] && m[1] !== '.' ? m[1] : null
        const local = section === 'sam'
        credentials.push(hash(m[2], domain, m[3].toLowerCase(), 'NTLM', local ? 'local' : 'domain', local ? { ranOn: true } : null))
        hashes++
        if (!local) ntdsHashes++
      } else if (section === 'cached') {
        const m = DCC2_LINE.exec(line)
        if (!m) continue
        credentials.push(hash(m[2], m[1] ?? null, m[3], 'DCC2', 'domain', null))
        hashes++
      } else if (section === 'lsa') {
        const acc = MACHINE_ACC.exec(line)
        if (acc) {
          if (!isUsableNt(acc[1])) continue
          // The dumped host's own account. Its real name (<HOST>$) isn't known here; Task 9 renames it once the host is resolved.
          credentials.push({ ...hash('$MACHINE.ACC', null, acc[1].toLowerCase(), 'NTLM', 'domain', { ranOn: true }), machine: true })
          hashes++
          continue
        }
        // `$MACHINE.ACC:plain_password_hex:...` is raw key material, not a usable credential: skipped.
        const clear = LSA_CLEARTEXT.exec(line)
        // `DOMAIN\NAME$:<value>` is random machine key material; the account's NT hash is filed from NTDS/SAM instead.
        if (!clear || clear[2].endsWith('$')) continue
        const local = clear[1] === '.'
        credentials.push({
          username: clear[2], domain: local ? null : clear[1], type: 'password', secret: clear[3], hashType: null,
          scope: local ? 'local' : 'domain', host: local ? { ranOn: true } : null, source: 'secretsdump',
          machine: false,
        })
      }
    }
    const ticks = hashes === 0 ? [] : [{ host: { ranOn: true } as const, goalId: 'h-loot-hashes', parser: 'secretsdump' }]
    if (ntdsHashes > 0) ticks.push({ host: { ranOn: true }, goalId: 'h-loot-domain', parser: 'secretsdump' })
    return { credentials, attempts: [], cracks: [], usernames: [], vectors: [], ticks }
  },
}
