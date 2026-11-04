import type { ChecklistGoal, ChecklistStage, GoalApplies } from '../types';

const WEB: GoalApplies = { ports: [80, 443, 8000, 8080, 8443, 8888, 3000, 5000, 9000], services: ['http'] };
const SMB: GoalApplies = { ports: [139, 445], services: ['smb'] };
const FTP: GoalApplies = { ports: [21], services: ['ftp'] };
const NFS: GoalApplies = { ports: [111, 2049], services: ['nfs'] };
const RPC: GoalApplies = { ports: [135, 111], services: ['rpc'] };
const LDAP: GoalApplies = { ports: [389, 636, 3268], services: ['ldap'] };
const DNS: GoalApplies = { ports: [53], services: ['dns'] };
const SNMP: GoalApplies = { ports: [161], services: ['snmp'] };
const SMTP: GoalApplies = { ports: [25, 465, 587], services: ['smtp'] };
const DB: GoalApplies = {
  ports: [1433, 1521, 3306, 5432, 6379, 27017, 5984, 9200],
  services: ['mssql', 'oracle', 'mysql', 'postgresql', 'redis', 'mongodb'],
};
const REMOTE: GoalApplies = { ports: [22, 3389, 5985, 5986, 5900], services: ['ssh', 'rdp', 'winrm', 'vnc'] };
/** Services that take a credential and hand back a session: SSH, SMB exec, RDP, WinRM, MSSQL. */
const CRED_LOGIN: GoalApplies = { ports: [22, 139, 445, 1433, 3389, 5985, 5986], services: ['ssh', 'smb', 'rdp', 'winrm', 'mssql'] };
/**
 * Services whose misconfiguration runs code or writes files: MSSQL, PostgreSQL, Redis, MySQL, writable shares, FTP
 * and NFS on 2049 (rpcbind on 111 alone is not NFS).
 */
const MISCONFIG: GoalApplies = {
  ports: [1433, 5432, 6379, 3306, 139, 445, 21, 2049],
  services: ['mssql', 'postgresql', 'redis', 'mysql', 'smb', 'ftp', 'nfs'],
};
/** Login services worth guessing against. */
const BRUTE: GoalApplies = { ports: [21, 22, 445, 1433, 3389, 5985], services: ['ftp', 'ssh', 'smb', 'mssql', 'rdp', 'winrm'] };
/** ports: [] = any known open port (the host has been scanned). */
const SCANNED: GoalApplies = { ports: [] };
const LIN: GoalApplies = { os: ['linux'] };
const WIN: GoalApplies = { os: ['windows'] };

const g = (
  stage: string,
  id: string,
  title: string,
  why: string,
  applies?: GoalApplies,
): ChecklistGoal => ({
  id,
  stage,
  title,
  why,
  ...(applies ? { applies } : {}),
});

const enumerate: ChecklistGoal[] = [
  g('enumerate', 'h-enum-full-tcp', 'Scan all 65,535 TCP ports', 'The quick scan misses high ports; one forgotten port is the usual way in.'),
  g('enumerate', 'h-enum-udp', 'Scan the top UDP ports', 'SNMP, TFTP and DNS live on UDP and nobody checks them.'),
  g('enumerate', 'h-enum-versions', 'Get service versions and run default scripts', 'Versions feed the exploit search; scripts catch anonymous access for free.'),
  g('enumerate', 'h-enum-exploits', 'Search public exploits for every version found', 'Decides whether to go straight to an exploit or keep enumerating.', SCANNED),
  g('enumerate', 'h-enum-web-stack', 'Identify the web stack and framework', 'Tells you which CMS exploits and wordlists are worth the time.', WEB),
  g('enumerate', 'h-enum-web-content', 'Find hidden web content and API routes', 'Admin panels, backups and APIs are rarely linked from the front page.', WEB),
  g('enumerate', 'h-enum-web-vhosts', 'Look for virtual hosts and subdomains', 'A second vhost on the same IP is often the real application.', WEB),
  g('enumerate', 'h-enum-web-source', 'Read page source, comments and metadata', 'Usernames, internal paths and versions leak in the HTML.', WEB),
  g('enumerate', 'h-enum-smb', 'Check SMB shares and null/guest access', 'Readable shares are the cheapest source of files, users and credentials.', SMB),
  g('enumerate', 'h-enum-ftp', 'Check FTP for anonymous access', 'Anonymous FTP often exposes web roots and config files.', FTP),
  g('enumerate', 'h-enum-nfs', 'List NFS exports and try mounting them', 'A world-mountable export can hand over home directories or SSH keys.', NFS),
  g('enumerate', 'h-enum-rpc', 'Enumerate RPC for users and shares', 'Null RPC can return the whole user list.', RPC),
  g('enumerate', 'h-enum-ldap', 'Query LDAP anonymously', 'Naming contexts, users and description fields often hold passwords.', LDAP),
  g('enumerate', 'h-enum-dns', 'Try a DNS zone transfer and resolve hostnames', 'AXFR dumps every hostname; SRV records name the DC.', DNS),
  g('enumerate', 'h-enum-snmp', 'Walk SNMP with common community strings', 'public/private leaks users, processes and sometimes credentials.', SNMP),
  g('enumerate', 'h-enum-smtp', 'Enumerate SMTP users', 'VRFY/RCPT confirms valid usernames for later attacks.', SMTP),
  g('enumerate', 'h-enum-db', 'Check databases for default or unauthenticated access', 'Default accounts and open Redis skip the whole foothold hunt.', DB),
  g('enumerate', 'h-enum-remote', 'Check remote-access services and auth methods', 'Decides where captured credentials get tried first.', REMOTE),
];

const foothold: ChecklistGoal[] = [
  g('foothold', 'h-foot-creds', 'Log in with a credential you hold', 'Every credential found so far is tried on every login service first: it is the cheapest way in.', CRED_LOGIN),
  g('foothold', 'h-foot-exploit', 'Run a public exploit against a vulnerable service', 'A version with a working public exploit is a shell; read the code before running it.', SCANNED),
  g('foothold', 'h-foot-service', 'Turn a misconfigured service into code execution', 'Database command execution, a writable share in the web root, NFS or open Redis run your code without an exploit.', MISCONFIG),
  g('foothold', 'h-foot-web-auth', 'Try web logins and default credentials', 'Default creds on a panel are the fastest foothold.', WEB),
  g('foothold', 'h-foot-web-vulns', 'Test the web app for injection and upload flaws', 'Decides whether the web app yields code execution.', WEB),
  g('foothold', 'h-foot-brute', 'Guess or spray logins on exposed services (last resort)', 'Last resort: slow, noisy and can lock accounts; only with known usernames and a short list.', BRUTE),
  g('foothold', 'h-foot-payload', 'Build and deliver a payload', 'Whatever route runs code needs a payload that calls back and a way to get it onto the host.'),
  g('foothold', 'h-foot-shell', 'Catch the shell', 'Start the listener before sending the payload; everything after this stage needs a shell.'),
  g('foothold', 'h-foot-arrived', 'Record how you arrived on this host', 'The hop chain is what the report and the stuck check are built from.'),
];

const stabilize: ChecklistGoal[] = [
  g('stabilize', 'h-stab-shell', 'Upgrade to a stable interactive shell', 'Proof only counts from an interactive shell, and a dropped or dumb shell wastes the privesc time.'),
];

const orient: ChecklistGoal[] = [
  g('orient', 'h-orient-identity', 'Check identity, privileges and groups', 'Tells you who you are and which privesc list to start with.'),
  g('orient', 'h-orient-network', 'Check interfaces and routes', 'A second interface means a pivot; flag the host dual-homed.'),
  g(
    'orient',
    'h-orient-proof',
    'Capture local.txt with proof in one frame',
    'From the stabilized interactive shell (web-shell proof does not count): local.txt or user.txt plus whoami, hostname and IP in one command. Take it even when the host has no local flag: it is the proof of access.',
  ),
];

const privesc: ChecklistGoal[] = [
  // Windows, cheapest and most likely first, kernel last.
  g('privesc', 'h-pe-win-privs', 'Check token privileges for potato attacks', 'SeImpersonate on a service account is an instant SYSTEM.', WIN),
  g('privesc', 'h-pe-win-groups', 'Check privileged group membership', 'Backup Operators, DnsAdmins and friends are a direct path to SYSTEM.', WIN),
  g('privesc', 'h-pe-win-stored', 'Hunt stored credentials', 'cmdkey, autologon, unattend files and PS history hand out passwords.', WIN),
  g('privesc', 'h-pe-win-services', 'Check services and paths you can abuse', 'Unquoted paths and weak service ACLs run your code as SYSTEM.', WIN),
  g('privesc', 'h-pe-win-tasks', 'Check scheduled tasks', 'A writable task script runs as whoever owns the task.', WIN),
  g('privesc', 'h-pe-win-registry', 'Check AlwaysInstallElevated and registry weaknesses', 'Two registry keys can mean SYSTEM from any MSI.', WIN),
  g('privesc', 'h-pe-win-auto', 'Run an automated enumeration sweep', 'Catches what the manual checks missed.', WIN),
  g('privesc', 'h-pe-win-kernel', 'Check for a kernel exploit', 'Last resort: noisy and can crash the box.', WIN),
  // Linux
  g('privesc', 'h-pe-lin-sudo', 'Check sudo rights', 'sudo -l is the most common single-step root.', LIN),
  g('privesc', 'h-pe-lin-suid', 'Check SUID and SGID binaries', 'A GTFOBins-listed SUID binary is root.', LIN),
  g('privesc', 'h-pe-lin-caps', 'Check file capabilities', 'cap_setuid on an interpreter is root.', LIN),
  g('privesc', 'h-pe-lin-cron', 'Check cron jobs and timers', 'A writable script run by root is root.', LIN),
  g('privesc', 'h-pe-lin-writable', 'Check writable files and PATH hijacks', 'Writable configs and scripts that root executes.', LIN),
  g('privesc', 'h-pe-lin-internal', 'Check internal-only services', 'Localhost services often run as root with weak auth.', LIN),
  g('privesc', 'h-pe-lin-auto', 'Run an automated enumeration sweep', 'Catches what the manual checks missed.', LIN),
  g('privesc', 'h-pe-lin-kernel', 'Check for a kernel exploit', 'Last resort: noisy and can crash the box.', LIN),
  // Both: the stage ends with the proof.
  g(
    'privesc',
    'h-pe-proof',
    'Capture proof.txt as root/SYSTEM in one frame',
    'proof.txt (or root.txt) plus whoami, hostname and IP in one command from the root/SYSTEM shell: points only count with that frame.',
    { os: ['linux', 'windows'] },
  ),
];

const loot: ChecklistGoal[] = [
  g('loot', 'h-loot-hashes', 'Dump hashes and secrets from the OS store', 'Every hash is a candidate for reuse on the next host.'),
  g('loot', 'h-loot-sweep', 'Sweep files for credentials and secrets', 'Configs, histories, .kdbx and windows.old routinely hold passwords.'),
  g('loot', 'h-loot-domain', 'Collect domain material from this host', 'Cached creds and tickets on a joined host can be the way to the domain.', { os: ['windows'], domainJoined: true }),
  g('loot', 'h-loot-record', 'Record every new credential and username', 'Unrecorded creds never get sprayed or tried on other hosts.'),
];

const pivot: ChecklistGoal[] = [
  g('pivot', 'h-pivot-tunnel', 'Tunnel into the next network', 'Nothing past this host is reachable without it.', { dualHomed: true }),
  g('pivot', 'h-pivot-sweep', 'Sweep the new network for hosts', 'New hosts go back through Enumerate.', { dualHomed: true }),
];

const closeout: ChecklistGoal[] = [
  g('closeout', 'h-close-cleanup', 'Remove the tools you uploaded', 'On a real engagement you leave nothing behind.', { kinds: ['client'] }),
  g('closeout', 'h-close-notes', 'Write the host notes', 'Notes written now save the report from guesswork.'),
];

export const HOST_STAGES: ChecklistStage[] = [
  { id: 'enumerate', title: 'Enumerate', goals: enumerate, emptyHint: 'Import a scan to see service steps' },
  { id: 'foothold', title: 'Foothold', goals: foothold },
  { id: 'stabilize', title: 'Stabilize', goals: stabilize },
  { id: 'orient', title: 'Proof & orientation', goals: orient },
  { id: 'privesc', title: 'Privesc', goals: privesc, emptyHint: 'Set the OS to see privesc steps' },
  { id: 'loot', title: 'Loot', goals: loot },
  { id: 'pivot', title: 'Pivot', goals: pivot },
  { id: 'closeout', title: 'Closeout', goals: closeout },
];

export const HOST_GOALS: ChecklistGoal[] = HOST_STAGES.flatMap((s) => s.goals);
