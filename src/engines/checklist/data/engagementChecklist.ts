import type { ChecklistGoal, PlaybookId } from '../types';

const g = (stage: string, id: string, title: string, why: string, extra: Partial<ChecklistGoal> = {}): ChecklistGoal => ({
  id,
  stage,
  title,
  why,
  ...extra,
});

const WS = 'Workspace';
const NW = 'Network';
const SC = 'Scope';
const KS = 'Kick off scans';

/** Mirrors the vault's Off-the-Bat checklist, group by group. */
export const ENGAGEMENT_SETUP: ChecklistGoal[] = [
  g('e-setup', 'e-setup-logging', 'Session logging on in every tab', 'Every command and its output is evidence; a tab without logging loses it.', { group: WS }),
  g('e-setup', 'e-setup-vpn', 'VPN up; note tun0 as LHOST', 'Every reverse shell and payload needs your tun0 address.', { group: NW }),
  g('e-setup', 'e-setup-reach', 'Confirm you can reach a target', 'No reply is not down (Windows blocks ICMP); no route is a VPN problem.', { group: NW }),
  g('e-setup', 'e-setup-kind', 'Choose the engagement kind', 'Decides whether exam-banned commands are hidden and whether cleanup is required.', { group: SC }),
  g('e-setup', 'e-setup-scope', 'Set the scope', 'Anything outside it is off limits; the log and auto-tick key off it.', { group: SC }),
  g('e-setup', 'e-setup-hosts', 'Add the /etc/hosts lines', 'Half of AD errors are works-with-IP, fails-with-FQDN.', { group: SC }),
  g('e-setup', 'e-setup-clock', 'Sync the clock to the DC', 'KRB_AP_ERR_SKEW is a clock problem, not a bad credential.', { group: SC, applies: { domainJoined: true } }),
  g('e-setup', 'e-setup-exam-rules', 'Note the start time, the Metasploit allowance and the proof rules', 'The clock and the single Metasploit use are the exam constraints you cannot get back.', { group: SC, applies: { kinds: ['exam-sim'] } }),
  g('e-setup', 'e-setup-scans', 'Full TCP and UDP scans running on every host', 'Start them first so they run while you read; SNMP on 161 only shows in UDP.', { group: KS }),
  g('e-setup', 'e-setup-assumed-breach', 'Assumed breach: spray the starting credentials (N/A if none)', 'Starting credentials work somewhere; find where before anything noisier.', { group: KS }),
];

const L = 'e-lat';
const USE = 'Use the credential';

/** Engagement-owned lateral movement steps; the per-host pivot steps live on the `lateral-movement` host stage. */
export const LATERAL_MOVEMENT_GOALS: ChecklistGoal[] = [
  g(L, 'e-lat-spray', 'Spray the credential across every host and service', 'A credential is only tried where you tried it; the matrix shows the gaps.', { group: USE }),
  g(L, 'e-lat-password', 'Log in with the password', 'A plaintext password opens every service the host exposes.', { group: USE }),
  g(L, 'e-lat-hash', 'Pass the hash', 'An NT hash authenticates without cracking it.', { group: USE }),
  g(L, 'e-lat-ticket', 'Use a Kerberos ticket', 'Pass-the-ticket and overpass-the-hash work where NTLM is blocked.', { group: USE }),
  g(L, 'e-lat-record-hop', 'Record the hop: from host, via, to host, access level', 'The hop list is the attack path the report is built from.', { group: 'Land' }),
];

const N = 'e-ad-nocreds';
const U = 'e-ad-user';
const D = 'e-ad-da';

export const AD_PLAYBOOKS: { id: PlaybookId; title: string; opensWhen: string; goals: ChecklistGoal[] }[] = [
  {
    id: 'nocreds',
    title: 'No credentials',
    opensWhen: 'an AD host (88 + 389 open) is in scope and no domain credential has a valid or admin result',
    goals: [
      g(N, `${N}-smb-null`, 'Try null, guest and anonymous SMB', 'Old or misconfigured DCs still answer with users, shares and GPP passwords.'),
      g(N, `${N}-rpc`, 'Try a null RPC session', 'enumdomusers is often the whole user list with no LDAP.'),
      g(N, `${N}-rid`, 'RID cycle for usernames', 'SAMR often stays open when other enumeration is locked down; this is your users.txt.'),
      g(N, `${N}-ldap`, 'Query LDAP anonymously', 'Naming contexts give the DN; descriptions often are the password.'),
      g(N, `${N}-kerbrute`, 'Enumerate usernames with Kerberos', 'Pre-auth tells valid from invalid users without locking accounts.'),
      g(N, `${N}-asrep`, 'AS-REP roast the user list', 'One crackable hash is the first domain credential.'),
      g(N, `${N}-spray`, 'Spray carefully once lockout policy is known', 'user:user and SeasonYear still work; locking accounts fails the exam.'),
      g(N, `${N}-dns`, 'Pull hosts from DNS', 'AXFR lists every hostname and SRV records name the DC.'),
    ],
  },
  {
    id: 'user',
    title: 'First domain user',
    opensWhen: 'the first domain credential has a valid or admin result',
    goals: [
      g(U, `${U}-rid`, 'RID cycle with the credential', 'Finds disabled accounts and service accounts that LDAP searches hide.'),
      g(U, `${U}-users`, 'Dump users, groups and password policy', 'The lockout threshold decides every spray after this.'),
      g(U, `${U}-ldap`, 'Read LDAP descriptions and account flags', 'Passwords in description fields have solved more labs than roasting.'),
      g(U, `${U}-bloodhound`, 'Collect BloodHound and mark the user owned', 'Finds the ACL chain to Domain Admin no human spots in net user.'),
      g(U, `${U}-kerberoast`, 'Kerberoast service accounts', 'Service accounts are frequently weak; any domain user can request the tickets.'),
      g(U, `${U}-asrep`, 'AS-REP roast every user', 'DONT_REQ_PREAUTH is sometimes set where it should not be.'),
      g(U, `${U}-targeted`, 'Targeted Kerberoast where you hold GenericWrite', 'Set an SPN, roast, remove the SPN: a password from a write right.'),
      g(U, `${U}-reuse`, 'Spray the credential across every user', 'Shared passwords are the commonest lateral move; respect the lockout maths.'),
      g(U, `${U}-adcs`, 'Check ADCS for vulnerable templates', 'ESC1 is a two-command path to Domain Admin.'),
      g(U, `${U}-laps`, 'Check whether LAPS passwords are readable', 'Readable ms-Mcs-AdmPwd is local admin on that machine.'),
      g(U, `${U}-delegation`, 'Check delegation and machine account quota', 'Unconstrained, constrained and RBCD are overlooked Domain Admin paths.'),
      g(U, `${U}-gmsa`, 'Read gMSA passwords you are allowed to', 'Group members can read the managed password.'),
      g(U, `${U}-gpp`, 'Search SYSVOL for GPP passwords and scripts', 'Old cpassword entries and startup scripts are world-readable.'),
      g(U, `${U}-dns`, 'Dump AD-integrated DNS', 'Reveals hosts outside the subnet you scanned.'),
      g(U, `${U}-mssql`, 'Check MSSQL servers and linked servers', 'SQL service accounts and trusted links chain to SYSTEM.'),
      g(U, `${U}-relay`, 'Relay and coercion prep (labs only)', 'Exam-banned: every command here (ntlmrelayx, coercion) is off limits in an exam. Only when the steps above are dry and signing is off somewhere.'),
    ],
  },
  {
    id: 'da',
    title: 'Domain admin',
    opensWhen: 'a credential has an admin result on the DC, or a hop to the DC is recorded',
    goals: [
      g(D, `${D}-dcsync`, 'DCSync the domain', 'Every domain hash, including krbtgt, in one command.'),
      g(D, `${D}-proof`, 'Capture proof on the DC', 'The DC screenshot is the finish line for the AD set.'),
    ],
  },
];
