import { describe, it, expect } from "vitest";
import type { CredAttempt, Credential } from "../../../types/credentials";
import {
  shellQuote, buildTestCommands, buildRoastCommands, buildUsernameSprayCommands,
  ROUTINE_STEPS, routineStepApplies,
} from "../../../engines/credentials/commands";
import { getCrackingCommands } from "../../../engines/credentials/hashes";
import { att, byHost, cred as baseCred, hostWith, NT as _NT, user } from "./fixtures";

const NT = "c33b5cf9c33b5cf9c33b5cf9c33b5cf9";
void _NT;
const cred = (extra: Partial<Credential> = {}): Credential =>
  baseCred({ username: "harriet", secret: "Blue7Sky3.!", domain: "vertex.lan", ...extra });

const mk = (id: string, ip: string, ports: number[]) => hostWith(id, ip, ports);
const SRV21 = mk("h1", "172.31.162.95", [445]);
const SRV22 = mk("h2", "172.31.162.96", [445]);
const DC = mk("h3", "172.31.162.97", [445, 389]);
const ALL = [SRV21, SRV22, DC];
const HOSTS = ALL.map((x) => x.host);
const SBH = byHost(...ALL);
const one = (h: ReturnType<typeof mk>) => ({ hosts: [h.host], servicesByHost: byHost(h) });

describe('credentialCommands', () => {
  it('shellQuote escapes single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('builds domain and local smb commands only for untested smb hosts', () => {
    const r = buildTestCommands({
      cred: cred(), hosts: HOSTS, servicesByHost: SBH, services: ['smb'],
      attempts: [att({ hostId: 'h2', authMode: 'domain', result: 'failed' })],
    });
    expect(r.commands.map((c) => c.command)).toEqual([
      "nxc smb 172.31.162.95 172.31.162.97 -u 'harriet' -p 'Blue7Sky3.!' -d 'vertex.lan' | tee nxc-smb-harriet.txt",
      "nxc smb 172.31.162.95 172.31.162.96 172.31.162.97 -u 'harriet' -p 'Blue7Sky3.!' --local-auth | tee nxc-smb-harriet-local.txt",
    ]);
  });

  it('errored attempts still count as untested', () => {
    const r = buildTestCommands({
      cred: cred(), hosts: HOSTS, servicesByHost: SBH, services: ['smb'],
      attempts: [att({ hostId: 'h2', result: 'errored' })],
    });
    expect(r.commands[0].hostIds).toEqual(['h1', 'h2', 'h3']);
  });

  it('uses -H for an NTLM hash', () => {
    const r = buildTestCommands({ cred: cred({ type: 'hash', secret: `aad3b435b51404eeaad3b435b51404ee:${NT}` }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toContain(`-H '${NT}'`);
    expect(r.commands[0].command).not.toContain('-p ');
  });

  it("quotes a secret containing a single quote", () => {
    const r = buildTestCommands({ cred: cred({ secret: "it's" }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toContain("-p 'it'\\''s'");
  });

  it('app scope has no -d', () => {
    const r = buildTestCommands({ cred: cred({ scope: 'app' }), ...one(SRV21), attempts: [], services: ['smb'], extraFlags: '--shares' });
    expect(r.commands[0].command).toBe("nxc smb 172.31.162.95 -u 'harriet' -p 'Blue7Sky3.!' --shares | tee nxc-smb-harriet.txt");
  });

  it('teeSuffix keeps the shares step from overwriting the smb output', () => {
    const r = buildTestCommands({ cred: cred(), ...one(SRV21), attempts: [], services: ['smb'], extraFlags: '--shares', teeSuffix: 'shares' });
    expect(r.commands.map((c) => c.command)).toEqual([
      "nxc smb 172.31.162.95 -u 'harriet' -p 'Blue7Sky3.!' -d 'vertex.lan' --shares | tee nxc-smb-harriet-shares.txt",
      "nxc smb 172.31.162.95 -u 'harriet' -p 'Blue7Sky3.!' --local-auth --shares | tee nxc-smb-harriet-local-shares.txt",
    ]);
  });

  it('empty domain falls back to input; an owner-less credential gets no direct test (Task 8)', () => {
    const r = buildTestCommands({ cred: cred({ domain: '' }), ...one(SRV21), attempts: [], services: ['smb'], domain: 'fb.local' });
    expect(r.commands[0].command).toContain("-d 'fb.local'");
    expect(buildTestCommands({ cred: cred({ username: '' }), ...one(SRV21), attempts: [], services: ['smb'] }).notice).toBe('not-sprayable');
  });

  it('tee names stay safe for a username with no filename-safe characters', () => {
    const r = buildTestCommands({ cred: cred({ username: '$$$' }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toMatch(/\| tee nxc-smb-[A-Za-z0-9._-]+\.txt$/);
  });

  it('spray treats a user\'s own hash as tried regardless of hex case', () => {
    const secret = cred({ id: 'cS', username: '', type: 'hash', secret: NT.toUpperCase(), hashType: 'NTLM' });
    const own = cred({ id: 'cO', username: 'alice', type: 'hash', secret: NT, hashType: 'NTLM', domain: null });
    const r = buildUsernameSprayCommands({
      passwordCred: secret, usernames: [user('u1', 'alice')], ...one(SRV21), attempts: [att({ credId: 'cO' }), att({ credId: 'cO', authMode: 'local' })],
      credentials: [secret, own],
    });
    expect(r.notice).toBe('nothing-left');
  });

  it('skips services no host runs', () => {
    const r = buildTestCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH, attempts: [] });
    expect(r.commands.some((c) => c.service === 'ssh')).toBe(false);
    expect(r.commands.some((c) => c.service === 'smb')).toBe(true);
  });

  it('ssh carries neither -d nor --local-auth nor -local suffix', () => {
    const r = buildTestCommands({ cred: cred(), ...one(mk('h9', '10.0.0.9', [22])), attempts: [] });
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0].command).toBe("nxc ssh 10.0.0.9 -u 'harriet' -p 'Blue7Sky3.!' | tee nxc-ssh-harriet.txt");
  });

  it('sanitizes the tee username', () => {
    const r = buildTestCommands({ cred: cred({ username: 'a b/c' }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toContain('tee nxc-smb-a_b_c.txt');
  });

  it('returns a no-services notice when no host has scanned services', () => {
    const r = buildTestCommands({ cred: cred(), ...one(mk('h', '1.1.1.1', [])), attempts: [] });
    expect(r).toEqual({ commands: [], notice: 'no-services' });
  });

  it('returns not-sprayable for a ticket', () => {
    expect(buildTestCommands({ cred: cred({ type: 'ticket' }), hosts: HOSTS, servicesByHost: SBH, attempts: [] }).notice).toBe('not-sprayable');
  });

  it('returns nothing-left when every applicable cell has a result', () => {
    const attempts = ['h1', 'h2', 'h3'].flatMap((m) => [
      att({ hostId: m, authMode: 'domain' }), att({ hostId: m, authMode: 'local' }),
    ]);
    const r = buildTestCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH, attempts, services: ['smb'] });
    expect(r).toEqual({ commands: [], notice: 'nothing-left' });
  });

  it('targets file mode', () => {
    const r = buildTestCommands({
      cred: cred(), hosts: HOSTS, servicesByHost: SBH, services: ['smb'], useTargetsFile: true,
      attempts: [att({ hostId: 'h2', authMode: 'domain' })],
    });
    expect(r.commands[0].command).toBe("nxc smb targets.txt -u 'harriet' -p 'Blue7Sky3.!' -d 'vertex.lan' | tee nxc-smb-harriet.txt");
    expect(r.commands[0].targets).toBe('172.31.162.95\n172.31.162.97');
  });

  it('input domain is the fallback', () => {
    const r = buildTestCommands({ cred: cred({ domain: null }), ...one(SRV21), attempts: [], services: ['smb'], domain: 'fb.local' });
    expect(r.commands[0].command).toContain("-d 'fb.local'");
  });

  it('roast commands target ldap hosts only, domain creds only', () => {
    const r = buildRoastCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH });
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0].command).toBe(
      "nxc ldap 172.31.162.97 -u 'harriet' -p 'Blue7Sky3.!' -d 'vertex.lan' --kerberoasting kerb.txt --asreproast asrep.txt | tee nxc-ldap-roast-harriet.txt");
    expect(buildRoastCommands({ cred: cred({ scope: 'local' }), hosts: HOSTS, servicesByHost: SBH }).commands).toEqual([]);
    expect(buildRoastCommands({ cred: cred(), ...one(SRV21) }).notice).toBe('no-services');
  });

  it('username spray lists only usernames not yet tried with that password', () => {
    const r = buildUsernameSprayCommands({
      passwordCred: cred({ username: 'svc' }), ...one(SRV21), service: 'smb',
      usernames: [user('u1', 'alice'), user('u2', 'bob')],
      attempts: [att({ usernameId: 'u1', authMode: 'domain' }), att({ usernameId: 'u1', authMode: 'local' })],
    });
    expect(r.usersFile).toBe('bob');
    expect(r.commands[0].command).toBe(
      "nxc smb 172.31.162.95 -u users.txt -p 'Blue7Sky3.!' --continue-on-success -d 'vertex.lan' | tee nxc-smb-spray-svc.txt");
    expect(r.commands[1].command).toContain('--local-auth');
  });

  it('username spray reports nothing-left', () => {
    const r = buildUsernameSprayCommands({
      passwordCred: cred(), ...one(SRV21), usernames: [user('u1', 'alice')],
      attempts: [att({ usernameId: 'u1', authMode: 'domain' }), att({ usernameId: 'u1', authMode: 'local' })],
    });
    expect(r.notice).toBe('nothing-left');
  });

  it('routine step applicability', () => {
    expect(ROUTINE_STEPS.map((s) => s.itemId)).toContain('cred-routine-roast');
    const users = [user('u1', 'alice')];
    const h22 = mk('h', '1.1.1.1', [22]);
    expect(routineStepApplies('roast', cred(), HOSTS, SBH, users)).toBe(true);
    expect(routineStepApplies('roast', cred({ scope: 'local' }), HOSTS, SBH, users)).toBe(false);
    const hash = cred({ type: 'hash', secret: NT });
    expect(routineStepApplies('ssh', hash, [h22.host], byHost(h22), users)).toBe(false);
    expect(routineStepApplies('ssh', cred(), [h22.host], byHost(h22), users)).toBe(true);
    expect(routineStepApplies('smb', cred(), HOSTS, SBH, users)).toBe(true);
    expect(routineStepApplies('spray-users', cred(), HOSTS, SBH, [])).toBe(false);
    expect(routineStepApplies('spray-users', cred(), HOSTS, SBH, users)).toBe(true);
    expect(routineStepApplies('spray-users', hash, HOSTS, SBH, users)).toBe(false);
  });
  it('I5 (R11): includeWorking also targets hosts where the credential works in that mode', () => {
    const attempts = [
      att({ hostId: 'h1', authMode: 'domain', result: 'valid' }),
      att({ hostId: 'h1', authMode: 'local', result: 'failed' }),
      att({ hostId: 'h2', authMode: 'domain', result: 'failed' }),
      att({ hostId: 'h2', authMode: 'local', result: 'admin' }),
      att({ hostId: 'h3', authMode: 'domain', result: 'errored' }),
    ];
    const r = buildTestCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH, attempts, services: ['smb'], extraFlags: '--shares', teeSuffix: 'shares', includeWorking: true });
    expect(r.commands.map((c) => [c.authMode, c.hostIds])).toEqual([
      ['domain', ['h1', 'h3']],
      ['local', ['h2', 'h3']],
    ]);
    expect(r.commands[0].command).toContain('--shares | tee nxc-smb-harriet-shares.txt');
    // without the option a worked host is not re-run
    const plain = buildTestCommands({ cred: cred(), hosts: HOSTS, servicesByHost: SBH, attempts, services: ['smb'] });
    expect(plain.commands.map((c) => [c.authMode, c.hostIds])).toEqual([['domain', ['h3']], ['local', ['h3']]]);
  });

  it('a 32-hex plaintext password gets -p, not -H', () => {
    const r = buildTestCommands({ cred: cred({ type: 'password', secret: NT }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toContain(`-p '${NT}'`);
    expect(r.commands[0].command).not.toContain('-H');
  });
});

describe('local credentials', () => {
  it('get a --local-auth command and a -d command with the engagement domain', () => {
    const mary = cred({ id: 'm', username: 'jo.parker', secret: 'pw', domain: null, scope: 'local', localHostId: 'h1' });
    const r = buildTestCommands({ cred: mary, ...one(SRV21), attempts: [], services: ['smb'], domain: 'mock.exam' });
    expect(r.commands.map((c) => c.command)).toEqual([
      "nxc smb 172.31.162.95 -u 'jo.parker' -p 'pw' --local-auth | tee nxc-smb-jo.parker-local.txt",
      "nxc smb 172.31.162.95 -u 'jo.parker' -p 'pw' -d 'mock.exam' | tee nxc-smb-jo.parker.txt",
    ]);
  });

  it('drop the -d command once the domain result is in', () => {
    const mary = cred({ id: 'm', username: 'jo.parker', secret: 'pw', domain: null, scope: 'local', localHostId: 'h1' });
    const r = buildTestCommands({
      cred: mary, ...one(SRV21), services: ['smb'], domain: 'mock.exam',
      attempts: [att({ credId: 'm', hostId: 'h1', authMode: 'domain', result: 'failed' })],
    });
    expect(r.commands.map((c) => c.authMode)).toEqual(['local']);
  });

  it('are still never roasted', () => {
    expect(routineStepApplies('roast', cred({ scope: 'local' }), HOSTS, SBH, [])).toBe(false);
  });
});

describe('username spray after a hit was accepted as its own credential (R12)', () => {
  const svc = cred({ id: 'c1', username: 'svc' });
  // alice was sprayed with svc's password; the [+] became alice's own credential, carrying her results
  const alice = cred({ id: 'cA', username: 'alice' });
  const both = (hostId: string, result: CredAttempt['result']) => [
    att({ credId: 'cA', hostId, authMode: 'domain', result }),
    att({ credId: 'cA', hostId, authMode: 'local', result }),
  ];

  it('does not re-spray a user whose own credential with that password was tried there', () => {
    const r = buildUsernameSprayCommands({
      passwordCred: svc, hosts: [SRV21.host, SRV22.host], servicesByHost: byHost(SRV21, SRV22), usernames: [user('u1', 'alice')], credentials: [svc, alice],
      attempts: [...both('h1', 'valid'), ...both('h2', 'failed')],
    });
    expect(r.notice).toBe('nothing-left');
  });

  it('still sprays hosts that user has not been tried on, and ignores errored results', () => {
    const r = buildUsernameSprayCommands({
      passwordCred: svc, hosts: [SRV21.host, SRV22.host], servicesByHost: byHost(SRV21, SRV22), usernames: [user('u1', 'alice')], credentials: [svc, alice],
      attempts: [...both('h1', 'failed'), ...both('h2', 'errored')],
    });
    expect(r.commands.map((c) => c.hostIds)).toEqual([['h2'], ['h2']]);
  });

  it('a same-named credential with a different password does not count', () => {
    const other = cred({ id: 'cB', username: 'alice', secret: 'Different1' });
    const r = buildUsernameSprayCommands({
      passwordCred: svc, ...one(SRV21), usernames: [user('u1', 'alice')], credentials: [svc, other],
      attempts: [att({ credId: 'cB', hostId: 'h1', authMode: 'domain' }), att({ credId: 'cB', hostId: 'h1', authMode: 'local' })],
    });
    expect(r.usersFile).toBe('alice');
  });
});

describe('secrets with spaces, quotes, colons and $ are shell-safe in every builder', () => {
  // A minimal POSIX unquoter: a word is safe only if every character sits inside '...' / "..." or after a backslash.
  const roundTrip = (word: string, expected: string): boolean => {
    let out = '';
    let i = 0;
    while (i < word.length) {
      const ch = word[i];
      if (ch === "'" || ch === '"') {
        const end = word.indexOf(ch, i + 1);
        if (end < 0) return false;
        out += word.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '\\' && i + 1 < word.length) {
        out += word[i + 1];
        i += 2;
      } else return false;
    }
    return out === expected;
  };
  const secrets = ["P@ss w0rd'!", 'aad3b435b51404eeaad3b435b51404ee:' + NT, '$krb5tgs$23$*svc$R.LOCAL$x/y*$aa11$bb22'];

  it('shellQuote round-trips through sh', () => {
    for (const s of secrets) expect(roundTrip(shellQuote(s), s)).toBe(true);
  });

  it('buildTestCommands and buildRoastCommands quote the password word', () => {
    const pw = secrets[0];
    for (const set of [
      buildTestCommands({ cred: cred({ secret: pw }), ...one(SRV21), attempts: [], services: ['smb'] }),
      buildRoastCommands({ cred: cred({ secret: pw }), hosts: HOSTS, servicesByHost: SBH }),
      buildUsernameSprayCommands({ passwordCred: cred({ secret: pw }), usernames: [user('u1', 'alice')], ...one(SRV21), attempts: [] }),
    ]) {
      expect(set.commands.length).toBeGreaterThan(0);
      for (const c of set.commands) {
        expect(c.command).toContain(`-p ${shellQuote(pw)}`);
        // the unquoted secret never appears outside quotes: stripping every quoted word leaves no secret fragment
        expect(c.command.replace(/'(?:[^']|'\\'')*'/g, '').includes('w0rd')).toBe(false);
      }
    }
  });

  it('an LM:NT hash is reduced to its NT half and quoted', () => {
    const r = buildTestCommands({ cred: cred({ type: 'hash', secret: secrets[1] }), ...one(SRV21), attempts: [], services: ['smb'] });
    expect(r.commands[0].command).toContain(`-H ${shellQuote(NT)}`);
    expect(r.commands[0].command).not.toContain('aad3b435');
    const sp = buildUsernameSprayCommands({ passwordCred: cred({ type: 'hash', username: '', secret: secrets[1] }), usernames: [user('u1', 'alice')], ...one(SRV21), attempts: [] });
    expect(sp.commands[0].command).toContain(`-H ${shellQuote(NT)}`);
  });

  it('a $krb5tgs$ hash is never sprayed or tested, so it never reaches a command line', () => {
    const k = cred({ type: 'hash', secret: secrets[2], hashType: 'Kerberoast TGS-REP (etype 23, RC4)' });
    expect(buildTestCommands({ cred: k, ...one(SRV21), attempts: [] }).notice).toBe('not-sprayable');
    expect(buildRoastCommands({ cred: k, hosts: HOSTS, servicesByHost: SBH }).notice).toBe('not-sprayable');
    expect(buildUsernameSprayCommands({ passwordCred: k, usernames: [user('u1', 'a')], ...one(SRV21), attempts: [] }).notice).toBe('not-sprayable');
  });

  it('hashcat commands quote a $krb5tgs$ hash and a hostile string', () => {
    const quoted = (h: string) => getCrackingCommands(h).hashcat!.replace(/^hashcat -m \d+ /, '').replace(/ \/usr\/share\/\S+$/, '');
    for (const h of [secrets[2], '$krb5tgs$23$x\'; rm -rf ~ #']) expect(roundTrip(quoted(h), h)).toBe(true);
  });
});
