import { isUsableNt } from './text'
import type { FoundCredential, FoundTick, Parser } from './types'

const NULL = '(null)'
const NT = /^\s*\* NTLM\s*:\s*([0-9a-fA-F]{32})\s*$/
const DCSYNC_HASH = /^\s*Hash NTLM:\s*([0-9a-fA-F]{32})\s*$/
// Virtual / system logon accounts carry random machine secrets, never a typed password.
const SYSTEM_DOMAIN = /^(Window Manager|Font Driver Host|NT AUTHORITY|NT SERVICE)$/i
const SYSTEM_USER = /^(DWM|UMFD)-\d+$/i

const value = (line: string, re: RegExp): string | null => {
  const m = re.exec(line)
  if (!m) return null
  const v = m[1].trim()
  return v === NULL ? '' : v
}

export const mimikatz: Parser = {
  id: 'mimikatz',
  detect: (i) =>
    /^mimikatz\s*#/m.test(i.output) ||
    /^Authentication Id\s*:\s*\d/m.test(i.output) ||
    /^SAM Username\s*:/m.test(i.output),
  parse: (i) => {
    const credentials: FoundCredential[] = []
    const seen = new Set<string>()
    let domainHashes = 0
    const add = (c: FoundCredential) => {
      const k = [c.username, c.domain, c.type, c.secret].join('\u0000')
      if (seen.has(k)) return
      seen.add(k)
      credentials.push(c)
    }
    const src = 'mimikatz'

    // sekurlsa::logonpasswords state
    let logonServer = ''
    let user = ''
    let domain = ''
    // lsadump::dcsync / lsadump::sam state
    let dcDomain: string | null = null
    let account = ''
    let accountKind: 'dcsync' | 'sam' | null = null

    for (const line of i.output.split('\n')) {
      if (/^Authentication Id\s*:/.test(line)) { logonServer = ''; user = ''; domain = ''; continue }
      const ls = value(line, /^Logon Server\s*:\s*(.*)$/)
      if (ls !== null) { logonServer = ls; continue }
      const u = value(line, /^\s*\* Username\s*:\s*(.*)$/)
      if (u !== null) { user = u; domain = ''; continue }
      const d = value(line, /^\s*\* Domain\s*:\s*(.*)$/)
      if (d !== null) { domain = d; continue }

      const nt = NT.exec(line)
      if (nt && user) {
        if (!isUsableNt(nt[1])) continue
        // a domain equal to the logon server is the host's own (local) account
        const local = domain !== '' && domain.toLowerCase() === logonServer.toLowerCase()
        add({
          username: user, domain: domain || null, type: 'hash', secret: nt[1].toLowerCase(), hashType: 'NTLM',
          scope: local ? 'local' : 'domain', host: local ? { ranOn: true } : null, source: src, machine: user.endsWith('$'),
        })
        continue
      }
      const pw = /^\s*\* Password\s*:\s*(.*)$/.exec(line)
      if (pw && user) {
        const secret = pw[1]
        if (secret === '' || secret === NULL) continue
        if (user.endsWith('$') || SYSTEM_USER.test(user) || SYSTEM_DOMAIN.test(domain)) continue
        const local = domain !== '' && domain.toLowerCase() === logonServer.toLowerCase()
        add({
          username: user, domain: domain || null, type: 'password', secret, hashType: null,
          scope: local ? 'local' : 'domain', host: local ? { ranOn: true } : null, source: src, machine: false,
        })
        continue
      }

      // lsadump::dcsync
      const dc = /^\[DC\] '([^']+)' will be the domain/.exec(line)
      if (dc) { dcDomain = dc[1]; continue }
      const sam = value(line, /^SAM Username\s*:\s*(.*)$/)
      if (sam !== null) { account = sam; accountKind = 'dcsync'; continue }
      // lsadump::sam (its "Domain" line is the machine name: local accounts carry no domain)
      const su = value(line, /^User\s*:\s*(.*)$/)
      if (su !== null) { account = su; accountKind = 'sam'; continue }

      const h = DCSYNC_HASH.exec(line)
      if (h && account && accountKind) {
        const kind = accountKind
        const name = account
        account = ''
        accountKind = null
        if (!isUsableNt(h[1])) continue
        const local = kind === 'sam'
        add({
          username: name, domain: local ? null : dcDomain, type: 'hash', secret: h[1].toLowerCase(), hashType: 'NTLM',
          scope: local ? 'local' : 'domain', host: local ? { ranOn: true } : null, source: src, machine: name.endsWith('$'),
        })
        if (!local) domainHashes++
      }
    }

    const ticks: FoundTick[] = []
    if (credentials.some((c) => c.type === 'hash')) ticks.push({ host: { ranOn: true }, goalId: 'h-loot-hashes', parser: src })
    if (domainHashes > 0) ticks.push({ host: { ranOn: true }, goalId: 'h-loot-domain', parser: src })
    return { credentials, attempts: [], cracks: [], usernames: [], vectors: [], ticks }
  },
}
