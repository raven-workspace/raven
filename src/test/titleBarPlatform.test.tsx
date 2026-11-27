import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasNativeTitleBar } from "../lib/platform";
import { TitleBar } from "../ui/TitleBar";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const LINUX_AMD64 = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const LINUX_ARM64 = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("hasNativeTitleBar", () => {
  it("is true in WebKitGTK on Linux, amd64 and arm64", () => {
    expect(hasNativeTitleBar(LINUX_AMD64)).toBe(true);
    expect(hasNativeTitleBar(LINUX_ARM64)).toBe(true);
  });

  it("is false in WKWebView on macOS", () => {
    expect(hasNativeTitleBar(MAC)).toBe(false);
  });
});

describe("TitleBar chrome per platform", () => {
  afterEach(() => vi.restoreAllMocks());
  const bar = (ua: string) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    return render(<TitleBar title="Lab A" />).container.firstElementChild!;
  };

  it("keeps the traffic-light inset on macOS", () => {
    expect(bar(MAC).className).toBe("title-bar");
  });

  it("drops it under the desktop's own title bar on Linux", () => {
    expect(bar(LINUX_AMD64).classList).toContain("title-bar--below-native");
  });
});
