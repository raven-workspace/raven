import { describe, it, expect } from 'vitest';
import { identifyHash, getCrackingCommands, HashCandidate } from '../../../engines/credentials/hashes';

function top(input: string, hint?: 'windows' | 'linux' | 'web'): HashCandidate | undefined {
  return identifyHash(input, hint)[0];
}

describe('identifyHash - table-driven', () => {
  const cases: { label: string; input: string; expectedName: string; expectedMode: number | null; hint?: 'windows' | 'linux' | 'web' }[] = [
    { label: 'MD5', input: '5d41402abc4b2a76b9719d911017c592', expectedName: 'MD5', expectedMode: 0 },
    { label: 'SHA1', input: 'b89eaac7e61417341b710b727768294d0e6a277b', expectedName: 'SHA1', expectedMode: 100 },
    { label: 'SHA256', input: '127e6fbfe24a750e72930c220a8e138275656b8e5d8f48a98c3c92df2caba935', expectedName: 'SHA256', expectedMode: 1400 },
    { label: 'SHA512', input: '82a9dda829eb7f8ffe9fbe49e45d47d2dad9664fbb7adf72492e3c81ebd3e29134d9bc12212bf83c6840f10e8246b9db54a4859b7ccd0123d86e5872c1e5082f', expectedName: 'SHA512', expectedMode: 1700 },
    { label: 'NetNTLMv1', input: 'u4-netntlm::kNS:338d08f8e26de934:9526fb8c23a90751cdd619b6cea564742e1e4bf33006ba1d:1122334455667788', expectedName: 'NetNTLMv1', expectedMode: 5500 },
    { label: 'NetNTLMv2', input: 'admin::N46iSNekpT:08ca45b7d7ea58ee:88dcbe4446168966a153a0064958dac6:5c7830315c7830310000000000000b45c67103d07d7b95acd12ffa11230e0000000000000000400000000000000065', expectedName: 'NetNTLMv2', expectedMode: 5600 },
    { label: 'Kerberos AS-REP (etype 23, RC4)', input: '$krb5asrep$23$user@REALM.COM:a93c3a9e6f0e8e0e5c3a9e6f0e8e0e5c$9f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e', expectedName: 'Kerberos AS-REP (etype 23, RC4)', expectedMode: 18200 },
    { label: 'Kerberos AS-REP (etype 17, AES, unconfirmed mode)', input: '$krb5asrep$17$user@REALM.COM:a93c3a9e6f0e8e0e5c3a9e6f0e8e0e5c$9f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e', expectedName: 'Kerberos AS-REP (etype 17, AES)', expectedMode: null },
    { label: 'Kerberos AS-REP (etype 18, AES, unconfirmed mode)', input: '$krb5asrep$18$user@REALM.COM:a93c3a9e6f0e8e0e5c3a9e6f0e8e0e5c$9f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e', expectedName: 'Kerberos AS-REP (etype 18, AES)', expectedMode: null },
    { label: 'Kerberoast TGS (etype 23, RC4)', input: '$krb5tgs$23$*user$REALM.COM$test/spn*$7e0bb562a1d50f0e8e0e5c3a9e6f0e8e$0e5c3a9e6f0e8e0e5c3a9e6f0e8e0e5c', expectedName: 'Kerberoast TGS-REP (etype 23, RC4)', expectedMode: 13100 },
    { label: 'Kerberos TGS (etype 17, AES128)', input: '$krb5tgs$17$user$REALM.COM$test/spn$7e0bb562a1d50f0e8e0e5c3a9e6f0e8e', expectedName: 'Kerberos TGS-REP (etype 17, AES128)', expectedMode: 19600 },
    { label: 'Kerberos TGS (etype 18, AES256)', input: '$krb5tgs$18$user$REALM.COM$test/spn$7e0bb562a1d50f0e8e0e5c3a9e6f0e8e', expectedName: 'Kerberos TGS-REP (etype 18, AES256)', expectedMode: 19700 },
    { label: 'bcrypt', input: '$2a$05$LhayLxezLhK1LhWvKxCyLOj0j1u.Kj0jZ0pEmm134uzrQlFvQJLF6', expectedName: 'bcrypt', expectedMode: 3200 },
    { label: 'sha512crypt', input: '$6$52450745$k5ka2p8bFuSmoVT1tzOyyuaREkkKBcCNqoDKzYiJL9RaE8yMnPgh2XzzF0NDrUhgrcLwg78xs1w5pJiypEdFX/', expectedName: 'sha512crypt', expectedMode: 1800 },
    { label: 'sha256crypt', input: '$5$rounds=5000$GX7BopJZJxPt/qV9$g.RLhE0pQanEJWqyCU4Fxw16A1HdLSK1TTz3L0qtS47', expectedName: 'sha256crypt', expectedMode: 7400 },
    { label: 'md5crypt', input: '$1$28772684$iEwNOgGugqO9.bIz5sk8k/', expectedName: 'md5crypt', expectedMode: 500 },
    { label: 'DCC2', input: '$DCC2$10240#test1#e4e938d12fe5974dc42a90120bd9c90f', expectedName: 'DCC2 (mscash2)', expectedMode: 2100 },
    { label: 'pwdump LM:NT', input: 'admin:1001:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::', expectedName: 'pwdump (LM:NT)', expectedMode: 1000 },
    { label: 'Django pbkdf2_sha256', input: 'pbkdf2_sha256$20000$XMlmAlk8Agxr$Ww8EByrnw7ZqGwc2Yp9prpcpCJHIh/mDnC+/CJfYI40=', expectedName: 'Django pbkdf2_sha256', expectedMode: 10000 },
    { label: 'MySQL 4.1+', input: '*94BDCEBE19083CE2A1F959FD02F964C7AF4CFC29', expectedName: 'MySQL 4.1+', expectedMode: 300 },
    { label: 'yescrypt', input: '$y$j9T$abcdefghijklmnopqrstuv$WxR4G0XKsZ8pQ1b2c3d4e5f6g7h8i9j0k1l2m3n4o5', expectedName: 'yescrypt', expectedMode: null },
  ];

  for (const c of cases) {
    it(`identifies ${c.label}`, () => {
      const result = top(c.input, c.hint);
      expect(result?.name).toBe(c.expectedName);
      expect(result?.hashcatMode).toBe(c.expectedMode);
    });
  }

  it('returns [] for unknown input', () => {
    expect(identifyHash('not-a-hash-at-all!!')).toEqual([]);
  });

  it('returns [] for empty/whitespace input', () => {
    expect(identifyHash('   ')).toEqual([]);
  });

  it('trims surrounding whitespace before identifying', () => {
    const result = top('  5d41402abc4b2a76b9719d911017c592  ');
    expect(result?.name).toBe('MD5');
  });

  it('yescrypt has no hashcat mode and john format crypt', () => {
    const result = top('$y$j9T$abcdefghijklmnopqrstuv$WxR4G0XKsZ8pQ1b2c3d4e5f6g7h8i9j0k1l2m3n4o5');
    expect(result?.hashcatMode).toBeNull();
    expect(result?.johnFormat).toBe('crypt');
  });
});

describe('identifyHash - 32-hex ambiguity (MD5 vs NTLM)', () => {
  const hex32 = '5d41402abc4b2a76b9719d911017c592';

  it('returns both MD5 and NTLM candidates with no hint, MD5 first', () => {
    const candidates = identifyHash(hex32);
    expect(candidates.map((c) => c.name)).toEqual(['MD5', 'NTLM']);
  });

  it('returns NTLM first when hint is windows', () => {
    const candidates = identifyHash(hex32, 'windows');
    expect(candidates.map((c) => c.name)).toEqual(['NTLM', 'MD5']);
    expect(candidates[0].hashcatMode).toBe(1000);
  });

  it('keeps MD5 first for linux/web hints', () => {
    expect(identifyHash(hex32, 'linux').map((c) => c.name)).toEqual(['MD5', 'NTLM']);
    expect(identifyHash(hex32, 'web').map((c) => c.name)).toEqual(['MD5', 'NTLM']);
  });
});

describe('getCrackingCommands', () => {
  it('generates exact hashcat and john commands for MD5/NTLM', () => {
    const cmds = getCrackingCommands('5d41402abc4b2a76b9719d911017c592');
    expect(cmds.hashcat).toBe("hashcat -m 0 '5d41402abc4b2a76b9719d911017c592' /usr/share/wordlists/rockyou.txt");
    expect(cmds.john).toBe('john --format=raw-md5 hash.txt --wordlist=/usr/share/wordlists/rockyou.txt');
  });

  it('generates hashcat command for SHA256', () => {
    const cmds = getCrackingCommands('127e6fbfe24a750e72930c220a8e138275656b8e5d8f48a98c3c92df2caba935');
    expect(cmds.hashcat).toContain('hashcat -m 1400');
    expect(cmds.john).toContain('john --format=raw-sha256');
  });

  it('handles unknown input gracefully', () => {
    const cmds = getCrackingCommands('not-a-hash');
    expect(cmds).toEqual({});
  });

  it('rejects oversized inputs (>4096 chars) gracefully without crashing', () => {
    const huge = 'a'.repeat(5000);
    expect(identifyHash(huge)).toEqual([]);
    expect(getCrackingCommands(huge)).toEqual({});
  });
});
