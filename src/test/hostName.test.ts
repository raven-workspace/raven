import { describe, expect, it } from "vitest";
import { shortHostName } from "../lib/hostName";

describe("shortHostName", () => {
  it("keeps the first DNS label", () => {
    expect(shortHostName("web-portal-dmz-frontend-01.dmz.acme.corp")).toBe("web-portal-dmz-frontend-01");
  });
  it("leaves IPs and single labels alone", () => {
    expect(shortHostName("10.10.20.15")).toBe("10.10.20.15");
    expect(shortHostName("dc01")).toBe("dc01");
  });
});
