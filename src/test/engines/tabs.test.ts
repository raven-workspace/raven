import { describe, expect, it } from "vitest";
import { closeTab, dropTabs, pageOf, parseStored, routeKey, storedForm, visit, type EditorTab } from "../../engines/tabs";

const E = "e1";
const open = (...routes: string[]) => routes.reduce<readonly EditorTab[]>((tabs, r) => visit(E, tabs, r), []);
const keys = (tabs: readonly EditorTab[]) => tabs.map((t) => t.key);

describe("editor tab pages", () => {
  it("maps each route of the engagement to its page", () => {
    expect(pageOf(E, "/e/e1")).toEqual({ kind: "section", section: "board" });
    expect(pageOf(E, "/e/e1/s/log")).toEqual({ kind: "section", section: "log" });
    expect(pageOf(E, "/e/e1/h/h1")).toEqual({ kind: "host", hostId: "h1" });
    expect(pageOf(E, "/e/e1/f/f1")).toEqual({ kind: "finding", findingId: "f1" });
    expect(pageOf(E, "/e/e1/notes")).toEqual({ kind: "notes", hostId: null });
    expect(pageOf(E, "/e/e1/notes/h1")).toEqual({ kind: "notes", hostId: "h1" });
    expect(pageOf(E, "/e/e1/arsenal?q=nmap")).toEqual({ kind: "reference", page: "arsenal" });
    expect(pageOf(E, "/e/e1/payloads?generator=sql")).toEqual({ kind: "reference", page: "payloads" });
    expect(pageOf(E, "/e/e1/manual/tools%2Fnmap#scan")).toEqual({ kind: "reference", page: "manual" });
  });

  it("knows no route outside the engagement or its pages", () => {
    expect(pageOf(E, "/")).toBeNull();
    expect(pageOf(E, "/arsenal")).toBeNull();
    expect(pageOf(E, "/e/e2/h/h1")).toBeNull();
    expect(pageOf(E, "/e/e10")).toBeNull();
    expect(pageOf(E, "/e/e1/h")).toBeNull();
    expect(pageOf(E, "/e/e1/h/h1/extra")).toBeNull();
    expect(pageOf(E, "/e/e1/arsenal/x")).toBeNull();
    expect(pageOf(E, "/e/e1/elsewhere")).toBeNull();
    expect(pageOf(E, "/e/e1/h/%E0%A4%A")).toBeNull();
  });

  it("gives one key per page, whatever the route's search, hash or Manual note", () => {
    expect(routeKey(E, "/e/e1/manual/a")).toBe(routeKey(E, "/e/e1/manual/b?q=x"));
    expect(routeKey(E, "/e/e1/h/h1")).toBe(routeKey(E, "/e/e1/h/h1#x"));
    expect(routeKey(E, "/e/e1/notes/h1")).not.toBe(routeKey(E, "/e/e1/h/h1"));
    expect(routeKey(E, "/e/e1/notes")).not.toBe(routeKey(E, "/e/e1/notes/h1"));
  });
});

describe("opening tabs", () => {
  it("opens each new page in a new tab at the end", () => {
    expect(keys(open("/e/e1", "/e/e1/h/h1", "/e/e1/notes/h1"))).toEqual(["s:board", "h:h1", "notes:h1"]);
  });

  it("never opens a page twice: its tab is focused and takes the new route", () => {
    const tabs = open("/e/e1/h/h1", "/e/e1/manual/a", "/e/e1/h/h1", "/e/e1/manual/b");
    expect(tabs).toEqual([
      { key: "h:h1", route: "/e/e1/h/h1" },
      { key: "manual", route: "/e/e1/manual/b" },
    ]);
  });

  it("leaves the list alone for a route that is no page", () => {
    const tabs = open("/e/e1/h/h1");
    expect(visit(E, tabs, "/settings")).toBe(tabs);
    expect(visit(E, tabs, "/e/e1/h/h1")).toBe(tabs);
  });
});

describe("closing tabs", () => {
  const tabs = open("/e/e1", "/e/e1/h/h1", "/e/e1/s/log");

  it("shows the tab to the right of the active one it closed", () => {
    expect(closeTab(tabs, "h:h1", "h:h1")).toEqual({ tabs: open("/e/e1", "/e/e1/s/log"), next: "/e/e1/s/log" });
  });

  it("shows the tab to the left when the last one closes", () => {
    expect(closeTab(tabs, "s:log", "s:log").next).toBe("/e/e1/h/h1");
  });

  it("stays on the active tab when another one closes", () => {
    expect(closeTab(tabs, "s:board", "h:h1")).toEqual({ tabs: open("/e/e1/h/h1", "/e/e1/s/log"), next: null });
  });

  it("has nothing to show when the only tab closes", () => {
    expect(closeTab(open("/e/e1/h/h1"), "h:h1", "h:h1")).toEqual({ tabs: [], next: null });
  });

  it("ignores a key with no tab", () => {
    expect(closeTab(tabs, "h:gone", "h:h1")).toEqual({ tabs, next: null });
  });

  it("drops the tabs of pages that are gone", () => {
    expect(keys(dropTabs(tabs, new Set(["h:h1"])))).toEqual(["s:board", "s:log"]);
    expect(dropTabs(tabs, new Set(["h:other"]))).toBe(tabs);
  });
});

describe("restoring tabs", () => {
  it("stores route ids only: pathnames, never a search or hash", () => {
    const tabs = open("/e/e1/h/h1#ports", "/e/e1/manual/tools?q=10.0.0.5", "/e/e1/arsenal?q=secret");
    const stored = JSON.parse(storedForm(tabs, "manual"));
    expect(stored).toEqual({ v: 1, tabs: ["/e/e1/h/h1", "/e/e1/manual/tools", "/e/e1/arsenal"], active: "/e/e1/manual/tools" });
  });

  it("reads the stored tabs and the active one back", () => {
    const tabs = open("/e/e1", "/e/e1/h/h1");
    expect(parseStored(E, storedForm(tabs, "h:h1"))).toEqual({ tabs, active: "/e/e1/h/h1" });
  });

  it("drops routes of other engagements, unknown routes and duplicates", () => {
    const raw = JSON.stringify({ v: 1, tabs: ["/e/e1/h/h1", "/e/e2/h/h1", "/nowhere", 4, "/e/e1/h/h1"], active: "/e/e2/h/h1" });
    expect(parseStored(E, raw)).toEqual({ tabs: open("/e/e1/h/h1"), active: null });
  });

  it("gives no tabs for nothing stored or a value that doesn't parse", () => {
    for (const raw of [null, "", "{", "null", "[]", '{"tabs":"x"}']) expect(parseStored(E, raw)).toEqual({ tabs: [], active: null });
  });
});
