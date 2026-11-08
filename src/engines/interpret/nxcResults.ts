import { parseNxcAuthResults } from '../credentials/nxc'
import { HASH_RE, LOCAL_ONLY, knownSecretsOf } from '../credentials/intake'
import type { FoundAttempt, FoundTick, Parser } from './types'

const NXC_RESULT = /^\s*(?:SMB|WINRM|RDP|SSH|MSSQL|LDAPS?|FTP|WMI|VNC|NFS)\s+\d{1,3}(?:\.\d{1,3}){3}\s+\d+\s+\S+\s+\[[+-]\]/m

/** nxc auth lines ([+]/[-]) as attempts, with the same local/domain and hash/password rules as credential intake. */
export const nxcResults: Parser = {
  id: 'nxc-results',
  detect: (i) => NXC_RESULT.test(i.output),
  parse: (i) => {
    const localFlag = /--local-auth/.test(i.command)
    const rows = parseNxcAuthResults(i.output, knownSecretsOf(i.command))
    const attempts: FoundAttempt[] = rows.map((r) => {
      const authMode = localFlag || LOCAL_ONLY.has(r.protocol) ? 'local' : 'domain'
      return {
        username: r.username,
        domain: authMode === 'local' ? null : (r.domain ?? null),
        secret: r.secret,
        secretKind: HASH_RE.test(r.secret) ? 'hash' : 'password',
        host: { ip: r.ip },
        service: r.protocol,
        result: r.result,
        authMode,
      }
    })
    const ticks: FoundTick[] = [...new Set(rows.map((r) => r.ip))].map((ip) => ({
      host: { ip }, goalId: 'h-vuln-spray', parser: 'nxc-results',
    }))
    return { credentials: [], attempts, cracks: [], usernames: [], vectors: [], ticks }
  },
}
