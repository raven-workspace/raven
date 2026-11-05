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
const SSH: GoalApplies = { ports: [22], services: ['ssh'] };
const KERBEROS: GoalApplies = { ports: [88], services: ['kerberos', 'kerberos-sec'] };
const MAIL: GoalApplies = { ports: [110, 143, 993, 995], services: ['pop3', 'imap', 'pop3s', 'imaps'] };
const TFTP: GoalApplies = { ports: [69], services: ['tftp'] };
const RSYNC: GoalApplies = { ports: [873], services: ['rsync'] };
const DOCKER: GoalApplies = { ports: [2375, 2376], services: ['docker'] };
const TOMCAT: GoalApplies = { ports: [8080], services: ['tomcat', 'jenkins', 'nifi'] };
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
  group: string | undefined,
  id: string,
  title: string,
  why: string,
  applies?: GoalApplies,
): ChecklistGoal => ({
  id,
  stage,
  title,
  why,
  ...(group ? { group } : {}),
  ...(applies ? { applies } : {}),
});

const IG = 'information-gathering';
const VD = 'vulnerability-detection';
const IF = 'initial-foothold';
const PE = 'privilege-escalation';
const PX = 'post-exploitation';
const RP = 'reporting';
const LM = 'lateral-movement';

/** Goals whose answer the app can read from the host's own data (confirmed services, OS). */
export const FACT_GOALS = ['h-enum-identified', 'h-enum-os'] as const;

const informationGathering: ChecklistGoal[] = [
  g(IG, 'Every host', 'h-enum-full-tcp', 'Scan all 65,535 TCP ports', 'The quick scan misses high ports; one forgotten port is the usual way in.'),
  g(IG, 'Every host', 'h-enum-versions', '-sV -sC on just the open ports', 'Versions feed the exploit search; scripts catch anonymous access for free.'),
  g(IG, 'Every host', 'h-enum-udp', 'Scan the top UDP ports', 'SNMP, TFTP and DNS live on UDP and nobody checks them.'),
  g(IG, 'Every host', 'h-enum-identified', 'Every port has a confirmed product and version', 'A port left as ? or tcpwrapped is a service you have not looked at.', SCANNED),
  g(IG, 'Every host', 'h-enum-os', 'OS identified (TTL, SMB, banners)', 'The OS decides which privesc list, payload and tools apply.', SCANNED),
  g(IG, 'Per service', 'h-enum-ftp', 'Check FTP for anonymous access', 'Anonymous FTP often exposes web roots and config files.', FTP),
  g(IG, 'Per service', 'h-enum-ssh', 'Enumerate SSH: version, auth methods, keys', 'The banner dates the OS and the auth methods tell you whether a key or password is worth hunting.', SSH),
  g(IG, 'Per service', 'h-enum-smtp', 'Enumerate SMTP users', 'VRFY/RCPT confirms valid usernames for later attacks.', SMTP),
  g(IG, 'Per service', 'h-enum-dns', 'Try a DNS zone transfer and resolve hostnames', 'AXFR dumps every hostname; SRV records name the DC.', DNS),
  g(IG, 'Per service', 'h-enum-web-stack', 'Identify the web stack and framework', 'Tells you which CMS exploits and wordlists are worth the time.', WEB),
  g(IG, 'Per service', 'h-enum-web-content', 'Find hidden web content and API routes', 'Admin panels, backups and APIs are rarely linked from the front page.', WEB),
  g(IG, 'Per service', 'h-enum-web-vhosts', 'Look for virtual hosts and subdomains', 'A second vhost on the same IP is often the real application.', WEB),
  g(IG, 'Per service', 'h-enum-web-source', 'Read page source, comments and metadata', 'Usernames, internal paths and versions leak in the HTML.', WEB),
  g(IG, 'Per service', 'h-enum-kerberos', 'Enumerate Kerberos: realm and valid usernames', 'Port 88 means a domain controller, and pre-auth tells valid users from invalid ones.', KERBEROS),
  g(IG, 'Per service', 'h-enum-rpc', 'Enumerate RPC for users and shares', 'Null RPC can return the whole user list.', RPC),
  g(IG, 'Per service', 'h-enum-smb', 'Check SMB shares and null/guest access', 'Readable shares are the cheapest source of files, users and credentials.', SMB),
  g(IG, 'Per service', 'h-enum-snmp', 'Walk SNMP with common community strings', 'public/private leaks users, processes and sometimes credentials.', SNMP),
  g(IG, 'Per service', 'h-enum-ldap', 'Query LDAP anonymously', 'Naming contexts, users and description fields often hold passwords.', LDAP),
  g(IG, 'Per service', 'h-enum-db', 'Check databases for default or unauthenticated access', 'Default accounts and open Redis skip the whole foothold hunt.', DB),
  g(IG, 'Per service', 'h-enum-nfs', 'List NFS exports and try mounting them', 'A world-mountable export can hand over home directories or SSH keys.', NFS),
  g(IG, 'Per service', 'h-enum-remote', 'Check remote-access services and auth methods', 'Decides where captured credentials get tried first.', REMOTE),
  g(IG, 'Per service', 'h-enum-mail', 'Enumerate POP3/IMAP: banner, login, mailboxes', 'Mailboxes hold passwords and tell you who works there.', MAIL),
  g(IG, 'Per service', 'h-enum-tftp', 'Check TFTP for readable config files', 'TFTP has no auth, so any file you can name you can read.', TFTP),
  g(IG, 'Per service', 'h-enum-rsync', 'List rsync modules and pull what you can read', 'An open module is a file share with no password.', RSYNC),
  g(IG, 'Per service', 'h-enum-docker', 'Check the Docker API for unauthenticated access', 'An open Docker API is root on the host.', DOCKER),
  g(IG, 'Per service', 'h-enum-tomcat', 'Tomcat / Jenkins / NiFi', 'These management consoles often run code for anyone who logs in, and ship with default credentials.', TOMCAT),
  g(IG, "If there's a domain", 'h-enum-ad-users', 'Usernames from every source into users.txt', 'Every later spray and roast starts from this list.', { domainJoined: true }),
];

const vulnerabilityDetection: ChecklistGoal[] = [
  g(VD, 'Every product and version', 'h-enum-exploits', 'searchsploit every product and version', 'Decides whether to go straight to an exploit or keep enumerating.', SCANNED),
  g(VD, 'Every product and version', 'h-vuln-websearch', 'Web search for exploits and PoCs', 'Searchsploit misses recent CVEs and GitHub proofs of concept.', SCANNED),
  g(VD, 'Every product and version', 'h-vuln-version-gate', "Check the exploit's version gate against the real version", 'An exploit that wrongly treats your version as patched is a missed way in.', SCANNED),
  g(VD, 'Every product and version', 'h-foot-web-auth', 'Default credentials for the product and its logins', 'Default creds on a panel are the fastest foothold.', WEB),
  g(VD, 'Every product and version', 'h-vuln-nse', 'Targeted NSE vuln scripts', 'A script aimed at one service finds what the default scan does not run.', SCANNED),
  g(VD, 'Web apps', 'h-foot-web-vulns', 'Test the web app for injection and upload flaws', 'Decides whether the web app yields code execution.', WEB),
  g(VD, 'Credentials as a vulnerability', 'h-vuln-spray', 'Spray usernames and found passwords across every login surface', 'A credential from one service is the commonest way into another.', CRED_LOGIN),
  g(VD, 'Credentials as a vulnerability', 'h-vuln-crack', 'Crack the hashes you hold', 'An uncracked hash is a credential you have not used yet.'),
  g(VD, 'Credentials as a vulnerability', 'h-foot-brute', 'Guess or spray logins on exposed services (last resort)', 'Last resort: slow, noisy and can lock accounts; only with known usernames and a short list.', BRUTE),
  g(VD, 'Rank', 'h-vuln-rank', 'Order the candidates', 'Unauthenticated RCE first, then authenticated RCE, file read/write, and info leaks last.', SCANNED),
  g(VD, 'Rank', 'h-vuln-msf', 'Exam: decide whether a candidate needs Metasploit', 'Metasploit is allowed on one machine in the exam, so spend it on purpose.', { ...SCANNED, kinds: ['exam-sim'] }),
];

const initialFoothold: ChecklistGoal[] = [
  g(IF, 'Before firing', 'h-foot-listener', 'Listener running', 'Start the listener before sending anything, or the callback is lost.'),
  g(IF, 'Before firing', 'h-foot-payload', 'Build and deliver a payload', 'Whatever route runs code needs a payload that calls back and a way to get it onto the host.'),
  g(IF, 'Before firing', 'h-foot-port', 'Pick a port the target can reach out on', 'High ports are often blocked outbound; 443, 80 and 53 usually get through.'),
  g(IF, 'Before firing', 'h-foot-exploit', 'Public exploit read end to end, IPs/ports/paths changed', 'A version with a working public exploit is a shell; read the code before running it.', SCANNED),
  g(IF, 'Get the shell', 'h-foot-shell', 'Catch the shell', 'Start the listener before sending the payload; everything after this stage needs a shell.'),
  g(IF, 'Get the shell', 'h-foot-webshell', 'Web shell only: upgrade to a reverse shell', 'A web shell scores zero in the exam; get a real reverse shell at once.', WEB),
  g(IF, 'Get the shell', 'h-foot-service', 'Turn a misconfigured service into code execution', 'Database command execution, a writable share in the web root, NFS or open Redis run your code without an exploit.', MISCONFIG),
  g(IF, 'Get the shell', 'h-foot-creds', 'Log in with a credential you hold', 'Every credential found so far is tried on every login service first: it is the cheapest way in.', CRED_LOGIN),
  g(IF, 'Get the shell', 'h-foot-client', 'Client-side: a user opens a file', 'When nothing is exposed, a macro or library file run by a user can still land a shell.'),
  g(IF, 'Right after landing', 'h-stab-shell', 'Upgrade to a stable interactive shell', 'Proof only counts from an interactive shell, and a dropped or dumb shell wastes the privesc time.'),
  g(IF, 'Right after landing', 'h-orient-identity', 'whoami, hostname, IP: confirm where you are', 'Tells you who you are and which privesc list to start with.'),
  g(
    IF,
    'Right after landing',
    'h-orient-proof',
    'Capture local.txt with proof in one frame',
    'From the stabilized interactive shell (web-shell proof does not count): local.txt or user.txt plus whoami, hostname and IP in one command. Take it even when the host has no local flag: it is the proof of access.',
  ),
  g(IF, 'Right after landing', 'h-foot-arrived', 'Log how you got in', 'The hop chain is what the report and the stuck check are built from.'),
];

const privilegeEscalation: ChecklistGoal[] = [
  g(PE, 'Linux', 'h-pe-lin-manual', 'Manual enumeration first', 'A hand-run list shows what a script buries and what it skips.', LIN),
  g(PE, 'Linux', 'h-pe-lin-sudo', 'Check sudo rights', 'sudo -l is the most common single-step root.', LIN),
  g(PE, 'Linux', 'h-pe-lin-suid', 'Check SUID and SGID binaries', 'A GTFOBins-listed SUID binary is root.', LIN),
  g(PE, 'Linux', 'h-pe-lin-caps', 'Check file capabilities', 'cap_setuid on an interpreter is root.', LIN),
  g(PE, 'Linux', 'h-pe-lin-cron', 'Check cron jobs and timers', 'A writable script run by root is root.', LIN),
  g(PE, 'Linux', 'h-pe-lin-writable', 'Check writable files and PATH hijacks', 'Writable configs and scripts that root executes.', LIN),
  g(PE, 'Linux', 'h-pe-lin-creds', 'Passwords in history, configs, backups, databases', 'A reused password turns a low user into root on lab boxes more often than any exploit.', LIN),
  g(PE, 'Linux', 'h-pe-lin-groups', 'Dangerous groups (docker, lxd, disk)', 'Membership of docker, lxd or disk is root by design.', LIN),
  g(PE, 'Linux', 'h-pe-lin-nfs', 'NFS shares with no_root_squash', 'A share that keeps root lets you plant a SUID binary.', LIN),
  g(PE, 'Linux', 'h-pe-lin-internal', 'Check internal-only services', 'Localhost services often run as root with weak auth.', LIN),
  g(PE, 'Linux', 'h-pe-lin-auto', 'linPEAS with output logged', 'Catches what the manual checks missed.', LIN),
  g(PE, 'Linux', 'h-pe-lin-kernel', 'Check for a kernel exploit', 'Last resort: noisy and can crash the box.', LIN),
  g(PE, 'Windows', 'h-pe-win-manual', 'Manual enumeration first', 'A hand-run list shows what a script buries and what it skips.', WIN),
  g(PE, 'Windows', 'h-pe-win-privs', 'Check token privileges for potato attacks', 'SeImpersonate on a service account is an instant SYSTEM.', WIN),
  g(PE, 'Windows', 'h-pe-win-groups', 'Check privileged groups, or an admin but filtered (whoami /groups)', 'Backup Operators, DnsAdmins and friends are a direct path to SYSTEM.', WIN),
  g(PE, 'Windows', 'h-pe-win-stored', 'Hunt stored credentials', 'cmdkey, autologon, unattend files and PS history hand out passwords.', WIN),
  g(PE, 'Windows', 'h-pe-win-saved', 'Saved credentials (cmdkey /list)', 'A saved credential runs as its owner with runas, no password needed.', WIN),
  g(PE, 'Windows', 'h-pe-win-services', 'Check services and paths you can abuse', 'Unquoted paths and weak service ACLs run your code as SYSTEM.', WIN),
  g(PE, 'Windows', 'h-pe-win-tasks', 'Check scheduled tasks', 'A writable task script runs as whoever owns the task.', WIN),
  g(PE, 'Windows', 'h-pe-win-registry', 'Check AlwaysInstallElevated and registry weaknesses', 'Two registry keys can mean SYSTEM from any MSI.', WIN),
  g(PE, 'Windows', 'h-pe-win-software', 'Non-default installed software and version', 'Third-party software is the part of Windows with public exploits.', WIN),
  g(PE, 'Windows', 'h-pe-win-auto', 'winPEAS / PowerUp with output logged', 'Catches what the manual checks missed.', WIN),
  g(PE, 'Windows', 'h-pe-win-kernel', 'Check for a kernel exploit', 'Last resort: noisy and can crash the box.', WIN),
  g(
    PE,
    'Done',
    'h-pe-proof',
    'Capture proof.txt as root/SYSTEM in one frame',
    'proof.txt (or root.txt) plus whoami, hostname and IP in one command from the root/SYSTEM shell: points only count with that frame.',
    { os: ['linux', 'windows'] },
  ),
];

const postExploitation: ChecklistGoal[] = [
  g(PX, 'Credentials and files', 'h-loot-hashes', 'Dump hashes and secrets from the OS store', 'Every hash is a candidate for reuse on the next host.'),
  g(PX, 'Credentials and files', 'h-post-redump', 'No expected cred? Re-dump LSASS after a few minutes', 'LSASS caches logons late, so an empty first dump does not mean empty.', WIN),
  g(PX, 'Credentials and files', 'h-loot-domain', 'Collect domain material from this host', 'Cached creds and tickets on a joined host can be the way to the domain.', { os: ['windows'], domainJoined: true }),
  g(PX, 'Credentials and files', 'h-loot-sweep', 'Sweep files for credentials and secrets', 'Configs, histories, .kdbx and windows.old routinely hold passwords.'),
  g(PX, 'Credentials and files', 'h-post-keytabs', 'Kerberos keytabs and ccache files', 'A keytab or ccache on a joined Linux host is a domain identity you can reuse.', { os: ['linux'], domainJoined: true }),
  g(PX, 'Network', 'h-orient-network', 'Interfaces and routes: is this host dual-homed?', 'A second interface means a pivot; flag the host dual-homed.'),
  g(PX, 'Network', 'h-post-neighbours', 'ARP cache, hosts file, established connections', 'Neighbours and live connections name the next targets.'),
  g(PX, 'Domain', 'h-post-bloodhound', 'Collect BloodHound data from here', 'The graph shows the ACL path to Domain Admin that net user never will.', { domainJoined: true }),
  g(PX, 'Every new credential', 'h-loot-record', 'Add it to the creds list and run the New Credential Routine', 'Unrecorded creds never get sprayed or tried on other hosts.'),
];

const reporting: ChecklistGoal[] = [
  g(RP, undefined, 'h-close-notes', 'Write the host notes', 'Notes written now save the report from guesswork.'),
  g(RP, undefined, 'h-close-cleanup', 'Remove the tools you uploaded', 'On a real engagement you leave nothing behind.', { kinds: ['client'] }),
];

const lateralMovement: ChecklistGoal[] = [
  g(LM, undefined, 'h-pivot-tunnel', 'Tunnel into the next network', 'Nothing past this host is reachable without it.', { dualHomed: true }),
  g(LM, undefined, 'h-pivot-sweep', 'Sweep the new network for hosts', 'New hosts go back through Information gathering.', { dualHomed: true }),
];

export const HOST_STAGES: ChecklistStage[] = [
  { id: IG, title: 'Information gathering', goals: informationGathering, emptyHint: 'Import a scan to see service steps' },
  { id: VD, title: 'Vulnerability detection', goals: vulnerabilityDetection },
  { id: IF, title: 'Initial foothold', goals: initialFoothold },
  { id: PE, title: 'Privilege escalation', goals: privilegeEscalation, emptyHint: 'Set the OS to see privesc steps' },
  { id: PX, title: 'Post-exploitation', goals: postExploitation },
  { id: RP, title: 'Reporting', goals: reporting },
  { id: LM, title: 'Lateral movement', goals: lateralMovement, placement: 'engagement' },
];

export const HOST_GOALS: ChecklistGoal[] = HOST_STAGES.flatMap((s) => s.goals);
