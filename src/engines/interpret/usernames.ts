import type { FoundTick, FoundUsername, HostRef, Parser } from './types'

// nxc: PROTO  <ip>  <port>  <NAME>  <rest>
const NXC_LINE = /^\S+\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\d+\s+\S+\s+(.*)$/
const NXC_HEADER = /-Username-/
// A --users row: name (may contain spaces), then the Last PW Set column anchors where it ends.
const USER_ROW = /^([^\s[-].*?)\s+(?:<never>|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+\d+(?:\s|$)/
const NXC_DOMAIN = /\(domain:([^)\s]+)\)/
// nxc --rid-brute and impacket-lookupsid: "1103: CORP\zoe (SidTypeUser)"  // unverified: no real sample yet (owner collects in next lab)
const RID_LINE = /\b\d+: ([^\\\s]+)\\(.+?) \(SidTypeUser\)/
// kerbrute userenum  // unverified: no real sample yet (owner collects in next lab)
const KERBRUTE = /VALID USERNAME:\s+(\S+)@(\S+)/
// rpcclient enumdomusers  // unverified: no real sample yet (owner collects in next lab)
const RPC_USER = /^user:\[(.+?)\] rid:\[/
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/

export const usernames: Parser = {
  id: 'usernames',
  detect: (i) =>
    i.output.split('\n').some((l) =>
      NXC_HEADER.test(l) || RID_LINE.test(l) || KERBRUTE.test(l) || RPC_USER.test(l)),
  parse: (i) => {
    const found: FoundUsername[] = []
    const cmdIp = IPV4.exec(i.command)?.[0]
    const cmdHost: HostRef = cmdIp ? { ip: cmdIp } : { ranOn: true }
    const add = (username: string, domain: string | null, host: HostRef, source: string) => {
      // Machine accounts have nothing to spray; groups never reach here.
      if (username.endsWith('$')) return
      found.push({ username, domain, host, source })
    }
    let nxcDomain: string | null = null
    let inUsers = false
    for (const line of i.output.split('\n')) {
      const nxc = NXC_LINE.exec(line)
      const rest = nxc ? nxc[2] : null
      if (rest !== null) {
        const d = NXC_DOMAIN.exec(rest)
        if (d) nxcDomain = d[1]
        if (NXC_HEADER.test(rest)) { inUsers = true; continue }
        const host: HostRef = { ip: nxc![1] }
        const rid = RID_LINE.exec(rest)
        if (rid) { add(rid[2], rid[1], host, 'nxc-rid-brute'); continue }
        if (inUsers) {
          const name = USER_ROW.exec(rest)?.[1]
          if (!name) { inUsers = false; continue }
          const slash = name.indexOf('\\')
          if (slash >= 0) add(name.slice(slash + 1), name.slice(0, slash), host, 'nxc-users')
          else add(name, nxcDomain, host, 'nxc-users')
        }
        continue
      }
      const rid = RID_LINE.exec(line)
      if (rid) { add(rid[2], rid[1], cmdHost, 'lookupsid'); continue }
      const k = KERBRUTE.exec(line)
      if (k) { add(k[1], k[2], cmdHost, 'kerbrute'); continue }
      const r = RPC_USER.exec(line)
      if (r) add(r[1], null, cmdHost, 'rpcclient')
    }
    const seen = new Set<string>()
    const ticks: FoundTick[] = []
    for (const u of found) {
      const k = JSON.stringify(u.host)
      if (seen.has(k)) continue
      seen.add(k)
      ticks.push({ host: u.host!, goalId: 'h-enum-ad-users', parser: 'usernames' })
    }
    return { credentials: [], attempts: [], cracks: [], usernames: found, vectors: [], ticks }
  },
}
