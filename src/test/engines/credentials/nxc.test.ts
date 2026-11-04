import { describe, it, expect } from 'vitest';
import { parseNxcAuthResults, parseRoastHashes } from '../../../engines/credentials/nxc';

const L = {
  admin: 'SMB         172.31.162.95  445    SRV21           [+] vertex.lan\\Liam.Brooks:OwlLikesWalking800 (Pwn3d!)',
  valid: 'SMB  172.31.162.96  445  SRV22     [+] vertex.lan\\Liam.Brooks:OwlLikesWalking800',
  era: 'SMB  172.31.162.96  445  SRV22  [+] SRV22\\apache:Red5Oak2.!',
  fail: 'SMB  172.31.162.96  445  SRV22  [-] vertex.lan\\apache:Red5Oak2.! STATUS_LOGON_FAILURE',
  winrm: 'WINRM  172.31.162.97  5985  DC01  [+] vertex.lan\\harriet:Blue7Sky3.! (Pwn3d!)',
  sshOk: 'SSH  172.31.166.144 22  172.31.166.144  [+] ronan:CopperKite71  Linux - Shell access!',
  sshBad: 'SSH  172.31.166.144 22  172.31.166.144  [-] reid:CopperKite71',
  ftp: 'FTP  172.31.166.143  21  172.31.166.143  [-] anonymous:anonymous (Response:530 Login incorrect.)',
  dump: 'SMB         172.31.162.95  445    SRV21           [+] Dumping password info for domain: SRV21',
  shares: 'SMB  172.31.208.121  445  WEB02  [-] Error enumerating shares: Error occurs while reading from remote(104)',
  banner: 'SSH  10.0.0.5 22  10.0.0.5  [-] bob:Summer2024! Error reading SSH protocol banner',
  lock: 'SMB  10.0.0.6 445  WS01  [-] corp\\amy:Winter1 STATUS_ACCOUNT_LOCKED_OUT',
  nodomUser: 'SMB  10.0.0.6 445  WS01  [-] orchard.com\\: STATUS_ACCESS_DENIED',
};

describe('parseNxcAuthResults', () => {
  it('parses admin, valid, failed per line with host, port, domain, user and secret', () => {
    const r = parseNxcAuthResults([L.admin, L.valid, L.era, L.fail, L.winrm, L.sshOk, L.sshBad, L.ftp].join('\n'));
    expect(r).toHaveLength(8);
    expect(r[0]).toMatchObject({ protocol: 'smb', ip: '172.31.162.95', port: 445, hostLabel: 'SRV21', domain: 'vertex.lan', username: 'Liam.Brooks', secret: 'OwlLikesWalking800', result: 'admin' });
    expect(r[1].result).toBe('valid');
    expect(r[2]).toMatchObject({ domain: 'SRV22', username: 'apache', secret: 'Red5Oak2.!', result: 'valid' });
    expect(r[3]).toMatchObject({ secret: 'Red5Oak2.!', result: 'failed' });
    expect(r[4]).toMatchObject({ protocol: 'winrm', port: 5985, result: 'admin', secret: 'Blue7Sky3.!' });
    expect(r[5]).toMatchObject({ protocol: 'ssh', username: 'ronan', secret: 'CopperKite71', result: 'valid' });
    expect(r[5].domain).toBeUndefined();
    expect(r[6].result).toBe('failed');
    expect(r[7]).toMatchObject({ protocol: 'ftp', username: 'anonymous', secret: 'anonymous', result: 'failed' });
  });

  it('ignores lines without a user:secret principal', () => {
    expect(parseNxcAuthResults([L.dump, L.shares, L.nodomUser].join('\n'))).toEqual([]);
  });

  it('ssh banner errors and lockouts are errored with detail, never failed', () => {
    const r = parseNxcAuthResults([L.banner, L.lock].join('\n'));
    expect(r.map(x => x.result)).toEqual(['errored', 'errored']);
    expect(r[0].detail).toContain('Error reading SSH protocol banner');
    expect(r[0].secret).toBe('Summer2024!');
    expect(r[1].detail).toBe('STATUS_ACCOUNT_LOCKED_OUT');
  });

  it("splits user:secret using the command's -p when the secret contains a colon", () => {
    const r = parseNxcAuthResults('SMB  10.0.0.7 445  WS02  [+] corp\\x:pa:ss word (Pwn3d!)', ['pa:ss word']);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ domain: 'corp', username: 'x', secret: 'pa:ss word', result: 'admin' });
  });

  it('error indicators take precedence over failure keywords in compound reasons', () => {
    const r = parseNxcAuthResults('SMB  10.0.0.6 445  WS01  [-] corp\\amy:Winter1 Connection reset by peer, Authentication failed');
    expect(r[0].result).toBe('errored');
    expect(r[0].detail).toContain('Connection reset by peer');
  });

  it('MSSQL and LDAP wrong-credential replies are failed, not errored', () => {
    const r = parseNxcAuthResults([
      "MSSQL  10.10.130.142  1433  MS02  [-] mock.exam\\bob:Pw1 (Login failed for user 'MOCK\\bob'. Please try again with or without '--local-auth')",
      'MSSQL  10.10.130.142  1433  MS02  [-] MS02\\sa:Pw1 (Login failed. The login is from an untrusted domain and cannot be used with Integrated authentication.)',
      'LDAP  10.10.130.140  389  DC01  [-] mock.exam\\bob:Pw1 KDC_ERR_PREAUTH_FAILED',
      'LDAP  10.10.130.140  389  DC01  [-] mock.exam\\ghost:Pw1 KDC_ERR_C_PRINCIPAL_UNKNOWN',
      'LDAP  10.10.130.140  389  DC01  [-] mock.exam\\bob:Pw1 52e',
      'LDAP  10.10.130.140  389  DC01  [-] mock.exam\\bob:Pw1 data 52e, v4563',
    ].join('\n'));
    expect(r.map(x => x.result)).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'failed']);
  });

  it('a revoked (disabled or locked) Kerberos account stays errored', () => {
    const r = parseNxcAuthResults('LDAP  10.10.130.140  389  DC01  [-] mock.exam\\amy:Pw1 KDC_ERR_CLIENT_REVOKED');
    expect(r[0]).toMatchObject({ result: 'errored', detail: 'KDC_ERR_CLIENT_REVOKED' });
  });

  it('treats must-change as valid with detail, and maps LDAPS to ldap', () => {
    const r = parseNxcAuthResults('LDAPS  10.0.0.8 636  DC  [-] corp\\z:Pw1 STATUS_PASSWORD_MUST_CHANGE');
    expect(r[0]).toMatchObject({ protocol: 'ldap', result: 'valid', detail: 'STATUS_PASSWORD_MUST_CHANGE' });
  });

  it('supports user@realm principals', () => {
    const r = parseNxcAuthResults('LDAP  10.0.0.8 389  DC  [+] bob@corp.local:Pw1');
    expect(r[0]).toMatchObject({ username: 'bob', domain: 'corp.local', secret: 'Pw1' });
  });
});

describe('parseRoastHashes', () => {
  it('extracts krb5tgs and krb5asrep hashes with user and domain', () => {
    const tgs = '$krb5tgs$23$*sqlsvc$VERTEX.LAN$vertex.lan/sqlsvc*$abcd1234$ef567890';
    const asrep = '$krb5asrep$23$reid@VERTEX.LAN:aabbcc$ddeeff';
    const out = parseRoastHashes(`LDAP  172.31.162.97  389  DC01  ${tgs}\nLDAP        172.31.162.97  389    DC01             ${asrep}\nnoise`);
    expect(out).toEqual([
      { kind: 'krb5tgs', username: 'sqlsvc', domain: 'VERTEX.LAN', hash: tgs },
      { kind: 'krb5asrep', username: 'reid', domain: 'VERTEX.LAN', hash: asrep },
    ]);
  });
  it('C1: a known secret only matches at a word boundary (a shorter one never steals a longer password)', () => {
    const r = parseNxcAuthResults('SMB 10.0.0.5 445 DC01 [+] corp\\bob:Password1 (Pwn3d!)', ['Pass']);
    expect(r.map(x => [x.secret, x.result])).toEqual([['Password1', 'admin']]);
    const two = parseNxcAuthResults([
      'SMB 10.0.0.5 445 DC01 [-] corp\\bob:Welcome1 STATUS_LOGON_FAILURE',
      'SMB 10.0.0.5 445 DC01 [+] corp\\bob:Welcome1! (Pwn3d!)',
      'SMB 10.0.0.5 445 DC01 [+] corp\\bob:Welcome1',
    ].join('\n'), ['Welcome1']);
    expect(two.map(x => [x.secret, x.result])).toEqual([['Welcome1', 'failed'], ['Welcome1!', 'admin'], ['Welcome1', 'valid']]);
    // a known secret containing a space still wins when it is followed by whitespace or the end
    expect(parseNxcAuthResults('SMB 10.0.0.5 445 DC01 [+] y:pa:ss word (Pwn3d!)', ['pa:ss word'])[0].secret).toBe('pa:ss word');
  });
});
