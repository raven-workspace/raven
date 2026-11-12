/**
 * Common exam tools for the Tools appendix (template 5.2): the name the report prints, the binaries that run it
 * (lower case, as `firstBinary` reads them), what it is for and where it comes from. Data only. Tools the exam bans
 * (sqlmap, Nessus, OpenVAS and other automatic exploitation or scanning suites) are never listed.
 */
export interface CatalogTool {
  name: string;
  bins: string[];
  purpose: string;
  url: string;
}

export const TOOL_CATALOG: CatalogTool[] = [
  { name: "nmap", bins: ["nmap"], purpose: "Port and service scanning", url: "https://nmap.org" },
  { name: "feroxbuster", bins: ["feroxbuster"], purpose: "Web content discovery", url: "https://github.com/epi052/feroxbuster" },
  { name: "gobuster", bins: ["gobuster"], purpose: "Web content discovery", url: "https://github.com/OJ/gobuster" },
  { name: "ffuf", bins: ["ffuf"], purpose: "Web fuzzing", url: "https://github.com/ffuf/ffuf" },
  { name: "whatweb", bins: ["whatweb"], purpose: "Web technology fingerprinting", url: "https://github.com/urbanadventurer/WhatWeb" },
  { name: "nikto", bins: ["nikto"], purpose: "Web server checks", url: "https://github.com/sullo/nikto" },
  { name: "wpscan", bins: ["wpscan"], purpose: "WordPress enumeration", url: "https://github.com/wpscanteam/wpscan" },
  { name: "curl", bins: ["curl"], purpose: "HTTP requests", url: "https://curl.se" },
  { name: "wget", bins: ["wget"], purpose: "File transfer", url: "https://www.gnu.org/software/wget/" },
  { name: "searchsploit", bins: ["searchsploit"], purpose: "Exploit search", url: "https://www.exploit-db.com/searchsploit" },
  { name: "hydra", bins: ["hydra"], purpose: "Password guessing", url: "https://github.com/vanhauser-thc/thc-hydra" },
  { name: "nxc", bins: ["nxc", "netexec"], purpose: "Credential checks over SMB, WinRM and MSSQL", url: "https://github.com/Pennyw0rth/NetExec" },
  { name: "crackmapexec", bins: ["crackmapexec", "cme"], purpose: "Credential checks over SMB and WinRM", url: "https://github.com/byt3bl33d3r/CrackMapExec" },
  { name: "impacket-psexec", bins: ["impacket-psexec", "psexec.py"], purpose: "Remote command execution over SMB", url: "https://github.com/fortra/impacket" },
  { name: "impacket-wmiexec", bins: ["impacket-wmiexec", "wmiexec.py"], purpose: "Remote command execution over WMI", url: "https://github.com/fortra/impacket" },
  { name: "impacket-smbexec", bins: ["impacket-smbexec", "smbexec.py"], purpose: "Remote command execution over SMB", url: "https://github.com/fortra/impacket" },
  { name: "impacket-secretsdump", bins: ["impacket-secretsdump", "secretsdump.py"], purpose: "Dumping credential hashes", url: "https://github.com/fortra/impacket" },
  { name: "impacket-GetUserSPNs", bins: ["impacket-getuserspns", "getuserspns.py"], purpose: "Kerberoasting", url: "https://github.com/fortra/impacket" },
  { name: "impacket-GetNPUsers", bins: ["impacket-getnpusers", "getnpusers.py"], purpose: "AS-REP roasting", url: "https://github.com/fortra/impacket" },
  { name: "impacket-mssqlclient", bins: ["impacket-mssqlclient", "mssqlclient.py"], purpose: "MSSQL client", url: "https://github.com/fortra/impacket" },
  { name: "impacket-smbserver", bins: ["impacket-smbserver", "smbserver.py"], purpose: "SMB share for file transfer", url: "https://github.com/fortra/impacket" },
  { name: "impacket-lookupsid", bins: ["impacket-lookupsid", "lookupsid.py"], purpose: "Domain user enumeration", url: "https://github.com/fortra/impacket" },
  { name: "evil-winrm", bins: ["evil-winrm"], purpose: "Remote shell over WinRM", url: "https://github.com/Hackplayers/evil-winrm" },
  { name: "ssh", bins: ["ssh"], purpose: "Remote shell over SSH", url: "https://www.openssh.com" },
  { name: "xfreerdp", bins: ["xfreerdp", "xfreerdp3"], purpose: "Remote desktop", url: "https://www.freerdp.com" },
  { name: "mimikatz", bins: ["mimikatz"], purpose: "Credential extraction", url: "https://github.com/gentilkiwi/mimikatz" },
  { name: "Rubeus", bins: ["rubeus"], purpose: "Kerberos abuse", url: "https://github.com/GhostPack/Rubeus" },
  { name: "BloodHound", bins: ["bloodhound"], purpose: "Active Directory path analysis", url: "https://github.com/SpecterOps/BloodHound" },
  { name: "bloodhound-python", bins: ["bloodhound-python", "bloodhound-ce-python"], purpose: "Active Directory data collection", url: "https://github.com/dirkjanm/BloodHound.py" },
  { name: "SharpHound", bins: ["sharphound"], purpose: "Active Directory data collection", url: "https://github.com/SpecterOps/SharpHound" },
  { name: "PrintSpoofer", bins: ["printspoofer", "printspoofer32", "printspoofer64"], purpose: "Privilege escalation from SeImpersonatePrivilege", url: "https://github.com/itm4n/PrintSpoofer" },
  { name: "GodPotato", bins: ["godpotato", "godpotato-net2", "godpotato-net35", "godpotato-net4"], purpose: "Privilege escalation from SeImpersonatePrivilege", url: "https://github.com/BeichenDream/GodPotato" },
  { name: "winPEAS", bins: ["winpeas", "winpeasx64", "winpeasx86", "winpeasany", "winpeas.bat", "winpeas.ps1"], purpose: "Windows privilege escalation enumeration", url: "https://github.com/peass-ng/PEASS-ng" },
  { name: "linPEAS", bins: ["linpeas", "linpeas.sh"], purpose: "Linux privilege escalation enumeration", url: "https://github.com/peass-ng/PEASS-ng" },
  { name: "pspy", bins: ["pspy", "pspy32", "pspy64"], purpose: "Process monitoring", url: "https://github.com/DominicBreuker/pspy" },
  { name: "chisel", bins: ["chisel"], purpose: "Tunnelling", url: "https://github.com/jpillora/chisel" },
  { name: "ligolo-ng", bins: ["ligolo", "ligolo-ng", "ligolo-proxy", "ligolo-agent"], purpose: "Tunnelling", url: "https://github.com/nicocha30/ligolo-ng" },
  { name: "rlwrap", bins: ["rlwrap"], purpose: "Line editing for a reverse shell", url: "https://github.com/hanslub42/rlwrap" },
  { name: "nc", bins: ["nc", "netcat"], purpose: "Listener for reverse shells", url: "https://nc110.sourceforge.io" },
  { name: "ncat", bins: ["ncat"], purpose: "Listener for reverse shells", url: "https://nmap.org/ncat" },
  { name: "socat", bins: ["socat"], purpose: "Listener and port relay", url: "http://www.dest-unreach.org/socat/" },
  { name: "msfconsole", bins: ["msfconsole"], purpose: "Metasploit console", url: "https://github.com/rapid7/metasploit-framework" },
  { name: "msfvenom", bins: ["msfvenom"], purpose: "Payload generation", url: "https://github.com/rapid7/metasploit-framework" },
  { name: "john", bins: ["john"], purpose: "Password cracking", url: "https://github.com/openwall/john" },
  { name: "hashcat", bins: ["hashcat"], purpose: "Password cracking", url: "https://hashcat.net/hashcat/" },
  { name: "smbclient", bins: ["smbclient"], purpose: "SMB share access", url: "https://www.samba.org/samba/docs/current/man-html/smbclient.1.html" },
  { name: "smbmap", bins: ["smbmap"], purpose: "SMB share enumeration", url: "https://github.com/ShawnDEvans/smbmap" },
  { name: "rpcclient", bins: ["rpcclient"], purpose: "RPC enumeration", url: "https://www.samba.org/samba/docs/current/man-html/rpcclient.1.html" },
  { name: "enum4linux", bins: ["enum4linux"], purpose: "SMB and RPC enumeration", url: "https://github.com/CiscoCXSecurity/enum4linux" },
  { name: "enum4linux-ng", bins: ["enum4linux-ng"], purpose: "SMB and RPC enumeration", url: "https://github.com/cddmp/enum4linux-ng" },
  { name: "ldapsearch", bins: ["ldapsearch"], purpose: "LDAP enumeration", url: "https://www.openldap.org" },
  { name: "snmpwalk", bins: ["snmpwalk"], purpose: "SNMP enumeration", url: "http://www.net-snmp.org" },
  { name: "kerbrute", bins: ["kerbrute"], purpose: "Kerberos user enumeration", url: "https://github.com/ropnop/kerbrute" },
  { name: "certipy", bins: ["certipy", "certipy-ad"], purpose: "AD CS enumeration and abuse", url: "https://github.com/ly4k/Certipy" },
  { name: "certutil", bins: ["certutil"], purpose: "File transfer", url: "https://learn.microsoft.com/windows-server/administration/windows-commands/certutil" },
  // python3 counts only when it runs a script (tools.ts): the exploit runner.
  { name: "python3", bins: ["python3", "python"], purpose: "Exploit runner", url: "https://www.python.org" },
];

/**
 * Shell builtins and system commands: part of any shell, not a tool the report names. `sudo` here covers `sudo -l`
 * (`sudo <tool>` reads as the tool).
 */
export const NOT_TOOLS = new Set([
  // Linux shell and coreutils
  "cd", "ls", "cat", "echo", "printf", "pwd", "id", "whoami", "hostname", "uname", "ip", "ifconfig", "chmod", "chown",
  "cp", "mv", "rm", "mkdir", "rmdir", "touch", "tar", "gzip", "gunzip", "unzip", "zip", "find", "grep", "egrep", "head",
  "tail", "less", "more", "sort", "uniq", "wc", "cut", "awk", "sed", "tr", "tee", "xargs", "file", "strings", "base64",
  "xxd", "env", "export", "set", "history", "clear", "exit", "sudo", "su", "ps", "kill", "which", "whereis", "ln",
  "nano", "vi", "vim", "bash", "sh", "zsh", "source", "systemctl", "service", "crontab", "netstat", "ss", "getcap", "dig",
  "nslookup", "host", "ping", "date", "stat", "df", "du", "mount", "openssl", "git", "ssh-keygen",
  // Windows cmd and PowerShell
  "type", "dir", "copy", "move", "del", "erase", "md", "rd", "ren", "cls", "ipconfig", "systeminfo", "net", "net1",
  "netsh", "reg", "sc", "schtasks", "tasklist", "taskkill", "icacls", "findstr", "where", "cmd", "powershell", "pwsh",
  "iwr", "invoke-webrequest", "get-content", "gc", "get-childitem", "gci", "set-location",
  "start-process", "invoke-expression", "iex", "select-string", "get-acl", "get-process", "get-service", "runas",
]);
