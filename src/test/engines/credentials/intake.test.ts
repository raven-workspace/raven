import { describe, it, expect } from "vitest";
import {
  formatIntakeSummary, knownSecretsOf, pendingCredentialLabel, planCredentialIntake, unrecordedLabel,
  type CredentialIntakePlan, type PlannedAttempt, type PlannedCredential,
} from "../../../engines/credentials/intake";
import { attemptKey, credKey, usernameKey } from "../../../engines/credentials";
import type { Engagement } from "../../../types/engagement";
import type { CredAttempt, Credential, Username } from "../../../types/credentials";
import { cred as baseCred, host as baseHost } from "./fixtures";

const L = {
  admin: 'SMB         172.31.162.95  445    SRV21           [+] vertex.lan\\Liam.Brooks:OwlLikesWalking800 (Pwn3d!)',
  valid: 'SMB  172.31.162.96  445  SRV22     [+] vertex.lan\\Liam.Brooks:OwlLikesWalking800',
  fail: 'SMB  172.31.162.96  445  SRV22  [-] vertex.lan\\apache:Red5Oak2.! STATUS_LOGON_FAILURE',
  failOther: 'SMB  172.31.162.96  445  SRV22  [-] vertex.lan\\zed:Red5Oak2.! STATUS_LOGON_FAILURE',
  unknownHost: 'SMB  10.9.9.9  445  GHOST  [+] vertex.lan\\Liam.Brooks:OwlLikesWalking800',
  errored: 'SMB  172.31.162.96  445  SRV22  [-] vertex.lan\\Liam.Brooks:OwlLikesWalking800 STATUS_ACCOUNT_LOCKED_OUT',
  ssh: 'SSH  172.31.162.95 22  SRV21  [+] ronan:CopperKite71  Linux - Shell access!',
};


const eng = { id: 'eng1', name: 'Vertex' } as Engagement;
const hosts = [
  baseHost('h95', { name: 'SRV21', ip: '172.31.162.95' }),
  baseHost('h96', { name: 'SRV22', ip: '172.31.162.96' }),
];
const cred = (o: Partial<Credential>): Credential => baseCred({ id: 'c', username: 'u', secret: 's', ...o });
const uname = (o: Partial<Username>): Username => ({
  id: 'u', engagementId: 'eng1', username: 'u', domain: null, sourceHostId: null, source: null, createdAt: 0, ...o,
});
const eric = cred({ id: 'cEric', username: 'Liam.Brooks', secret: 'OwlLikesWalking800', domain: 'vertex.lan' });
const run = (output: string, command = 'nxc smb 172.31.162.0/24 -u Liam.Brooks -p OwlLikesWalking800', credentials: Credential[] = [eric], usernames: Username[] = []) =>
  planCredentialIntake({ blocks: [{ command, output }], engagement: eng, hosts, credentials, usernames });

describe('planCredentialIntake', () => {
  it('maps a domain spray to attempts per host with proof-ready inputs', () => {
    const plan = run([L.admin, L.valid].join('\n'))!;
    expect(plan.attempts).toEqual([
      { engagementId: 'eng1', credId: 'cEric', hostId: 'h95', service: 'smb', port: 445, result: 'admin', authMode: 'domain' },
      { engagementId: 'eng1', credId: 'cEric', hostId: 'h96', service: 'smb', port: 445, result: 'valid', authMode: 'domain' },
    ]);
    expect(plan.summary).toEqual({ admin: 1, valid: 1, failed: 0, errored: 0 });
    expect(plan.newCredentials).toEqual([]);
    expect(plan.unknownHosts).toEqual([]);
  });

  it('uses local auth when the command has --local-auth', () => {
    const plan = run(L.admin, 'nxc smb 172.31.162.95 -u Liam.Brooks -p "OwlLikesWalking800" --local-auth')!;
    expect(plan.attempts[0].authMode).toBe('local');
  });

  it('forces local auth for ssh and keeps errored as errored', () => {
    const ronan = cred({ id: 'cS', username: 'ronan', secret: 'CopperKite71' });
    const plan = run(L.ssh, 'nxc ssh 172.31.162.95 -u ronan -p CopperKite71', [ronan])!;
    expect(plan.attempts[0]).toMatchObject({ service: 'ssh', authMode: 'local' });
    const e = run(L.errored)!;
    expect(e.attempts[0].result).toBe('errored');
    expect(e.summary.errored).toBe(1);
    expect(e.summary.failed).toBe(0);
  });

  it('offers an unknown valid pair as a new credential with its attempts', () => {
    const plan = run([L.admin, L.valid].join('\n'), 'nxc smb x -u Liam.Brooks -p OwlLikesWalking800', [])!;
    expect(plan.attempts).toEqual([]);
    expect(plan.newCredentials).toHaveLength(1);
    const p = plan.newCredentials[0];
    expect(p.input).toMatchObject({
      type: 'password', username: 'Liam.Brooks', secret: 'OwlLikesWalking800', domain: 'vertex.lan',
      scope: 'domain', sourceHostId: 'h95', source: 'nxc smb', engagementId: 'eng1',
    });
    expect(p.attempts.map(a => [a.hostId, a.result])).toEqual([['h95', 'admin'], ['h96', 'valid']]);
    expect(plan.summary.admin).toBe(1);
  });

  it('prefills local hash credentials with scope local and the host', () => {
    const nt = 'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0';
    const line = `SMB  172.31.162.96  445  SRV22  [+] SRV22\\admin:${nt} (Pwn3d!)`;
    const plan = run(line, `nxc smb 172.31.162.96 -u admin -H '${nt}' --local-auth`, [])!;
    expect(plan.newCredentials[0].input).toMatchObject({ type: 'hash', scope: 'local', localHostId: 'h96', username: 'admin' });
    expect(plan.newCredentials[0].input.domain).toBeUndefined();
  });

  it('matches hashes case-insensitively on the NT part', () => {
    const h = cred({ id: 'cH', type: 'hash', username: 'admin', secret: '31D6CFE0D16AE931B73C59D7E0C089C0' });
    const line = 'SMB  172.31.162.96  445  SRV22  [+] SRV22\\admin:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0';
    const plan = run(line, 'nxc smb x -u admin -H aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0', [h])!;
    expect(plan.attempts[0].credId).toBe('cH');
  });

  it('records username-list failures against listed usernames and the password credential', () => {
    const listed = uname({ id: 'uApache', username: 'Apache' });
    const pw = cred({ id: 'cPw', username: 'someone', secret: 'Red5Oak2.!' });
    const plan = run(L.fail, 'nxc smb x -u users.txt -p Red5Oak2.!', [pw], [listed])!;
    expect(plan.attempts).toEqual([
      { engagementId: 'eng1', credId: 'cPw', usernameId: 'uApache', hostId: 'h96', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
    ]);
    expect(plan.unrecorded).toBe(0);
  });

  it('counts failures with an unknown password as unrecorded', () => {
    const plan = run([L.fail, L.failOther].join('\n'), 'nxc smb x -u users.txt -p Red5Oak2.!', [])!;
    expect(plan.attempts).toEqual([]);
    expect(plan.unrecorded).toBe(2);
    expect(plan.newUsernames.map(u => u.username)).toEqual(['apache', 'zed']);
  });

  it('names each unrecorded pair as an opt-in credential carrying its failures, kept out of the counts', () => {
    const plan = run([L.fail, L.failOther].join('\n'), 'nxc smb x -u users.txt -p Red5Oak2.!', [])!;
    expect(plan.newCredentials.map(p => [p.input.username, p.failedOnly])).toEqual([['apache', true], ['zed', true]]);
    expect(plan.newCredentials[0].input).toMatchObject({ type: 'password', secret: 'Red5Oak2.!', domain: 'vertex.lan' });
    expect(plan.newCredentials[0].attempts).toEqual([{ engagementId: 'eng1', hostId: 'h96', service: 'smb', port: 445, result: 'failed', authMode: 'domain' }]);
    expect(plan.summary).toEqual({ admin: 0, valid: 0, failed: 0, errored: 0 });
  });

  it('a pair with any success is offered normally, not as failed-only', () => {
    const plan = run([L.valid.replace('Liam.Brooks', 'new.guy')].join('\n'), 'nxc smb x -u new.guy -p OwlLikesWalking800', [])!;
    expect(plan.newCredentials[0].failedOnly).toBeUndefined();
  });

  it('ignores credentials from other engagements', () => {
    const other = cred({ id: 'o', username: 'Liam.Brooks', secret: 'OwlLikesWalking800', engagementId: 'eng2' });
    const plan = run(L.admin, undefined, [other])!;
    expect(plan.attempts).toEqual([]);
    expect(plan.newCredentials).toHaveLength(1);
  });

  it('lists unknown hosts and records nothing for them', () => {
    const plan = run([L.unknownHost, L.admin].join('\n'))!;
    expect(plan.unknownHosts).toEqual(['10.9.9.9']);
    expect(plan.attempts).toHaveLength(1);
    expect(plan.attempts[0].hostId).toBe('h95');
    expect(plan.summary.valid).toBe(0);
  });

  it('adds roast hashes once (dedupe against stored hashes)', () => {
    const h1 = '$krb5tgs$23$*svc$VERTEX.LAN$MSSQL/db*$aabbccdd$eeff0011';
    const h2 = '$krb5asrep$23$bob@VERTEX.LAN:aabbccdd$eeff0011';
    const stored = cred({ id: 'hs', type: 'hash', username: 'svc', domain: 'VERTEX.LAN', secret: h1 });
    const out = `${h1}\n${h2}\n${h2}`;
    const plan = planCredentialIntake({ blocks: [{ command: 'nxc ldap dc -u a -p b --kerberoasting out', output: out }], engagement: eng, hosts, credentials: [stored], usernames: [] })!;
    expect(plan.newHashes).toHaveLength(1);
    expect(plan.newHashes[0]).toMatchObject({
      type: 'hash', username: 'bob', domain: 'VERTEX.LAN', source: 'nxc ldap roast', crackStatus: 'uncracked', engagementId: 'eng1',
    });
  });

  it('a re-roast of an account already holding that kind of hash adds nothing (each roast differs)', () => {
    const first = '$krb5tgs$23$*web_svc$MOCK.EXAM$mock.exam/web_svc*$aaaa1111$bbbb2222';
    const again = '$krb5tgs$23$*web_svc$MOCK.EXAM$mock.exam/web_svc*$cccc3333$dddd4444';
    const asrep1 = '$krb5asrep$23$bob@MOCK.EXAM:1111$2222';
    const asrep2 = '$krb5asrep$23$bob@MOCK.EXAM:3333$4444';
    const stored = cred({ id: 'hs', type: 'hash', username: 'web_svc', domain: 'MOCK.EXAM', secret: first, crackStatus: 'cracked' });
    const plan = planCredentialIntake({
      blocks: [{ command: 'nxc ldap dc -u a -p b --kerberoasting out', output: `${again}\n${asrep1}\n${asrep2}` }],
      engagement: eng, hosts, credentials: [stored], usernames: [],
    })!;
    expect(plan.newHashes.map((h) => h.username)).toEqual(['bob']);
  });

  it('returns null for a paste with no nxc results', () => {
    expect(run('nothing here\nSMB 1.1.1.1 445 X [*] Windows 10')).toBeNull();
  });

  it('R6: an errored line never downgrades an earlier admin on the same target', () => {
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pw1' });
    const out = [
      'SMB  172.31.162.95  445  SRV21  [+] corp\\bob:Pw1 (Pwn3d!)',
      'SMB  172.31.162.95  445  SRV21  [-] corp\\bob:Pw1 STATUS_ACCOUNT_LOCKED_OUT',
    ].join('\n');
    const plan = run(out, 'nxc smb x -u bob -p Pw1', [bob])!;
    expect(plan.attempts).toHaveLength(1);
    expect(plan.attempts[0].result).toBe('admin');
    expect(plan.summary).toEqual({ admin: 1, valid: 0, failed: 0, errored: 0 });
    const rev = run(out.split('\n').reverse().join('\n'), 'nxc smb x -u bob -p Pw1', [bob])!;
    expect(rev.attempts[0].result).toBe('admin');
  });

  it('keeps errored (with detail) when there is no real result, and failed beats errored', () => {
    const plan = run(L.errored)!;
    expect(plan.attempts[0]).toMatchObject({ result: 'errored', detail: 'STATUS_ACCOUNT_LOCKED_OUT' });
  });

  it('attaches [-] lines to a pending credential regardless of order', () => {
    const out = [
      'SMB  172.31.162.95  445  SRV21  [-] corp\\bob:Pw1 STATUS_LOGON_FAILURE',
      'SMB  172.31.162.96  445  SRV22  [+] corp\\bob:Pw1',
      'SMB  172.31.162.95  445  SRV21  [-] corp\\bob:Pw1 STATUS_ACCOUNT_LOCKED_OUT',
    ].join('\n');
    const plan = run(out, 'nxc smb x -u bob -p Pw1', [])!;
    expect(plan.newCredentials).toHaveLength(1);
    expect(plan.newCredentials[0].attempts.map(a => [a.hostId, a.result])).toEqual([['h95', 'failed'], ['h96', 'valid']]);
    expect(plan.unrecorded).toBe(0);
    expect(plan.summary).toEqual({ admin: 0, valid: 1, failed: 1, errored: 0 });
  });

  it('parses shell-escaped quoting in -p values', () => {
    expect(knownSecretsOf("nxc smb x -u bob -p 'it'\\''s'")).toEqual(["it's"]);
    expect(knownSecretsOf('nxc smb x -u bob -p "a\\"b"')).toEqual(['a"b']);
    const plan = run("SMB  172.31.162.96  445  SRV22  [+] corp\\bob:it's", "nxc smb x -u bob -p 'it'\\''s'", [])!;
    expect(plan.newCredentials[0].input.secret).toBe("it's");
  });

  it('a local credential reused on another host records there, on the same credential', () => {
    const apache = cred({ id: 'cAp', username: 'apache', secret: 'Red5Oak2.!', scope: 'local', localHostId: 'h96' });
    const line = 'SMB  172.31.162.95  445  SRV21  [+] SRV21\\apache:Red5Oak2.!';
    const plan = run(line, 'nxc smb 172.31.162.95 -u apache -p Red5Oak2.! --local-auth', [apache])!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cAp', hostId: 'h95', service: 'smb', port: 445, result: 'valid', authMode: 'local' }]);
    expect(plan.newCredentials).toEqual([]);
    const on = run(line.replace('.95', '.96'), 'nxc smb x -u apache -p Red5Oak2.! --local-auth', [apache])!;
    expect(on.attempts[0].credId).toBe('cAp');
  });
  it('C1: knownSecretsOf collects every value after -p/-H up to the next option or shell operator', () => {
    expect(knownSecretsOf("nxc smb x -u bob -p 'Welcome1' 'Welcome1!' -d corp --continue-on-success")).toEqual(['Welcome1', 'Welcome1!']);
    expect(knownSecretsOf("nxc smb x -u bob -p 'a b' c | tee out.txt")).toEqual(['a b', 'c']);
    expect(knownSecretsOf('nxc smb x -u bob -H aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0 --local-auth')).toEqual(['aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0']);
  });

  it('C1: a stored shorter password never steals the result of a longer one (end to end)', () => {
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Welcome1', domain: 'corp' });
    const out = [
      'SMB  172.31.162.95  445  SRV21  [-] corp\\bob:Welcome1 STATUS_LOGON_FAILURE',
      'SMB  172.31.162.95  445  SRV21  [+] corp\\bob:Welcome1! (Pwn3d!)',
    ].join('\n');
    const plan = run(out, "nxc smb 172.31.162.95 -u bob -p 'Welcome1' 'Welcome1!' -d corp --continue-on-success", [bob])!;
    expect(plan.attempts).toEqual([
      { engagementId: 'eng1', credId: 'cBob', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
    ]);
    expect(plan.newCredentials).toHaveLength(1);
    expect(plan.newCredentials[0].input).toMatchObject({ username: 'bob', secret: 'Welcome1!' });
    expect(plan.newCredentials[0].attempts.map(a => a.result)).toEqual(['admin']);
    // password file: only the stored prefix is known
    const pass = cred({ id: 'cP', username: 'bob', secret: 'Pass', domain: 'corp' });
    const p2 = run('SMB  172.31.162.95  445  SRV21  [+] corp\\bob:Password1 (Pwn3d!)', 'nxc smb x -u bob -p passwords.txt', [pass])!;
    expect(p2.attempts).toEqual([]);
    expect(p2.newCredentials[0].input.secret).toBe('Password1');
    // stored longer password, shorter one tried: still separate
    const long = cred({ id: 'cL', username: 'bob', secret: 'Welcome1!', domain: 'corp' });
    const p3 = run('SMB  172.31.162.95  445  SRV21  [+] corp\\bob:Welcome1', "nxc smb x -u bob -p 'Welcome1!' Welcome1", [long])!;
    expect(p3.attempts).toEqual([]);
    expect(p3.newCredentials[0].input.secret).toBe('Welcome1');
  });
  it('C2 (R12): a [+] for a listed username with another credential\'s password is offered as a new credential', () => {
    const alice = uname({ id: 'uAlice', username: 'alice' });
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pass', domain: 'corp' });
    const out = [
      'SMB  172.31.162.95  445  SRV21  [+] corp\\alice:Pass (Pwn3d!)',
      'SMB  172.31.162.96  445  SRV22  [-] corp\\alice:Pass STATUS_LOGON_FAILURE',
    ].join('\n');
    const plan = run(out, "nxc smb x -u users.txt -p 'Pass' --continue-on-success", [bob], [alice])!;
    // T5-R1: the user's [-] line from the same paste follows the pending credential
    expect(plan.attempts).toEqual([]);
    expect(plan.newCredentials).toHaveLength(1);
    const p = plan.newCredentials[0];
    expect(p.input).toMatchObject({ type: 'password', username: 'alice', secret: 'Pass', domain: 'corp', scope: 'domain', engagementId: 'eng1', sourceHostId: 'h95' });
    expect(p.attempts).toEqual([
      { engagementId: 'eng1', hostId: 'h95', service: 'smb', port: 445, result: 'admin', authMode: 'domain' },
      { engagementId: 'eng1', hostId: 'h96', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
    ]);
    expect(p.fromUsername).toEqual({ usernameId: 'uAlice', secretCredIds: ['cBob'] });
    // declined: every result is still recorded against the username + password
    expect(p.ifDeclined).toEqual([
      { engagementId: 'eng1', credId: 'cBob', usernameId: 'uAlice', hostId: 'h95', service: 'smb', port: 445, result: 'admin', authMode: 'domain' },
      { engagementId: 'eng1', credId: 'cBob', usernameId: 'uAlice', hostId: 'h96', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
    ]);
    expect(plan.summary).toEqual({ admin: 1, valid: 0, failed: 1, errored: 0 });
    expect(plan.unrecorded).toBe(0);
  });

  it('C2/T5-R1: the [-] line before the [+] line gives the same plan', () => {
    const alice = uname({ id: 'uAlice', username: 'alice' });
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pass', domain: 'corp' });
    const lines = [
      'SMB  172.31.162.96  445  SRV22  [-] corp\\alice:Pass STATUS_LOGON_FAILURE',
      'SMB  172.31.162.95  445  SRV21  [+] corp\\alice:Pass (Pwn3d!)',
    ];
    const cmd = "nxc smb x -u users.txt -p 'Pass' --continue-on-success";
    const fwd = run([...lines].reverse().join('\n'), cmd, [bob], [alice])!;
    const rev = run(lines.join('\n'), cmd, [bob], [alice])!;
    for (const plan of [fwd, rev]) {
      expect(plan.attempts).toEqual([]);
      expect(plan.newCredentials[0].attempts.map((a) => [a.hostId, a.result]).sort()).toEqual([['h95', 'admin'], ['h96', 'failed']]);
      expect(plan.newCredentials[0].ifDeclined).toHaveLength(2);
      expect(plan.summary).toEqual({ admin: 1, valid: 0, failed: 1, errored: 0 });
    }
  });

  it('C2: a local [+] on the listed-username path is a local credential for that host', () => {
    const alice = uname({ id: 'uAlice', username: 'alice' });
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pass' });
    const plan = run('SMB  172.31.162.95  445  SRV21  [+] SRV21\\alice:Pass', "nxc smb x -u users.txt -p 'Pass' --local-auth", [bob], [alice])!;
    expect(plan.newCredentials[0].input).toMatchObject({ username: 'alice', scope: 'local', localHostId: 'h95' });
    expect(plan.newCredentials[0].input.domain).toBeUndefined();
    expect(plan.newCredentials[0].fromUsername).toEqual({ usernameId: 'uAlice', secretCredIds: ['cBob'], hostId: 'h95' });
  });

  it('I3: the first username-list spray records failures of usernames added by the same plan', () => {
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pass', domain: 'corp' });
    const out = [
      'SMB  172.31.162.95  445  SRV21  [-] corp\\alice:Pass STATUS_LOGON_FAILURE',
      'SMB  172.31.162.95  445  SRV21  [-] corp\\carol:Pass STATUS_LOGON_FAILURE',
    ].join('\n');
    const plan = run(out, "nxc smb x -u users.txt -p 'Pass' --continue-on-success", [bob])!;
    expect(plan.unrecorded).toBe(0);
    expect(plan.newUsernames.map(u => u.username)).toEqual(['alice', 'carol']);
    expect(plan.attempts).toEqual([
      { engagementId: 'eng1', credId: 'cBob', usernameKey: 'eng1|alice|corp', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
      { engagementId: 'eng1', credId: 'cBob', usernameKey: 'eng1|carol|corp', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'domain' },
    ]);
    expect(plan.summary.failed).toBe(2);
  });
});

describe('local credentials tested as domain', () => {
  const mary = cred({ id: 'cMary', username: 'jo.parker', secret: 'pw', scope: 'local', localHostId: 'h96' });
  it('a -d result on another host is recorded against the local credential', () => {
    const line = 'SMB  172.31.162.95  445  SRV21  [-] mock.exam\\jo.parker:pw STATUS_LOGON_FAILURE';
    const plan = run(line, 'nxc smb 172.31.162.95 -u jo.parker -p pw -d mock.exam', [mary])!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cMary', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'domain' }]);
    expect(plan.unrecorded).toBe(0);
  });
  it('a --local-auth result on another host is recorded too (local credential reuse)', () => {
    const line = 'SMB  172.31.162.95  445  SRV21  [-] SRV21\\jo.parker:pw STATUS_LOGON_FAILURE';
    const plan = run(line, 'nxc smb 172.31.162.95 -u jo.parker -p pw --local-auth', [mary])!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cMary', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'local' }]);
  });
  it('a local NT hash tried with --local-auth on another host marks that cell failed', () => {
    const nt = 'a18574d492728ab93449c656e89fc3c1';
    const admin = cred({ id: 'cAdmin', type: 'hash', username: 'Admin', secret: nt, hashType: 'NTLM', scope: 'local', localHostId: 'h96' });
    const out = [
      'SMB         172.31.162.95   445    SRV21             [*] Windows 10 / Server 2019 Build 19041 x64 (name:SRV21) (domain:SRV21) (signing:False) (SMBv1:None)',
      `SMB         172.31.162.95   445    SRV21             [-] SRV21\\Admin:${nt} STATUS_LOGON_FAILURE `,
    ].join('\n');
    const plan = run(out, `nxc smb 172.31.162.95 --local-auth -u Admin -H ${nt}`, [admin])!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cAdmin', hostId: 'h95', service: 'smb', port: 445, result: 'failed', authMode: 'local' }]);
    expect(plan.newCredentials).toEqual([]);
  });
  it('a reused local hash that works on another host lands on the same credential, not a new one', () => {
    const nt = 'a18574d492728ab93449c656e89fc3c1';
    const admin = cred({ id: 'cAdmin', type: 'hash', username: 'Admin', secret: nt, hashType: 'NTLM', scope: 'local', localHostId: 'h96' });
    const plan = run(`SMB  172.31.162.95  445  SRV21  [+] SRV21\\Admin:${nt} (Pwn3d!)`, `nxc smb 172.31.162.95 --local-auth -u Admin -H ${nt}`, [admin])!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cAdmin', hostId: 'h95', service: 'smb', port: 445, result: 'admin', authMode: 'local' }]);
    expect(plan.newCredentials).toEqual([]);
  });
});

describe('a host whose IP changed (lab revert)', () => {
  const line = 'SMB  172.31.130.96  445  SRV22  [-] vertex.lan\\Liam.Brooks:OwlLikesWalking800 STATUS_LOGON_FAILURE';
  it('matches the nxc host name, records the result and proposes the new IP', () => {
    const plan = run(line)!;
    expect(plan.attempts).toEqual([{ engagementId: 'eng1', credId: 'cEric', hostId: 'h96', service: 'smb', port: 445, result: 'failed', authMode: 'domain' }]);
    expect(plan.unknownHosts).toEqual([]);
    expect(plan.ipChanges).toEqual([{ hostId: 'h96', hostName: 'SRV22', from: '172.31.162.96', to: '172.31.130.96' }]);
  });
  it('matches case-insensitively and on the short name of an FQDN host name', () => {
    const fq = [baseHost('h96', { name: 'srv22.vertex.lan', ip: '172.31.162.96' })];
    const plan = planCredentialIntake({ blocks: [{ command: 'nxc smb x -u Liam.Brooks -p OwlLikesWalking800', output: line }], engagement: eng, hosts: fq, credentials: [eric], usernames: [] })!;
    expect(plan.ipChanges.map((c) => c.hostId)).toEqual(['h96']);
  });
  it('stays an unknown host when no single host has that name', () => {
    const twins = [baseHost('a', { name: 'SRV22', ip: '1.1.1.1' }), baseHost('b', { name: 'era', ip: '1.1.1.2' })];
    const plan = planCredentialIntake({ blocks: [{ command: 'nxc smb x -u Liam.Brooks -p OwlLikesWalking800', output: line }], engagement: eng, hosts: twins, credentials: [eric], usernames: [] })!;
    expect(plan.unknownHosts).toEqual(['172.31.130.96']);
    expect(plan.ipChanges).toEqual([]);
    expect(plan.attempts).toEqual([]);
  });
});

describe('formatting', () => {
  it('summarises counts and adds only non-zero extras', () => {
    const plan = run([L.admin, L.valid, L.unknownHost].join('\n'))!;
    expect(formatIntakeSummary(plan)).toBe('nxc: 1 admin · 1 valid · 0 failed · 0 errored · 1 unknown hosts');
    const un = run([L.fail, L.failOther].join('\n'), 'nxc smb x -u users.txt -p Red5Oak2.!', [])!;
    expect(formatIntakeSummary(un)).toContain('2 unrecorded');
  });

  it('labels pending credentials with domain and, for unrecorded pairs, the host and secret kind', () => {
    const plan = run(L.fail, 'nxc smb x -u users.txt -p Red5Oak2.!', [])!;
    const p = plan.newCredentials[0];
    expect(pendingCredentialLabel(p)).toBe('vertex.lan\\apache');
    expect(unrecordedLabel(p, hosts)).toBe('vertex.lan\\apache with a password on SRV22');
  });
});

describe('re-planning the same output', () => {
  // Apply a plan the way the app does when the operator accepts everything, onto plain lists.
  function apply(plan: CredentialIntakePlan, credentials: Credential[], usernames: Username[], attempts: CredAttempt[]) {
    let n = 0;
    const id = (p: string) => `${p}${n++}${credentials.length}${usernames.length}${attempts.length}`;
    const addCred = (i: PlannedCredential) => {
      const c = baseCred({ id: id('c'), ...i, domain: i.domain ?? null } as Partial<Credential>);
      credentials.push(c);
      return c;
    };
    for (const u of plan.newUsernames) usernames.push(uname({ id: id('u'), ...u, domain: u.domain ?? null }));
    const usernameIdFor = (key: string) => usernames.find((u) => usernameKey(u) === key)!.id;
    const addAttempt = (a: PlannedAttempt | (Omit<PlannedAttempt, 'credId'> & { credId: string })) => {
      const { usernameKey: k, ...rest } = a;
      attempts.push({
        id: id('a'), usernameId: null, port: null, detail: null, logEntryId: null, at: 1, ...rest,
        ...(k ? { usernameId: usernameIdFor(k) } : {}),
      } as CredAttempt);
    };
    // Mirrors Task 8's real apply when everything is accepted: an accepted pending credential is created with its
    // own attempts, and username-subject attempts it was derived from (fromUsername) are re-keyed onto it
    // (only on its host for a local credential); `ifDeclined` is used only when the credential is declined.
    const rekeyed = new Set<PlannedAttempt>();
    for (const p of plan.newCredentials) {
      const c = addCred(p.input);
      for (const a of p.attempts) addAttempt({ ...a, credId: c.id });
      const from = p.fromUsername;
      if (!from) continue;
      for (const a of plan.attempts) {
        const sameSubject = from.usernameId ? a.usernameId === from.usernameId : a.usernameKey === from.usernameKey;
        if (sameSubject && from.secretCredIds.includes(a.credId) && (!from.hostId || a.hostId === from.hostId)) rekeyed.add(a);
      }
      for (const a of rekeyed) addAttempt({ ...a, credId: c.id, usernameId: null, usernameKey: undefined } as PlannedAttempt);
    }
    for (const a of plan.attempts) if (!rekeyed.has(a)) addAttempt(a);
    for (const h of plan.newHashes) addCred(h);
  }

  it('the same nxc output planned against its own result adds nothing', () => {
    const bob = cred({ id: 'cBob', username: 'bob', secret: 'Pass', domain: 'corp' });
    const listed = uname({ id: 'uListed', username: 'alice', domain: 'corp' });
    const tgs = '$krb5tgs$23$*svc$VERTEX.LAN$MSSQL/db*$aabbccdd$eeff0011';
    const ownerless = cred({ id: 'cOwnerless', username: '', secret: 'Spray1', domain: null });
    const output = [
      'SMB  172.31.162.95  445  SRV21  [+] corp\\alice:Pass (Pwn3d!)',
      'SMB  172.31.162.96  445  SRV22  [-] corp\\alice:Pass STATUS_LOGON_FAILURE',
      'SMB  172.31.162.95  445  SRV21  [+] corp\\frank:Spray1',
      'SMB  172.31.162.95  445  SRV21  [-] corp\\carol:Pass STATUS_LOGON_FAILURE',
      'SMB  172.31.162.95  445  SRV21  [+] corp\\drew:Fresh1',
      'SMB  172.31.162.96  445  SRV22  [-] corp\\drew:Fresh1 STATUS_LOGON_FAILURE',
      'SMB  172.31.162.96  445  SRV22  [-] corp\\eve:Nope1 STATUS_LOGON_FAILURE',
      'SMB  172.31.162.96  445  SRV22  [-] corp\\bob:Pass STATUS_ACCOUNT_LOCKED_OUT',
      `LDAP  172.31.162.95  389  SRV21  ${tgs}`,
      L.unknownHost,
    ].join('\n');
    const command = "nxc smb x -u users.txt -p 'Pass' --continue-on-success";
    const credentials = [bob, ownerless];
    const usernames = [listed, uname({ id: 'uFrank', username: 'frank', domain: 'corp' })];
    const attempts: CredAttempt[] = [];
    const plan = run(output, command, credentials, usernames)!;
    // sanity: the first plan really has something to add
    expect(plan.newCredentials.length).toBeGreaterThan(0);
    expect(plan.newUsernames.length).toBeGreaterThan(0);
    expect(plan.newHashes).toHaveLength(1);
    expect(plan.newCredentials.find((p) => p.input.username === 'frank')!.input.fromSecretId).toBe('cOwnerless');
    apply(plan, credentials, usernames, attempts);

    const again = run(output, command, credentials, usernames)!;
    expect(again.newCredentials).toEqual([]);
    expect(again.newUsernames).toEqual([]);
    expect(again.newHashes).toEqual([]);
    expect(again.links).toEqual([]);
    // every attempt it plans is one already stored, with the same result
    const stored = new Map(attempts.map((a) => [attemptKey(a), a.result]));
    for (const a of again.attempts) {
      const resolved = a.usernameKey
        ? { ...a, usernameId: usernames.find((u) => usernameKey(u) === a.usernameKey)!.id }
        : a;
      expect(stored.get(attemptKey({ ...resolved, usernameId: resolved.usernameId ?? null, authMode: resolved.authMode ?? 'domain' })), JSON.stringify(a)).toBe(a.result);
    }
    expect(credentials.map(credKey)).toEqual([...new Set(credentials.map(credKey))]);
  });
});

describe('owner-less secrets (spray hit linking)', () => {
  const ownerless = () => cred({ id: 'cS', username: '', secret: 'Winter2026!', domain: null });
  const hit = 'SMB  172.31.162.95  445  SRV21  [+] corp.local\\alice:Winter2026!';
  const cmd = "nxc smb 172.31.162.95 -u users.txt -p 'Winter2026!'";
  const alice = uname({ id: 'u1', username: 'alice' });

  it('a spray hit links the new credential with fromSecretId', () => {
    const p = run(hit, cmd, [ownerless()], [alice])!;
    expect(p.newCredentials).toHaveLength(1);
    expect(p.newCredentials[0].input.fromSecretId).toBe('cS');
    expect(p.newCredentials[0].input.username).toBe('alice');
  });

  it('a spray hit links an already-stored user credential', () => {
    const stored = cred({ id: 'cA', username: 'alice', domain: 'corp.local', secret: 'Winter2026!' });
    const p = run(hit, cmd, [ownerless(), stored], [alice])!;
    expect(p.newCredentials).toHaveLength(0);
    expect(p.links).toEqual([{ credId: 'cA', fromSecretId: 'cS' }]);
  });

  it('an already-linked user credential is not offered a link', () => {
    const stored = cred({ id: 'cA', username: 'alice', domain: 'corp.local', secret: 'Winter2026!', fromSecretId: 'other' });
    expect(run(hit, cmd, [ownerless(), stored], [alice])!.links).toEqual([]);
  });
});

describe('secrets with shell metacharacters or spaces (Review Focus 1)', () => {
  it("-p 'P@$$w0rd' is one literal secret", () => {
    const command = "nxc smb 172.31.162.96 -u bob -p 'P@$$w0rd'";
    expect(knownSecretsOf(command)).toEqual(['P@$$w0rd']);
    const plan = run('SMB  172.31.162.96  445  SRV22  [+] corp\\bob:P@$$w0rd', command, [])!;
    expect(plan.newCredentials[0].input.secret).toBe('P@$$w0rd');
    expect(plan.newCredentials[0].input.username).toBe('bob');
  });

  it("-p 'a b:c' keeps the space and colon", () => {
    const command = "nxc smb 172.31.162.96 -u bob -p 'a b:c'";
    expect(knownSecretsOf(command)).toEqual(['a b:c']);
    const plan = run('SMB  172.31.162.96  445  SRV22  [+] corp\\bob:a b:c', command, [])!;
    expect(plan.newCredentials[0].input.secret).toBe('a b:c');
    expect(plan.newCredentials[0].input.username).toBe('bob');
  });
});
