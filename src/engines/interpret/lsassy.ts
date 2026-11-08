import { isUsableNt } from './text'
import type { FoundCredential, Parser } from './types'

// unverified: no real sample yet (owner collects in next lab)
// Written from lsassy's documented output: `DOMAIN\user  [NT] <hash> | [SHA1] ...` and `DOMAIN\user  [PWD] <password>`,
// optionally behind netexec's `LSASSY <ip> <port> <host>` prefix.
const LINE = /^(?:.*?\s)?([^\s\\|]+)\\(\S+)\s+(\[(?:NT|PWD)\].*)$/
const SYSTEM_DOMAIN = /^(Window Manager|Font Driver Host|NT AUTHORITY|NT SERVICE)$/i
const SYSTEM_USER = /^(DWM|UMFD)-\d+$/i

export const lsassy: Parser = {
  id: 'lsassy',
  detect: (i) => i.output.split('\n').some((l) => LINE.test(l)),
  parse: (i) => {
    const credentials: FoundCredential[] = []
    const seen = new Set<string>()
    for (const line of i.output.split('\n')) {
      const m = LINE.exec(line)
      if (!m) continue
      const [, domain, username, rest] = m
      const machine = username.endsWith('$')
      for (const seg of rest.split(/\s\|\s(?=\[)/)) {
        const f = /^\[(NT|PWD)\]\s*(.*)$/.exec(seg.trim())
        if (!f) continue
        const secret = f[2]
        let cred: FoundCredential | null = null
        // Whether DOMAIN is a real domain or the host's own name can't be told from this line, so scope is 'domain'.
        const base = { username, domain, scope: 'domain' as const, host: null, source: 'lsassy', machine }
        if (f[1] === 'NT' && isUsableNt(secret)) {
          cred = { ...base, type: 'hash', secret: secret.toLowerCase(), hashType: 'NTLM' }
        } else if (f[1] === 'PWD' && secret && secret !== '(null)' && !machine && !SYSTEM_USER.test(username) && !SYSTEM_DOMAIN.test(domain)) {
          cred = { ...base, type: 'password', secret, hashType: null }
        }
        if (!cred) continue
        const k = [cred.username, cred.domain, cred.type, cred.secret].join('\u0000')
        if (seen.has(k)) continue
        seen.add(k)
        credentials.push(cred)
      }
    }
    const ticks = credentials.some((c) => c.type === 'hash') ? [{ host: { ranOn: true } as const, goalId: 'h-loot-hashes', parser: 'lsassy' }] : []
    return { credentials, attempts: [], cracks: [], usernames: [], vectors: [], ticks }
  },
}
