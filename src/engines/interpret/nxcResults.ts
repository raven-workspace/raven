import { parseNxcAuthResults } from '../credentials/nxc'
import { knownSecretsOf, nxcAuthMode } from '../credentials/intake'
import { isNtShape } from '../credentials/matrix'
import type { FoundAttempt, FoundTick, Parser } from './types'

const NXC_RESULT = /^\s*(?:SMB|WINRM|RDP|SSH|MSSQL|LDAPS?|FTP|WMI|VNC|NFS)\s+\d{1,3}(?:\.\d{1,3}){3}\s+\d+\s+\S+\s+\[[+-]\]/m

/** nxc auth lines ([+]/[-]) as attempts, with the same local/domain and hash/password rules as credential intake. */
export const nxcResults: Parser = {
  id: 'nxc-results',
  detect: (i) => NXC_RESULT.test(i.output),
  parse: (i) => {
    const rows = parseNxcAuthResults(i.output, knownSecretsOf(i.command))
    const attempts: FoundAttempt[] = rows.map((r) => {
      const authMode = nxcAuthMode(i.command, r.protocol)
      return {
        username: r.username,
        domain: authMode === 'local' ? null : (r.domain ?? null),
        secret: r.secret,
        secretKind: isNtShape(r.secret) ? 'hash' : 'password',
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
