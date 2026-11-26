import { GTFOBINS, type GtfoMechanism } from './gtfobins'
import type { FoundVector, HostRef, Parser } from './types'

const RAN_ON: HostRef = { ranOn: true }

const STANDARD_SUID = new Set([
  ...['passwd', 'su', 'sudo', 'mount', 'umount', 'chsh', 'chfn', 'newgrp', 'gpasswd', 'pkexec', 'fusermount', 'fusermount3']
    .map((b) => `/usr/bin/${b}`),
  '/usr/lib/openssh/ssh-keysign',
  '/usr/lib/dbus-1.0/dbus-daemon-launch-helper',
])

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** True when GTFOBins lists the binary for the mechanism; versioned names (python3, perl5.28.1) fall back to the base name. */
function listed(path: string, mech: GtfoMechanism): boolean {
  const name = basename(path)
  const entry = Object.hasOwn(GTFOBINS, name)
    ? GTFOBINS[name]
    : GTFOBINS[/^([A-Za-z][A-Za-z_-]*?)[\d.]+$/.exec(name)?.[1] ?? '']
  return entry?.includes(mech) ?? false
}

const uniq = (xs: string[]): string[] => [...new Set(xs)]

/** `find / -perm -u=s` output: one absolute path per line. */
export function suidVectors(text: string): string[] {
  const titles: string[] = []
  for (const raw of text.split('\n')) {
    const path = raw.trim()
    if (!/^\/\S+$/.test(path) || STANDARD_SUID.has(path)) continue
    if (listed(path, 'suid') || listed(path, 'limited-suid')) titles.push(`SUID ${path} (GTFOBins)`)
  }
  return uniq(titles)
}

// "(root) NOPASSWD: /usr/bin/vim, PASSWD: /bin/ls": the runas group, then comma-separated commands with optional tags.
const SUDO_RULE = /^\s*\(([^)]*)\)\s+(?:\([^)]*\)\s+)?(.+)$/
const SUDO_TAGS = /^(?:[A-Z_]+:\s*)+/

/** `sudo -l` output. */
export function sudoVectors(text: string): string[] {
  const titles: string[] = []
  if (/env_keep[^\n]*LD_PRELOAD/.test(text)) titles.push('sudo LD_PRELOAD kept')
  for (const line of text.split('\n')) {
    const rule = SUDO_RULE.exec(line)
    if (!rule || /^(?:Matching Defaults|User\s)/.test(line.trim())) continue
    const runas = rule[1].split(':')[0].trim()
    for (const part of rule[2].split(',')) {
      const nopasswd = /\bNOPASSWD:/.test(part)
      if (/\bNOEXEC:/.test(part)) continue // NOEXEC blocks the shell escapes GTFOBins relies on
      const cmd = part.trim().replace(SUDO_TAGS, '').trim()
      if (cmd === 'ALL') {
        if (runas === 'ALL') titles.push(`sudo: full root (ALL : ALL)${nopasswd ? ' NOPASSWD' : ''}`)
        else if (runas === 'root') titles.push(`sudo: full root (root)${nopasswd ? ' NOPASSWD' : ''}`)
        continue
      }
      // Fixed arguments pin the command (e.g. `crontab -l`); a `*` wildcard leaves room to inject.
      const [path, ...args] = cmd.split(/\s+/)
      if (!/^\/\S+$/.test(path) || !listed(path, 'sudo')) continue
      if (args.length > 0 && !args.includes('*')) continue
      titles.push(`sudo ${path} as ${runas} (GTFOBins)`)
    }
  }
  return uniq(titles)
}

const DANGEROUS_CAPS = ['cap_setuid', 'cap_dac_read_search', 'cap_sys_admin']
// getcap -r: "/usr/bin/perl cap_setuid=ep" (libcap 2.4x+) or "/usr/bin/perl = cap_setuid+ep" (older)
const CAP_LINE = /^(\/\S+)\s+(?:=\s*)?(cap_\S+)$/

/** `getcap -r /` output. */
export function capVectors(text: string): string[] {
  const titles: string[] = []
  for (const line of text.split('\n')) {
    const m = CAP_LINE.exec(line.trim())
    if (!m || !listed(m[1], 'capabilities')) continue
    const held: string[] = m[2].toLowerCase().match(/cap_[a-z_]+/g) ?? []
    for (const cap of DANGEROUS_CAPS) {
      if (held.includes(cap)) titles.push(`Capability ${cap} on ${m[1]} (GTFOBins)`)
    }
  }
  return uniq(titles)
}

const asVectors = (titles: string[]): FoundVector[] => titles.map((title) => ({ host: RAN_ON, title }))
const empty = { credentials: [], attempts: [], cracks: [], usernames: [] }

export const suid: Parser = {
  id: 'suid',
  detect: (i) => /\bfind\b.*-perm\s+[-/]?(?:u=s|0?[46]000)\b/.test(i.command),
  parse: (i) => ({
    ...empty,
    vectors: asVectors(suidVectors(i.output)),
    ticks: [{ host: RAN_ON, goalId: 'h-pe-lin-suid', parser: 'suid' }],
  }),
}

export const sudo: Parser = {
  id: 'sudo',
  detect: (i) => /may run the following commands on/.test(i.output),
  parse: (i) => ({
    ...empty,
    vectors: asVectors(sudoVectors(i.output)),
    ticks: [{ host: RAN_ON, goalId: 'h-pe-lin-sudo', parser: 'sudo' }],
  }),
}

export const caps: Parser = {
  id: 'caps',
  detect: (i) => /\bgetcap\b/.test(i.command),
  parse: (i) => ({
    ...empty,
    vectors: asVectors(capVectors(i.output)),
    ticks: [{ host: RAN_ON, goalId: 'h-pe-lin-caps', parser: 'caps' }],
  }),
}

// pspy: "2026/01/01 00:00:01 CMD: UID=0     PID=1234   | /bin/bash /opt/backup.sh"
// unverified: no real sample yet (owner collects in next lab)
const PSPY_ROOT = /\bCMD: UID=0\s+PID=\d+\s+\|\s*(.+)$/
// syslog: "... CRON[1330]: (root) CMD (/bin/bash /home/zoe/.scripts/backup.sh)"
const SYSLOG_ROOT = /CRON\[\d+\]: \(root\) CMD \((.+)\)\s*$/
// ls -l line: regular file only (a symlink proves nothing), then rwx for user, group, other; other-write is the 9th permission character.
const LS_LINE = /^-[rwxsStT-]{6}[r-]w[xtT-]\.?\s+\d+\s+.*\s(\/\S+)$/

function rootCronPaths(text: string): string[] {
  const paths: string[] = []
  for (const line of text.split('\n')) {
    const cmd = (PSPY_ROOT.exec(line) ?? SYSLOG_ROOT.exec(line))?.[1]
    if (cmd) paths.push(...(cmd.match(/\/[^\s"';&|()]+/g) ?? []))
  }
  return uniq(paths)
}

function writableByOthers(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    const m = LS_LINE.exec(line.trim())
    if (m) out.add(m[1])
  }
  return out
}

export const cron: Parser = {
  id: 'cron',
  detect: (i) => i.output.split('\n').some((l) => PSPY_ROOT.test(l) || SYSLOG_ROOT.test(l)),
  parse: (i) => {
    const writable = writableByOthers(i.output)
    const titles = rootCronPaths(i.output).filter((p) => writable.has(p)).map((p) => `Writable root cron script ${p}`)
    return {
      ...empty,
      vectors: asVectors(titles),
      ticks: [{ host: RAN_ON, goalId: 'h-pe-lin-cron', parser: 'cron' }],
    }
  },
}
