import { describe, expect, it } from "vitest";
import { parseCredentialPaste } from "../engines/credentials";

describe("parseCredentialPaste", () => {
  it.each([
    ["svc_report:Summer2026!", { username: "svc_report", domain: null, secret: "Summer2026!", type: "password" }],
    ["LUMEN\\svc_report:Summer2026!", { username: "svc_report", domain: "LUMEN", secret: "Summer2026!", type: "password" }],
    ["admin@lumen.corp:pw", { username: "admin", domain: "lumen.corp", secret: "pw", type: "password" }],
    ["Administrator:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", { username: "Administrator", domain: null, secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", type: "hash" }],
  ])("parses %s", (input, out) => expect(parseCredentialPaste(input)).toEqual(out));

  it.each(["http://x:8080", "10.10.20.21:445", "a:b\nc:d", ":pw", "user:"])("rejects %s", (s) => expect(parseCredentialPaste(s)).toBeNull());
});
