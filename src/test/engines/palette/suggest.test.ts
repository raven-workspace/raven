import { describe, expect, it } from 'vitest';
import { tokenSuggestions, type SuggestContext } from '../../../features/palette/suggest';
import type { Host } from '../../../types/host';
import type { Service } from '../../../types/service';
import type { Engagement } from '../../../types/engagement';
import type { Credential } from '../../../types/credentials';

const host = (p: Partial<Host>): Host => ({
  id: 'h', engagementId: 'e1', name: 'x', ip: null, os: 'windows', boardColumn: 'information-gathering', boardManual: false, access: 'none',
  createdAt: 0, updatedAt: 0, dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false, ...p,
});
let n = 0;
const svc = (hostId: string, port: number, nmapService: string | null = null): Service => ({
  id: `s${n++}`, hostId, port, protocol: 'tcp', state: 'open', nmapService, nmapVersion: null, confirmedProduct: null, confirmedVersion: null,
  confirmedEntryId: null, createdAt: 0, updatedAt: 0,
});
const eng = { id: 'e1', domain: 'corp.local' } as Engagement;
const dc = host({ id: 'dc', name: 'dc01', ip: '10.0.0.10' });
const ms = host({ id: 'ms', name: 'ms01', ip: '10.0.0.11' });
const ctx: SuggestContext = {
  engagement: eng, hosts: [ms, dc], host: ms, toolkit: [],
  services: [svc('dc', 88), svc('dc', 389), svc('ms', 445, 'microsoft-ds'), svc('ms', 80, 'http')],
  credentials: [{ username: 'alice', domain: 'CORP', secret: 'Winter2024!' } as Credential, { username: '', domain: null, secret: 'x' } as Credential],
};
const values = (t: string) => tokenSuggestions(t, ctx).map((s) => s.value);

describe('tokenSuggestions', () => {
  it('offers usernames, never secrets or ownerless blanks', () => {
    expect(values('USER')).toEqual(['alice']);
    expect(JSON.stringify(tokenSuggestions('USER', ctx))).not.toContain('Winter2024!');
  });
  it('offers the DC first for DC_IP, then other hosts', () => expect(values('DC_IP')).toEqual(['10.0.0.10', '10.0.0.11']));
  it('offers host IPs and FQDNs', () => {
    expect(values('TARGET_IP')).toEqual(['10.0.0.11', '10.0.0.10']);
    expect(values('DC_HOST')).toEqual(['ms01.corp.local', 'ms01', 'dc01.corp.local', 'dc01']);
  });
  it("offers the host's open ports for PORT, not for LPORT", () => {
    expect(values('PORT')).toEqual(['80', '445']);
    expect(values('LPORT')).toEqual([]);
  });
  it('offers the domain', () => expect(values('DOMAIN')).toEqual(['corp.local', 'CORP']));
  it('offers nothing for unknown tokens', () => expect(values('COMMUNITY')).toEqual([]));
});
