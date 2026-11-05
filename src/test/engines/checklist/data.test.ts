import { describe, it, expect } from 'vitest';
import { AD_PLAYBOOKS, ENGAGEMENT_SETUP, HOST_GOALS, HOST_STAGES, LATERAL_MOVEMENT_GOALS } from '../../../engines/checklist';
import { FACT_GOALS } from '../../../engines/checklist/data/hostChecklist';

const ENGAGEMENT_GOALS = [...ENGAGEMENT_SETUP, ...LATERAL_MOVEMENT_GOALS, ...AD_PLAYBOOKS.flatMap((p) => p.goals)];
const STAGE_IDS = [
  'information-gathering', 'vulnerability-detection', 'initial-foothold', 'privilege-escalation', 'post-exploitation', 'reporting',
  'lateral-movement',
];

/** Every goal id that existed before the PEN-200 restructure. None may be renamed or removed. */
const PRE_RESTRUCTURE_HOST_IDS = [
  'h-close-cleanup', 'h-close-notes', 'h-enum-db', 'h-enum-dns', 'h-enum-exploits', 'h-enum-ftp', 'h-enum-full-tcp', 'h-enum-ldap',
  'h-enum-nfs', 'h-enum-remote', 'h-enum-rpc', 'h-enum-smb', 'h-enum-smtp', 'h-enum-snmp', 'h-enum-udp', 'h-enum-versions',
  'h-enum-web-content', 'h-enum-web-source', 'h-enum-web-stack', 'h-enum-web-vhosts', 'h-foot-arrived', 'h-foot-brute',
  'h-foot-creds', 'h-foot-exploit', 'h-foot-payload', 'h-foot-service', 'h-foot-shell', 'h-foot-web-auth', 'h-foot-web-vulns',
  'h-loot-domain', 'h-loot-hashes', 'h-loot-record', 'h-loot-sweep', 'h-orient-identity', 'h-orient-network', 'h-orient-proof',
  'h-pe-lin-auto', 'h-pe-lin-caps', 'h-pe-lin-cron', 'h-pe-lin-internal', 'h-pe-lin-kernel', 'h-pe-lin-sudo', 'h-pe-lin-suid',
  'h-pe-lin-writable', 'h-pe-proof', 'h-pe-win-auto', 'h-pe-win-groups', 'h-pe-win-kernel', 'h-pe-win-privs', 'h-pe-win-registry',
  'h-pe-win-services', 'h-pe-win-stored', 'h-pe-win-tasks', 'h-pivot-sweep', 'h-pivot-tunnel', 'h-stab-shell',
];
const PRE_RESTRUCTURE_ENGAGEMENT_IDS = [
  'e-setup-kind', 'e-setup-scope', 'e-setup-hosts', 'e-setup-clock',
  ...['smb-null', 'rpc', 'rid', 'ldap', 'kerbrute', 'asrep', 'spray', 'dns'].map((s) => `e-ad-nocreds-${s}`),
  ...['rid', 'users', 'ldap', 'bloodhound', 'kerberoast', 'asrep', 'targeted', 'reuse', 'adcs', 'laps', 'delegation', 'gmsa', 'gpp', 'dns', 'mssql', 'relay']
    .map((s) => `e-ad-user-${s}`),
  'e-ad-da-dcsync', 'e-ad-da-proof',
];

describe('checklist data', () => {
  it('every pre-restructure goal id still exists', () => {
    const have = new Set([...HOST_GOALS, ...ENGAGEMENT_GOALS].map((g) => g.id));
    expect([...PRE_RESTRUCTURE_HOST_IDS, ...PRE_RESTRUCTURE_ENGAGEMENT_IDS].filter((id) => !have.has(id))).toEqual([]);
  });

  it('stage ids and order', () => {
    expect(HOST_STAGES.map((s) => s.id)).toEqual(STAGE_IDS);
    expect(HOST_STAGES.map((s) => s.title)).toEqual([
      'Information gathering', 'Vulnerability detection', 'Initial foothold', 'Privilege escalation', 'Post-exploitation', 'Reporting',
      'Lateral movement',
    ]);
    expect(HOST_STAGES.filter((s) => s.placement === 'engagement').map((s) => s.id)).toEqual(['lateral-movement']);
    for (const g of HOST_GOALS) expect(STAGE_IDS, g.id).toContain(g.stage);
  });

  it('goal ids are unique across host and engagement data', () => {
    const ids = [...HOST_GOALS, ...ENGAGEMENT_GOALS].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every goal in a stage with groups has a group', () => {
    for (const s of HOST_STAGES) {
      if (!s.goals.some((g) => g.group)) continue;
      expect(s.goals.filter((g) => !g.group).map((g) => g.id), s.id).toEqual([]);
    }
    expect(HOST_STAGES.find((s) => s.id === 'information-gathering')!.goals.every((g) => g.group)).toBe(true);
  });

  it('each goal sits in the stage it was moved to', () => {
    const stageOf = (id: string) => HOST_GOALS.find((g) => g.id === id)?.stage;
    expect(stageOf('h-orient-proof')).toBe('initial-foothold');
    expect(stageOf('h-orient-network')).toBe('post-exploitation');
    expect(stageOf('h-enum-exploits')).toBe('vulnerability-detection');
  });

  it('exports the fact goals', () => {
    expect([...FACT_GOALS]).toEqual(['h-enum-identified', 'h-enum-os']);
  });

  it('no kinds names challenge-lab or real', () => {
    const kinds = [...HOST_GOALS, ...ENGAGEMENT_GOALS].flatMap((g) => g.applies?.kinds ?? []) as string[];
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain('challenge-lab');
    expect(kinds).not.toContain('real');
    for (const k of kinds) expect(['exam-sim', 'lab', 'client']).toContain(k);
  });
});
