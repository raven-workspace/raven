import { describe, it, expect } from 'vitest';
import { BUILTIN_LIBRARY } from '../../../engines/library/data';
import type { LibraryCommand } from '../../../engines/library/types';
import { firstBinary, matchesCommand } from '../../../engines/library/matcher';
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP, HOST_GOALS } from '../../../engines/checklist';

const lib = BUILTIN_LIBRARY;
const ENGAGEMENT_GOALS = [...ENGAGEMENT_SETUP, ...AD_PLAYBOOKS.flatMap((p) => p.goals)];
const ALL_GOAL_IDS = new Set([...HOST_GOALS, ...ENGAGEMENT_GOALS].map((g) => g.id));
/** Library order within a goal (the old commandsForGoal with no operator preferences). */
const commandsForGoal = (goalId: string, library: LibraryCommand[]) => library.filter((c) => c.goals.includes(goalId));
/** Records, not commands: the operator writes them by hand. */
const NO_COMMAND_NEEDED = new Set(['h-foot-arrived', 'h-close-notes', 'e-setup-kind']);
const FULL_TCP_MISSES = ['nmap -sC -sV 10.0.0.5', 'nmap --top-ports 1000 10.0.0.5'];
const BANNED_BINS = new Set([
  'nessus', 'openvas', 'sqlmap', 'mitm6', 'arpspoof', 'ettercap', 'bettercap',
  'ntlmrelayx', 'impacket-ntlmrelayx', 'petitpotam', 'coercer', 'printerbug',
]);
const KNOWN_TOKENS = new Set([
  'TARGET_IP', 'LHOST', 'LPORT', 'DOMAIN', 'DC_IP', 'DC_HOST', 'USER', 'PASS', 'HASH',
  'WORDLIST', 'INTERFACE', 'SUBNET', 'SUBNET_PREFIX', 'TUNNEL_IP',
]);
/** Same shape resolveTemplate treats as a placeholder: `{TOKEN}` (not `${...}`) or `<TOKEN>`. */
const TOKEN_RE = /(?<!\$)\{([A-Za-z0-9_-]{2,})\}|<([A-Za-z0-9_-]{2,})>/g;

const first = (goalId: string) => commandsForGoal(goalId, lib)[0];

describe('built-in command library', () => {
  it('is not empty', () => {
    expect(lib.length).toBeGreaterThan(100);
  });

  it('ids are unique', () => {
    const seen = new Set<string>();
    const dupes = lib.filter((c) => (seen.has(c.id) ? true : (seen.add(c.id), false))).map((c) => c.id);
    expect(dupes).toEqual([]);
  });

  it('every goal id referenced exists in HOST_GOALS, ENGAGEMENT_SETUP or AD_PLAYBOOKS', () => {
    const unknown = lib.flatMap((c) => c.goals.filter((g) => !ALL_GOAL_IDS.has(g)).map((g) => `${c.id} -> ${g}`));
    expect(unknown).toEqual([]);
    expect(lib.filter((c) => c.goals.length === 0).map((c) => c.id)).toEqual([]);
  });

  it('every host and engagement goal has at least one command', () => {
    const missing = [...ALL_GOAL_IDS].filter((id) => !NO_COMMAND_NEEDED.has(id) && !lib.some((c) => c.goals.includes(id)));
    expect(missing).toEqual([]);
  });

  it('every command with a matcher has hit and miss examples', () => {
    const bad = lib.filter((c) => c.match && (!c.matchExamples || c.matchExamples.hit.length === 0 || c.matchExamples.miss.length === 0));
    expect(bad.map((c) => c.id)).toEqual([]);
    expect(lib.filter((c) => !c.match && c.matchExamples).map((c) => c.id)).toEqual([]);
  });

  it('every matchExample hit matches and every miss does not', () => {
    const failures: string[] = [];
    for (const c of lib) {
      if (!c.match || !c.matchExamples) continue;
      for (const hit of c.matchExamples.hit) if (!matchesCommand(hit, c.match)) failures.push(`${c.id} should hit: ${hit}`);
      for (const miss of c.matchExamples.miss) if (matchesCommand(miss, c.match)) failures.push(`${c.id} should miss: ${miss}`);
    }
    expect(failures).toEqual([]);
  });

  it('full-tcp matchers carry the required misses', () => {
    const fullTcp = lib.filter((c) => c.match && c.goals.includes('h-enum-full-tcp'));
    expect(fullTcp.length).toBeGreaterThan(0);
    for (const c of fullTcp.filter((x) => x.match!.bins.includes('nmap'))) {
      for (const miss of FULL_TCP_MISSES) expect(c.matchExamples!.miss).toContain(miss);
    }
  });

  it('matchers never match the other examples\' full-tcp misses', () => {
    const fullTcp = lib.filter((c) => c.match && c.goals.includes('h-enum-full-tcp'));
    const misses = new Set([...FULL_TCP_MISSES, ...fullTcp.flatMap((c) => c.matchExamples?.miss ?? [])]);
    const ticks: string[] = [];
    for (const line of misses) for (const c of fullTcp) if (matchesCommand(line, c.match!)) ticks.push(`${c.id}: ${line}`);
    expect(ticks).toEqual([]);
  });

  it('a command template matches its own matcher when it is a single line', () => {
    // Guards against a matcher written for a different spelling than the template it belongs to.
    const failures = lib
      .filter((c) => c.match && !c.template.includes('\n'))
      .filter((c) => !matchesCommand(c.template, c.match!))
      .map((c) => c.id);
    expect(failures).toEqual([]);
  });

  it('banned tools are flagged', () => {
    const unflagged = lib.filter((c) => {
      const bin = firstBinary(c.template.split('\n')[0]);
      const banned = BANNED_BINS.has(c.tool.toLowerCase()) || (bin !== null && BANNED_BINS.has(bin));
      return banned && c.exam !== 'banned';
    });
    expect(unflagged.map((c) => c.id)).toEqual([]);
    const poison = lib.filter((c) => (c.tags ?? []).some((t) => t === 'poisoning' || t === 'spoofing'));
    expect(poison.length).toBeGreaterThan(0);
    expect(poison.filter((c) => c.exam !== 'banned').map((c) => c.id)).toEqual([]);
  });

  it('responder is allowed as a capture server', () => {
    const capture = lib.filter(
      (c) => c.tool === 'responder' && !(c.tags ?? []).some((t) => t === 'poisoning' || t === 'spoofing') && c.exam === undefined,
    );
    expect(capture.length).toBeGreaterThan(0);
    expect(capture.some((c) => /xp_dirtree|unc|file drop/i.test(c.why ?? ''))).toBe(true);
  });

  it('msfvenom and multi/handler templates have no exam rule', () => {
    const free = lib.filter((c) => c.tool === 'msfvenom' || /multi\/handler/.test(c.template));
    expect(free.length).toBeGreaterThanOrEqual(2);
    expect(free.filter((c) => c.exam !== undefined).map((c) => c.id)).toEqual([]);
  });

  it('metasploit modules carry the metasploit rule', () => {
    const msf = lib.filter((c) => /msfconsole|meterpreter/i.test(c.template) && !/multi\/handler/.test(c.template));
    expect(msf.length).toBeGreaterThan(0);
    expect(msf.filter((c) => c.exam !== 'metasploit').map((c) => c.id)).toEqual([]);
  });

  it('templates use only known tokens', () => {
    const unknown: string[] = [];
    for (const c of lib) {
      for (const m of c.template.matchAll(TOKEN_RE)) {
        const name = m[1] ?? m[2];
        // `{FILL_<NAME>}` = a value only the operator knows (service name, CA, export path): left highlighted.
        if (!KNOWN_TOKENS.has(name) && !/^FILL_[A-Z0-9_]+$/.test(name)) unknown.push(`${c.id}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('target-side and attacker-side commands are labelled', () => {
    const byId = new Map(lib.map((c) => [c.id, c]));
    for (const id of ['win-pe-whoami-priv', 'lin-pe-sudo-l', 'orient-ipconfig-all', 'orient-id']) {
      expect(byId.get(id)?.runFrom, id).toBe('target');
    }
    for (const id of ['enum-nmap-full-tcp', 'enum-smb-nxc-null', 'pivot-ligolo-proxy']) {
      expect(byId.get(id)?.runFrom, id).toBe('attacker');
    }
    // Attacker commands run in the attacker's shell, so they are OS-agnostic.
    expect(lib.filter((c) => c.runFrom === 'attacker' && c.os !== 'any').map((c) => c.id)).toEqual([]);
  });

  it('preferred tool comes first', () => {
    expect(first('h-foot-shell')?.tool).toBe('penelope');
    expect(first('h-enum-web-content')?.tool).toBe('gobuster');
    expect(first('h-pivot-tunnel')?.tool).toBe('ligolo-ng');
    expect(first('h-enum-web-vhosts')?.tool).toBe('gobuster');
    expect(first('h-foot-creds')?.tool).toBe('impacket-psexec');
    expect(first('h-foot-service')?.tool).toBe('impacket-mssqlclient');
    expect(first('h-foot-exploit')?.tool).toBe('searchsploit');
    expect(first('h-foot-brute')?.tool).toBe('nxc');
  });

  it('each foothold goal names its route in', () => {
    const tools = (goal: string) => commandsForGoal(goal, lib).map((c) => c.tool);
    const cmds = (goal: string) => commandsForGoal(goal, lib);
    // credential logins
    for (const t of ['impacket-psexec', 'impacket-wmiexec', 'impacket-smbexec', 'impacket-mssqlclient', 'evil-winrm', 'ssh', 'xfreerdp']) {
      expect(tools('h-foot-creds'), t).toContain(t);
    }
    // the shell goal is only listeners
    expect([...new Set(tools('h-foot-shell'))].sort()).toEqual(['msfconsole', 'nc', 'penelope']);
    expect(cmds('h-foot-shell').every((c) => c.runFrom === 'attacker' && !c.template.includes('{TARGET_IP}'))).toBe(true);
    // payloads, and a way to serve them
    expect(tools('h-foot-payload')).toContain('msfvenom');
    const serve = cmds('h-foot-payload').find((c) => c.template.includes('python3 -m http.server'));
    expect(serve?.runFrom).toBe('attacker');
    expect(serve?.template).not.toMatch(/certutil|wget|curl/);
    const fetch = cmds('h-foot-payload').filter((c) => /certutil|wget|curl|iwr/.test(c.template.split('\n')[0]));
    expect(fetch.map((c) => `${c.runFrom}:${c.os}`).sort()).toEqual(['target:linux', 'target:windows']);
    // public exploits: mirror/examine, and the one Metasploit module
    expect(cmds('h-foot-exploit').some((c) => /searchsploit -x/.test(c.template) && /searchsploit -m/.test(c.template))).toBe(true);
    expect(cmds('h-foot-exploit').find((c) => c.tool === 'msfconsole')?.exam).toBe('metasploit');
    // misconfigured services
    const service = cmds('h-foot-service').map((c) => c.template).join('\n');
    for (const s of ['xp_cmdshell', 'smbclient', 'put ', 'mount -t nfs', 'redis-cli', 'config set dir', 'INTO OUTFILE', '{FILL_WEBROOT}']) {
      expect(service, s).toContain(s);
    }
    // brute force is the last resort
    expect(tools('h-foot-brute')).toContain('hydra');
    expect(cmds('h-foot-brute').find((c) => c.tool === 'hydra')?.why).toMatch(/last resort/i);
    expect(HOST_GOALS.find((g) => g.id === 'h-foot-brute')?.title).toMatch(/last resort/i);
  });

  it('no foothold command ticks a foothold goal', () => {
    // Every foothold goal is an outcome: a login, exploit or payload line is an attempt, not proof of access.
    const ticking = lib.filter((c) => c.match && c.goals.some((g) => g.startsWith('h-foot-') && !g.startsWith('h-foot-web-')));
    expect(ticking.map((c) => c.id)).toEqual([]);
  });

  it('flag goals: a one-liner per OS run on the target, find-flags as fallback, no matchers', () => {
    for (const goal of ['h-orient-proof', 'h-pe-proof']) {
      const cmds = commandsForGoal(goal, lib);
      // outcome goals: the operator ticks them after the screenshot
      expect(cmds.filter((c) => c.match).map((c) => c.id), goal).toEqual([]);
      expect(cmds.every((c) => c.runFrom === 'target'), goal).toBe(true);
      expect(cmds.map((c) => c.id), goal).toEqual(expect.arrayContaining(['close-find-flags-lin', 'close-find-flags-win']));
      // the one-liners come before the find fallback for each OS
      for (const os of ['linux', 'windows'] as const) {
        const own = cmds.filter((c) => c.os === os);
        expect(own[0].id, `${goal} ${os}`).not.toMatch(/find-flags/);
        expect(own[0].template, `${goal} ${os}`).toMatch(/hostname/);
      }
    }
    const tpl = (id: string) => lib.find((c) => c.id === id)!.template;
    expect(tpl('orient-proof-lin')).toBe('cat /home/*/local.txt /home/*/user.txt 2>/dev/null; id; hostname; ip -4 a');
    expect(tpl('lin-pe-proof')).toBe('cat /root/proof.txt /root/root.txt 2>/dev/null; id; hostname; ip -4 a');
    expect(tpl('orient-proof-win')).toContain('local.txt');
    expect(tpl('orient-proof-win')).toContain('whoami & hostname & ipconfig');
    expect(tpl('orient-proof-win-ps')).toBe('Get-Content C:\\Users\\*\\Desktop\\local.txt; whoami; hostname; ipconfig');
    expect(tpl('win-pe-proof')).toBe('type C:\\Users\\Administrator\\Desktop\\proof.txt & whoami & hostname & ipconfig');
    expect(tpl('win-pe-proof-ps')).toBe('Get-Content C:\\Users\\Administrator\\Desktop\\proof.txt; whoami; hostname; ipconfig');
    expect(lib.some((c) => c.goals.includes('h-close-flags'))).toBe(false);
  });

  it('nc comes right after penelope for catching shells', () => {
    const tools = commandsForGoal('h-foot-shell', lib).map((c) => c.tool);
    expect(tools.indexOf('nc')).toBe(1);
  });

  it('within a goal nxc comes before crackmapexec', () => {
    for (const goal of ALL_GOAL_IDS) {
      const tools = commandsForGoal(goal, lib).map((c) => c.tool);
      const nxc = tools.indexOf('nxc');
      const cme = tools.indexOf('crackmapexec');
      if (nxc >= 0 && cme >= 0) expect(nxc, goal).toBeLessThan(cme);
    }
  });

  it('impacket comes first in every goal where an impacket command does the job', () => {
    // Goals where another tool stays first, each for a stated reason.
    const EXCEPTIONS: Record<string, string> = {
      'h-foot-shell': 'catching a shell: penelope (the listener) stays first',
      'e-ad-user-relay': 'ntlmrelayx -tf needs the nxc --gen-relay-list output first',
    };
    const wrong: string[] = [];
    for (const goal of ALL_GOAL_IDS) {
      if (EXCEPTIONS[goal]) continue;
      const tools = commandsForGoal(goal, lib).map((c) => c.tool);
      if (tools.some((t) => t.startsWith('impacket-')) && !tools[0].startsWith('impacket-')) wrong.push(`${goal}: ${tools[0]}`);
    }
    expect(wrong).toEqual([]);
  });

  it('includes the required search syntax and impacket set', () => {
    const templates = lib.map((c) => c.template);
    const has = (s: string) => templates.some((t) => t.includes(s));
    expect(has('Get-ChildItem -Path C:\\ -Include *.kdbx,*.txt,*.ini,*.config,*.xml -File -Recurse -ErrorAction SilentlyContinue')).toBe(true);
    expect(has('findstr /si password *.txt *.ini *.config *.xml')).toBe(true);
    expect(has('dir /s /b C:\\Windows.old\\Windows\\System32\\config\\SAM')).toBe(true);
    expect(has('ConsoleHost_history.txt')).toBe(true);
    expect(has('grep -rniE "pass(word)?|secret|token" / --include=*.conf --include=*.php --include=*.env 2>/dev/null')).toBe(true);
    expect(has('find / -name "*.kdbx" -o -name "id_rsa" 2>/dev/null')).toBe(true);
    for (const tool of [
      'impacket-secretsdump', 'impacket-psexec', 'impacket-wmiexec', 'impacket-smbexec', 'impacket-GetUserSPNs',
      'impacket-GetNPUsers', 'impacket-lookupsid', 'impacket-mssqlclient',
    ]) {
      expect(lib.some((c) => c.tool === tool), tool).toBe(true);
    }
    const dumps = lib.filter((c) => c.tool === 'impacket-secretsdump').map((c) => c.template);
    expect(dumps.some((t) => /-sam\s+\S+.*-system\s+\S+.*\sLOCAL$/.test(t))).toBe(true);
    expect(dumps.some((t) => t.includes('@{TARGET_IP}'))).toBe(true);
  });

  it('stabilisation covers Windows and Linux', () => {
    const stab = commandsForGoal('h-stab-shell', lib);
    expect(stab.some((c) => /ConPtyShell/i.test(c.template))).toBe(true);
    expect(stab.some((c) => /rlwrap/.test(c.template))).toBe(true);
    expect(stab.some((c) => /pty\.spawn/.test(c.template) && /stty/.test(c.template))).toBe(true);
  });

  it('credential-routine nxc lines tick the matching engagement goals only', () => {
    const goalsFor = (line: string) =>
      new Set(lib.filter((c) => c.match && matchesCommand(line, c.match)).flatMap((c) => c.goals));
    const roast = goalsFor("nxc ldap 10.0.0.5 -u 'jace' -p 'Pw1!' -d corp.local --kerberoasting kerb.txt --asreproast asrep.txt | tee x.txt");
    expect(roast.has('e-ad-user-kerberoast')).toBe(true);
    expect(roast.has('e-ad-user-asrep')).toBe(true);
    expect(roast.has('e-ad-nocreds-asrep')).toBe(false);
    const plain = goalsFor("nxc smb 10.0.0.5 -u 'jace' -p 'Pw1!' -d corp.local | tee x.txt");
    expect([...plain]).toEqual([]);
    expect(goalsFor("nxc smb 10.0.0.5 -u 'jace' -p 'Pw1!' --users").has('e-ad-user-users')).toBe(true);
    expect(goalsFor("nxc smb 10.0.0.5 -u '' -p '' --rid-brute 10000").has('e-ad-nocreds-rid')).toBe(true);
    expect(goalsFor("nxc smb 10.0.0.5 -u '' -p '' --rid-brute 10000").has('e-ad-user-rid')).toBe(false);
    const spray = goalsFor("nxc smb 10.0.0.5 -u users.txt -p 'Pw1!' --continue-on-success | tee x.txt");
    expect([...spray].filter((g) => g.startsWith('e-'))).toEqual([]);
  });
});
