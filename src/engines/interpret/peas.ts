import { vectorsFromIdentity } from '../facts'
import { capVectors, sudoVectors, suidVectors } from './privescLinux'
import { hasRedOnYellow, normalize } from './text'
import type { FoundVector, HostRef, Parser } from './types'

const RAN_ON: HostRef = { ranOn: true }
const empty = { credentials: [], attempts: [], cracks: [], usernames: [] }

type Kind = 'lin' | 'win'

// linPEAS section header: "╔══════════╣ Title (T1548.001)"
const LIN_HEADER = /^\s*╔═+╣\s*(.+)$/
// winPEAS section header: a run of 3+ box glyphs (or what a console mis-decoded them to) then the title.
const WIN_HEADER = /^[^\sA-Za-z0-9]{3,}\s+\S/
const LIN_BOX = /^\s*╔/

/** Which PEAS wrote the output, or null. Only the output counts as evidence; the command just breaks ties. */
function kindOf(command: string, output: string): Kind | null {
  const winMarks = /WinPEAS-ng|ÉÍÍÍ|[^\sA-Za-z0-9]{4,}͹/.test(output)
  const linBanner = /LinPEAS/.test(output)
  const boxed = /╔═{5,}╣/.test(output)
  if (!winMarks && !linBanner && !boxed) return null
  if (linBanner || /linpeas/i.test(command)) return 'lin'
  if (winMarks || /winpeas/i.test(command)) return 'win'
  // Newer winPEAS draws the same ╔═╣ headers as linPEAS: tell them apart by Windows evidence.
  return /[A-Z]:\\|\bHKLM\b|\bHKCU\b/.test(output) ? 'win' : 'lin'
}

/** Lines of the section whose header satisfies `isStart`, up to the next header (or box). */
function section(lines: string[], isStart: (l: string) => boolean, isHeader: (l: string) => boolean): string[] {
  const out: string[] = []
  let inside = false
  for (const l of lines) {
    if (isHeader(l)) {
      inside = isStart(l)
      continue
    }
    if (inside) out.push(l)
  }
  return out
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

// `ls -l` line from linPEAS's SUID section: perms, links, owner, group, size, date..., path, optional " ---> note".
// The owner-execute slot (4th character) is s/S for SUID.
const SUID_LINE = /^-[r-][w-][sS]\S*\s.*?\s(\/\S+)(?:\s+--->.*|\s+\(.*\))?$/

function linuxVectors(text: string): string[] {
  const lines = text.split('\n')
  const isHeader = (l: string) => LIN_HEADER.test(l) || LIN_BOX.test(l)
  const titleIs = (re: RegExp) => (l: string) => re.test(LIN_HEADER.exec(l)?.[1] ?? '')
  const sect = (re: RegExp) => section(lines, titleIs(re), isHeader)

  const suidPaths = sect(/^SUID\b/)
    .map((l) => SUID_LINE.exec(l.trim())?.[1])
    .filter((p): p is string => !!p && !p.startsWith('/snap/')) // snap mounts carry copies that are not the host's binaries
  return uniq([
    ...suidVectors(suidPaths.join('\n')),
    ...sudoVectors(sect(/^Checking 'sudo -l'/).join('\n')),
    ...capVectors(sect(/^(?:Capabilities|Users with capabilities)\b/).join('\n')),
  ])
}

const WIN_PRIVS = ['SeImpersonatePrivilege', 'SeAssignPrimaryTokenPrivilege', 'SeBackupPrivilege', 'SeDebugPrivilege']

function windowsVectors(text: string): string[] {
  const lines = text.split('\n')
  const isHeader = (l: string) => WIN_HEADER.test(l)
  const tokenLines = section(lines, (l) => /Current Token privileges/.test(l), isHeader)
  const privileges = tokenLines.map((l) => /^\s*(Se\w+Privilege):/.exec(l)?.[1]).filter((p): p is string => !!p)
  const titles = vectorsFromIdentity({ privileges, groups: [] }).filter((t) =>
    WIN_PRIVS.some((p) => t === `${p} abuse`))

  if (/AlwaysInstallElevated set to 1 in HKLM/.test(text) && /AlwaysInstallElevated set to 1 in HKCU/.test(text)) {
    titles.push('AlwaysInstallElevated set')
  }
  // "Name(Company - Display)[C:\Program Files\x\svc.exe] - Auto - Running - No quotes and Space detected"
  for (const l of lines) {
    if (!/ - No quotes and Space detected\s*$/.test(l)) continue
    const name = /^\s*([^(\s][^(]*)\(/.exec(l)?.[1]
    if (name) titles.push(`Unquoted service path ${name.trim()}`)
  }
  return uniq(titles)
}

/** Every line printed red-on-yellow (PEAS's "95% a PE vector"), colour stripped and cut to 80 characters. */
function redOnYellowVectors(raw: string): string[] {
  const titles: string[] = []
  for (const line of raw.split('\n')) {
    if (!hasRedOnYellow(line)) continue
    const text = normalize(line).trim()
    if (text) titles.push(`PEAS: ${text.slice(0, 80)}`)
  }
  return uniq(titles)
}

export const peas: Parser = {
  id: 'peas',
  detect: (i) => kindOf(i.command, i.output) !== null,
  parse: (i) => {
    const kind = kindOf(i.command, i.output) as Kind
    const raw = i.raw ?? i.output
    const plain = kind === 'lin' ? linuxVectors(i.output) : windowsVectors(i.output)
    const titles = uniq([...plain, ...redOnYellowVectors(raw)])
    const vectors: FoundVector[] = titles.map((title) => ({ host: RAN_ON, title }))
    return { ...empty, vectors, ticks: [{ host: RAN_ON, goalId: kind === 'lin' ? 'h-pe-lin-auto' : 'h-pe-win-auto', parser: 'peas' }] }
  },
}
