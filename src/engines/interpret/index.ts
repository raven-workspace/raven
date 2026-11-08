import { cracked } from './cracked'
import { lsassy } from './lsassy'
import { mimikatz } from './mimikatz'
import { secretsdump } from './secretsdump'
import { usernames } from './usernames'
import { caps, cron, sudo, suid } from './privescLinux'
import { peas } from './peas'
import { nxcResults } from './nxcResults'
import { normalize } from './text'
import { type FoundAttempt, type HostRef, type InterpretInput, type Interpretation, type Parser } from './types'

// Mutable registry: later tasks add their parser to this list; tests push stubs and remove them in afterEach.
export const PARSERS: Parser[] = [secretsdump, mimikatz, lsassy, cracked, usernames, suid, sudo, caps, cron, peas, nxcResults]

const hostKey = (h: HostRef | 'engagement' | null): string => (h === null ? '' : JSON.stringify(h))

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((t) => {
    const k = key(t)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const RANK: Record<FoundAttempt['result'], number> = { failed: 0, errored: 1, valid: 2, admin: 3 }

/** Collapse repeats of one attempt, keeping the first position but the strongest result. */
function strongest(items: FoundAttempt[], key: (a: FoundAttempt) => string): FoundAttempt[] {
  const best = new Map<string, FoundAttempt>()
  for (const a of items) {
    const k = key(a)
    const cur = best.get(k)
    if (!cur || RANK[a.result] > RANK[cur.result]) best.set(k, a)
  }
  return [...best.values()]
}

export function interpret(i: InterpretInput): Interpretation {
  const input = { command: i.command, output: normalize(i.output), raw: i.output }
  const hits = PARSERS.filter((p) => p.detect(input))
  if (hits.length === 0) {
    return { parsers: [], credentials: [], attempts: [], cracks: [], usernames: [], vectors: [], ticks: [] }
  }
  const results = hits.map((p) => p.parse(input))
  const all = <K extends Exclude<keyof Interpretation, 'parsers'>>(k: K): Interpretation[K] =>
    results.flatMap((r) => r[k] as unknown[]) as Interpretation[K] // flatMap builds a new array
  return {
    parsers: hits.map((p) => p.id),
    credentials: dedupe(all('credentials'), (c) => [c.username, c.domain, c.secret].join('\u0000')),
    attempts: strongest(all('attempts'), (a) =>
      [a.username, a.domain, a.secret, hostKey(a.host), a.service].join('\u0000')),
    cracks: dedupe(all('cracks'), (c) =>
      c.hash !== '' ? c.hash : ['', (c.username ?? '').toLowerCase(), c.plaintext].join('\u0000')),
    usernames: dedupe(all('usernames'), (u) => [u.username, u.domain, hostKey(u.host)].join('\u0000')),
    vectors: dedupe(all('vectors'), (v) => hostKey(v.host) + '\u0000' + v.title),
    ticks: dedupe(all('ticks'), (t) => hostKey(t.host) + '\u0000' + t.goalId),
  }
}
