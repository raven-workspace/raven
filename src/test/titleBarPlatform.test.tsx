import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { hasNativeTitleBar } from "../lib/platform";
import { TitleBar } from "../ui/TitleBar";

// window.__RAVEN_OS__ is set by the Rust side (src-tauri/src/platform.rs) before any page script.
describe("hasNativeTitleBar", () => {
  it("is true only on Linux", () => {
    expect(hasNativeTitleBar("linux")).toBe(true);
    expect(hasNativeTitleBar("macos")).toBe(false);
  });

  it("is false outside the app, where nothing sets the OS (audit mode, tests)", () => {
    expect(hasNativeTitleBar(undefined)).toBe(false);
  });
});

describe("TitleBar chrome per platform", () => {
  afterEach(() => {
    delete window.__RAVEN_OS__;
  });
  const bar = (os?: string) => {
    window.__RAVEN_OS__ = os;
    return render(<TitleBar title="Lab A" />).container.firstElementChild!;
  };

  it("keeps the traffic-light inset on macOS and outside the app", () => {
    expect(bar("macos").className).toBe("title-bar");
    expect(bar(undefined).className).toBe("title-bar");
  });

  it("drops it on Linux", () => {
    expect(bar("linux").classList).toContain("title-bar--below-native");
  });
});
