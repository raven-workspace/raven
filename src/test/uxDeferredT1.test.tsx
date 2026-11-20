import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLogOrder } from "../features/log/useLogOrder";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("sidebar default width", () => {
  const load = async (width: number) => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    return (await import("../features/engagements/useSidebarStore")).useSidebarStore.getState().collapsed;
  };
  it("starts collapsed under 1000px when nothing is stored", async () => {
    expect(await load(999)).toBe(true);
  });
  it("starts expanded at 1000px and wider", async () => {
    expect(await load(1000)).toBe(false);
  });
  it("a stored choice beats the width", async () => {
    localStorage.setItem("raven.sidebar.collapsed", "0");
    expect(await load(600)).toBe(false);
  });
});

describe("useLogOrder legacy key", () => {
  it("reads the old key once nothing is stored under the new one", () => {
    localStorage.setItem("raven.story.order", "newest");
    const { result } = renderHook(() => useLogOrder("oldest", true));
    expect(result.current[0]).toBe("newest");
  });
  it("the new key wins over the legacy one, and a set writes the new key", () => {
    localStorage.setItem("raven.story.order", "newest");
    localStorage.setItem("raven.log.order", "oldest");
    const { result } = renderHook(() => useLogOrder("newest", true));
    expect(result.current[0]).toBe("oldest");
    act(() => result.current[1]("newest"));
    expect(localStorage.getItem("raven.log.order")).toBe("newest");
  });
  it("falls back when neither holds a valid value", () => {
    localStorage.setItem("raven.story.order", "sideways");
    const { result } = renderHook(() => useLogOrder("oldest", true));
    expect(result.current[0]).toBe("oldest");
  });
});
