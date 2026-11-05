import { describe, it, expect } from "vitest";
import { credLabel, usernameLabel } from "../../../engines/credentials/labels";
import { cred, user } from "./fixtures";

describe("labels", () => {
  it("credLabel", () => {
    expect(credLabel(cred({ username: "alice", domain: "CORP" }))).toBe("CORP\\alice");
    expect(credLabel(cred({ username: "" }))).toBe("(owner unknown)");
    expect(credLabel(cred({ username: "bob", type: "hash" }))).toBe("bob (hash)");
  });
  it("usernameLabel", () => {
    expect(usernameLabel(user("u", "alice", { domain: "CORP" }))).toBe("CORP\\alice");
    expect(usernameLabel(user("u", "alice"))).toBe("alice");
  });
});
