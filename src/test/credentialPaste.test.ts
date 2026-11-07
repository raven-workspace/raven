import { describe, expect, it } from "vitest";
import { parseCredentialPaste } from "../engines/credentials";

describe("parseCredentialPaste", () => {
  it.each([
    ["svc_report:Summer2026!", { username: "svc_report", domain: null, secret: "Summer2026!", type: "password" }],
    ["LUMEN\\svc_report:Summer2026!", { username: "svc_report", domain: "LUMEN", secret: "Summer2026!", type: "password" }],
    ["admin@lumen.corp:pw", { username: "admin", domain: "lumen.corp", secret: "pw", type: "password" }],
    ["Administrator:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", { username: "Administrator", domain: null, secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", type: "hash" }],
    ["admin:12345", { username: "admin", domain: null, secret: "12345", type: "password" }],
    ["LUMEN\\svc:445", { username: "svc", domain: "LUMEN", secret: "445", type: "password" }],
    ["svc@lumen.corp:8080", { username: "svc", domain: "lumen.corp", secret: "8080", type: "password" }],
    ["10.10.20.21:99999", { username: "10.10.20.21", domain: null, secret: "99999", type: "password" }],
    ["Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::", { username: "Administrator", domain: null, secret: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", type: "hash" }],
    ["LUMEN\\svc_sql:1105:aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef:::", { username: "svc_sql", domain: "LUMEN", secret: "aad3b435b51404eeaad3b435b51404ee:0123456789abcdef0123456789abcdef", type: "hash" }],
  ])("parses %s", (input, out) => expect(parseCredentialPaste(input)).toEqual(out));

  it.each(["http://x:8080", "10.10.20.21:445", "a:b\nc:d", ":pw", "user:", "Note: remember this", "Some note:x", "Warning: do not run", "host.local:80", "10.10.20.21:65535", "dc01.lumen.corp:5985"])("rejects %s", (s) => expect(parseCredentialPaste(s)).toBeNull());
});
