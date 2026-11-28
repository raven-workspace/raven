import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseLicences, parseSpdx } from "../../scripts/third-party-notices.mjs";

// The licence allow-list (RAV-73): scripts/third-party-notices.mjs reads src-tauri/about.toml's `accepted` for the
// npm packages and built-in components, as cargo-about does for the crates.
const LIST = ["MIT", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-3-Clause", "Unicode-3.0"];
const choose = (expr: string) => chooseLicences(parseSpdx(expr), LIST);

describe("third-party notices: the licence allow-list", () => {
  it("accepts a listed licence and rejects an unlisted one", () => {
    expect(choose("MIT")).toEqual(["MIT"]);
    expect(choose("GPL-3.0-only")).toBeNull();
    expect(choose("UNLICENSED")).toBeNull();
  });

  it("needs one licence of an OR, and names the earliest-listed one", () => {
    expect(choose("Apache-2.0 OR MIT")).toEqual(["MIT"]);
    expect(choose("(MIT OR CC0-1.0)")).toEqual(["MIT"]);
    expect(choose("GPL-2.0-only OR BSD-3-Clause")).toEqual(["BSD-3-Clause"]);
  });

  it("needs every licence of an AND", () => {
    expect(choose("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual(["MIT", "Unicode-3.0"]);
    expect(choose("MIT AND GPL-3.0-only")).toBeNull();
  });

  it("reads an exception as part of its licence", () => {
    expect(choose("Apache-2.0 WITH LLVM-exception")).toEqual(["Apache-2.0 WITH LLVM-exception"]);
    expect(choose("GPL-2.0-only WITH Classpath-exception-2.0")).toBeNull();
  });

  it("refuses an expression it can't read", () => {
    expect(() => parseSpdx("MIT OR")).toThrow(/can't read/);
    expect(() => parseSpdx("(MIT")).toThrow(/can't read/);
    expect(() => parseSpdx("MIT Apache-2.0")).toThrow(/can't read/);
  });

  it("ships the notices file in every app bundle", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(conf.bundle.resources).toEqual({ "../THIRD_PARTY_NOTICES": "THIRD_PARTY_NOTICES" });
    const linux = JSON.parse(readFileSync("src-tauri/tauri.linux.conf.json", "utf8"));
    expect(linux.bundle.resources).toBeUndefined();
  });
});
