import { describe, expect, it } from "vitest";
import { freezeCopy } from "../features/vault/frozenCopy";

describe("freezeCopy (the picture the lock's reverse sweep closes over)", () => {
  it("is inert and hidden from assistive tech, with no ids or autofocus", () => {
    const src = document.createElement("div");
    src.innerHTML = `<p id="note">secret</p><input id="q" autofocus /><button>Go</button>`;
    const { el } = freezeCopy(src);
    expect(el.hasAttribute("inert")).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector("[id]")).toBeNull();
    expect(el.querySelector("[autofocus]")).toBeNull();
    expect(el.textContent).toContain("secret");
  });

  it("carries scroll positions over once attached", () => {
    const src = document.createElement("div");
    src.innerHTML = `<div class="pane"><div style="height:2000px"></div></div>`;
    const pane = src.querySelector<HTMLElement>(".pane")!;
    pane.scrollTop = 420;
    const { el, restoreScroll } = freezeCopy(src);
    document.body.append(el);
    restoreScroll();
    expect(el.querySelector<HTMLElement>(".pane")!.scrollTop).toBe(420);
    el.remove();
  });
});
