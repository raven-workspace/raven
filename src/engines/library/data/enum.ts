import type { LibraryCommand } from '../types';
import { NMAP_UDP } from './patterns';

/** Port scans, versions and exploit search (Enumerate stage). Per-service checks live in enumServices.ts. */

const FULL_TCP_MISSES = ['nmap -sC -sV 10.0.0.5', 'nmap --top-ports 1000 10.0.0.5'];

export const ENUM_COMMANDS: LibraryCommand[] = [
  // ---------------------------------------------------------------- full TCP
  {
    id: 'enum-nmap-full-tcp',
    title: 'Scan every TCP port',
    tool: 'nmap',
    template: 'sudo nmap -p- -Pn --min-rate 3000 -T4 -oA nmap_full {TARGET_IP}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-full-tcp'],
    why: 'Ports only, fast; run -sC -sV against the open list afterwards.',
    source: 'raven',
    match: {
      bins: ['nmap'],
      any: [String.raw`(^|\s)-p\s*(-|0-65535|1-65535)(?=\s|$)`],
      none: [NMAP_UDP],
    },
    matchExamples: {
      hit: [
        'nmap -p- 10.0.0.5',
        'sudo nmap -p- -Pn --min-rate 3000 -oA full 10.0.0.5',
        'nmap -p 1-65535 -sV 10.0.0.5',
        'nmap -p0-65535 10.0.0.5',
        'proxychains -q nmap -sT -Pn -p- 10.0.0.5',
      ],
      miss: [
        ...FULL_TCP_MISSES,
        'nmap -sU -p- 10.0.0.5',
        'nmap -p 22,80 -sCV 10.0.0.5',
        'nmap -p-1000 10.0.0.5',
        'nmap -Pn 10.0.0.5',
      ],
    },
  },
  {
    id: 'enum-rustscan-full',
    title: 'RustScan every TCP port, then nmap the open ones',
    tool: 'rustscan',
    template: 'rustscan -a {TARGET_IP} --ulimit 5000 -- -sC -sV -oN rustscan.txt',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-full-tcp'],
    why: 'Scans all 65,535 ports by default and hands the open ones to nmap for versions.',
    source: 'raven',
    match: {
      bins: ['rustscan'],
      none: [
        String.raw`(^|\s)(-p|--ports)(?=[\s=\d]|$)`,
        String.raw`(^|\s)--top(?=\s|$)`,
        String.raw`(^|\s)(-r|--range)(?:[\s=]+|(?=\d))(?![01]-65535(\s|$))`,
      ],
    },
    matchExamples: {
      hit: ['rustscan -a 10.0.0.5 --ulimit 5000', 'rustscan -a 10.0.0.5 -r 1-65535 -- -sCV', 'rustscan -a 10.0.0.5 -r1-65535'],
      miss: [...FULL_TCP_MISSES, 'rustscan -a 10.0.0.5 -p 80,443', 'rustscan -a 10.0.0.5 --top', 'rustscan -a 10.0.0.5 -r 1-1000', 'rustscan -a 10.0.0.5 -p80', 'rustscan -a 10.0.0.5 -r1-1000'],
    },
  },
  {
    id: 'enum-masscan-full',
    title: 'Masscan every TCP port',
    tool: 'masscan',
    template: 'sudo masscan -p1-65535 {TARGET_IP} --rate=1000 -e {INTERFACE}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-full-tcp'],
    why: 'Fast but drops packets over VPN; confirm with nmap.',
    source: 'raven',
    match: { bins: ['masscan'], any: [String.raw`-p\s*(0|1)-65535(?=[\s,]|$)`] },
    matchExamples: {
      hit: ['sudo masscan -p1-65535 10.0.0.5 --rate=1000 -e tun0', 'masscan -p 0-65535 10.0.0.5'],
      miss: [...FULL_TCP_MISSES, 'masscan -p80,443 10.0.0.5'],
    },
  },
  // ---------------------------------------------------------------- UDP
  {
    id: 'enum-nmap-udp',
    title: 'Scan the top UDP ports',
    tool: 'nmap',
    template: 'sudo nmap -sU --top-ports 100 -Pn --open -oN nmap_udp.txt {TARGET_IP}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-udp'],
    why: 'SNMP (161), TFTP (69), DNS (53) and IKE (500) only show up on UDP.',
    source: 'raven',
    match: { bins: ['nmap'], all: [NMAP_UDP], none: [String.raw`(^|\s)-p\s*(u:)?\d`] },
    matchExamples: {
      hit: ['sudo nmap -sU --top-ports 20 10.0.0.5', 'nmap -sU -sV --top-ports 100 10.0.0.5', 'nmap -sU -p- 10.0.0.5'],
      miss: ['nmap -sU -p 161 10.0.0.5', 'nmap -sV 10.0.0.5', 'nmap -p- 10.0.0.5'],
    },
  },
  // ---------------------------------------------------------------- versions
  {
    id: 'enum-nmap-versions',
    title: 'Versions and default scripts on the open ports',
    tool: 'nmap',
    // One line: a variable set on an earlier line gets lost when the block is pasted piecemeal into zsh.
    template:
      "nmap -sC -sV -Pn -p \"$(grep -oP '\\d+(?=/open)' nmap_full.gnmap | sort -un | paste -sd, -)\" -oA nmap_svc {TARGET_IP}",
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-versions'],
    why: 'Needs nmap_full.gnmap from the full-port scan (-oA nmap_full). Versions feed searchsploit, scripts catch anonymous logins.',
    source: 'oscp-notes',
    match: {
      bins: ['nmap'],
      // The open-port list from the full scan (or -p- itself): a top-1000 or single-port -sV is not "every version".
      // An inline "$(…)" port list counts only when it reads the scan's open ports (`/open` inside it).
      all: [String.raw`(^|\s)-p\s*("\$\([^"]*\/open[^"]*\)"|"?\$\w+"?|\d+(-\d+)?(,\d+(-\d+)?)+|-|[01]-65535)(?=\s|$)`],
      any: [String.raw`(^|\s)-s[a-z]*v[a-z]*(?=\s|$)`, String.raw`(^|\s)-A(?=\s|$)`],
      none: [NMAP_UDP],
    },
    matchExamples: {
      hit: [
        'nmap -sC -sV -Pn -p "$ports" -oA nmap_svc 10.0.0.5',
        'nmap -sCV -p 22,80 10.0.0.5',
        'nmap -A -p 22,80,445 10.0.0.5',
        'nmap -p- -sV 10.0.0.5',
        'nmap -sV -p $ports 10.0.0.5',
        `nmap -sC -sV -Pn -p "$(grep -oP '\\d+(?=/open)' nmap_full.gnmap | sort -un | paste -sd, -)" -oA nmap_svc 10.0.0.5`,
      ],
      miss: [
        'nmap -sC -sV 10.0.0.5',
        'nmap -sV --top-ports 1000 10.0.0.5',
        'nmap -A 10.0.0.5',
        'nmap -p- 10.0.0.5',
        'nmap -sU -sV -p 53,161 10.0.0.5',
        'nmap -sV -p445 10.0.0.5',
        'nmap -sV -p 80 10.0.0.5',
        'nmap -sV -p "$(whoami)" 10.0.0.5',
        'nmap --top-ports 100 -p "$(x)" 10.0.0.5',
      ],
    },
  },
  {
    id: 'enum-nmap-quick',
    title: 'Quick top-1000 scan with versions and scripts',
    tool: 'nmap',
    template: 'nmap -sC -sV -Pn --min-rate 2000 -oN nmap_quick.txt {TARGET_IP}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-versions'],
    why: 'Something to work on while the full scan runs; never a substitute for it.',
    source: 'raven',
  },
  // ---------------------------------------------------------------- exploits
  {
    id: 'enum-searchsploit-nmap',
    title: 'Search Exploit-DB for every version nmap found',
    tool: 'searchsploit',
    template: 'searchsploit --nmap nmap_svc.xml',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-exploits'],
    why: 'One pass over the whole service list; then search odd versions by hand.',
    source: 'raven',
    match: { bins: ['searchsploit'], none: [String.raw`(^|\s)(-m|--mirror|-u|--update|-x|--examine)(?=\s|$)`] },
    matchExamples: {
      hit: ['searchsploit --nmap nmap_svc.xml', 'searchsploit apache 2.4.49'],
      miss: ['searchsploit -m 50383', 'searchsploit -u'],
    },
  },
  {
    id: 'enum-searchsploit-product',
    title: 'Search one product and version, then mirror the exploit',
    tool: 'searchsploit',
    template: 'searchsploit -w "{FILL_PRODUCT} {FILL_VERSION}"\nsearchsploit -m {FILL_EDB_ID}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-exploits'],
    why: 'Drop the minor version if nothing comes back; read the code before running it.',
    source: 'oscp-notes',
  },
  {
    id: 'enum-nmap-smb-vulns',
    title: 'Check SMB for the known one-shot CVEs',
    tool: 'nmap',
    template: 'nmap -p 139,445 --script "smb-vuln* and not smb-vuln-regsvc-dos" -Pn {TARGET_IP}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-exploits'],
    why: 'MS17-010 and friends on old Windows; skips the DoS script.',
    source: 'raven',
    match: { bins: ['nmap'], all: [String.raw`smb-vuln`] },
    matchExamples: {
      hit: ['nmap -p445 --script smb-vuln* 10.0.0.5', 'nmap --script "smb-vuln-ms17-010" 10.0.0.5'],
      miss: ['nmap -p445 --script smb-enum-shares 10.0.0.5'],
    },
  },
  {
    id: 'enum-nmap-vuln-safe',
    title: 'Run the safe NSE vulnerability scripts',
    tool: 'nmap',
    template: 'nmap --script "vuln and safe" -Pn -oN nmap_vuln.txt {TARGET_IP}',
    os: 'any',
    runFrom: 'attacker',
    goals: ['h-enum-exploits'],
    source: 'raven',
  },
];
