import type { Host } from '../../types/host'
import type {
  FoundAttempt, FoundCrack, FoundCredential, FoundTick, FoundUsername, FoundVector, HostRef, Interpretation,
} from './types'

/** Where a resolved item belongs: a known host, the engagement (null), or an IP that may become a host. */
export type Placement = { hostId: string | null } | { newIp: string }

type Resolved<T extends { host: unknown }> = Omit<T, 'host'> & Placement

export interface ResolvedInterpretation {
  parsers: string[]
  newIps: string[]
  credentials: Resolved<FoundCredential>[]
  attempts: Resolved<FoundAttempt>[]
  cracks: FoundCrack[]
  usernames: Resolved<FoundUsername>[]
  vectors: Resolved<FoundVector>[]
  ticks: Resolved<FoundTick>[]
  /** Failed or errored attempts on IPs that match no host: they prove nothing, so no host is made for them. */
  droppedUnknown: number
}

type Outcome = Placement | 'unknown' | null // unknown = IP matches no host; null = unresolvable ({ranOn} without a tagged host)

export function resolveInterpretation(
  i: Interpretation,
  ctx: { entryHostIds: string[]; hosts: Host[] },
): ResolvedInterpretation {
  const byIp = new Map<string, string>()
  for (const h of ctx.hosts) if (h.ip && !byIp.has(h.ip)) byIp.set(h.ip, h.id)
  const ranOn = ctx.entryHostIds[0] ?? null
  const newIps: string[] = []

  const locate = (ref: HostRef | 'engagement' | null): Outcome => {
    if (ref === null || ref === 'engagement') return { hostId: null }
    if ('hostId' in ref) return { hostId: ref.hostId }
    if ('ranOn' in ref) return ranOn === null ? null : { hostId: ranOn }
    const id = byIp.get(ref.ip)
    return id !== undefined ? { hostId: id } : 'unknown'
  }
  const ipOf = (ref: HostRef | 'engagement' | null): string | null =>
    ref !== null && ref !== 'engagement' && 'ip' in ref ? ref.ip : null
  const prove = (ip: string): Placement => {
    if (!newIps.includes(ip)) newIps.push(ip)
    return { newIp: ip }
  }

  // Items that prove their host exists place it by a new IP when it is unknown.
  const withPlacement = <T extends { host: unknown }>(rest: Omit<T, 'host'>, where: Placement): Resolved<T> =>
    ({ ...rest, ...where })
  const place = <T extends { host: HostRef | 'engagement' | null }>(items: T[]): Resolved<T>[] => {
    const out: Resolved<T>[] = []
    for (const { host, ...rest } of items) {
      const where = locate(host)
      if (where === null) continue
      out.push(withPlacement(rest, where === 'unknown' ? prove(ipOf(host)!) : where))
    }
    return out
  }

  const credentials = place(i.credentials)
  const usernames = place(i.usernames)
  const vectors = place(i.vectors)

  // Proving attempts first, so a failed attempt on an IP that another item proved is kept, not dropped.
  for (const a of i.attempts) {
    if ((a.result === 'admin' || a.result === 'valid') && locate(a.host) === 'unknown') prove(ipOf(a.host)!)
  }
  let droppedUnknown = 0
  const attempts: Resolved<FoundAttempt>[] = []
  for (const { host, ...rest } of i.attempts) {
    const where = locate(host)
    if (where === null) continue
    if (where !== 'unknown') attempts.push({ ...rest, ...where })
    else if (newIps.includes(ipOf(host)!)) attempts.push({ ...rest, newIp: ipOf(host)! })
    else droppedUnknown++
  }

  // A tick never proves a host: on an unknown IP it survives only when something else proved that IP.
  const ticks: Resolved<FoundTick>[] = []
  for (const { host, ...rest } of i.ticks) {
    const where = locate(host)
    if (where === null) continue
    if (where === 'unknown') {
      const ip = ipOf(host)!
      if (newIps.includes(ip)) ticks.push({ ...rest, newIp: ip })
    } else ticks.push({ ...rest, ...where })
  }

  return { parsers: [...i.parsers], newIps, credentials, attempts, cracks: [...i.cracks], usernames, vectors, ticks, droppedUnknown }
}
