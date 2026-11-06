import { expect, type Page } from "@playwright/test";
import { AUDIT_IDS } from "../src/audit/fixtures";
import { AUDIT_PNGS } from "../src/audit/images";

export interface Screen {
  id: string;
  path: string;
  /** A Playwright selector that must be visible before checks run. */
  ready: string;
  setup?: (page: Page) => Promise<void>;
}

export const WIDTHS = [900, 1024, 1280, 1440] as const;

const E = `/e/${AUDIT_IDS.labEngagement}`;
const H = `${E}/h/${AUDIT_IDS.webHost}`;

// dispatchEvent, not click(): at 900 the Findings tab sits under the Order button, which swallows a real click.
const tab = (name: string) => (page: Page) => page.getByRole("tab", { name, exact: true }).dispatchEvent("click");
const focusBody = (page: Page) => page.locator("body").click({ position: { x: 1, y: 1 } });

export const SCREENS: Screen[] = [
  { id: "dashboard", path: "/", ready: "role=heading[name='Engagements']" },
  { id: "board", path: E, ready: "section[aria-label='Information gathering']" },
  { id: "host-story", path: H, ready: "role=tablist >> visible=true" },
  {
    id: "host-checklist", path: H, ready: "role=tab[name='Checklist'][selected]",
    setup: async (page) => {
      await tab("Checklist")(page);
      const notice = page.getByRole("button", { name: /new credentials? since this was done/ }).first();
      if (await notice.count()) await notice.click();
    },
  },
  { id: "host-credentials", path: H, ready: "role=tab[name='Credentials'][selected]", setup: tab("Credentials") },
  { id: "host-findings", path: H, ready: "role=tab[name='Findings'][selected]", setup: tab("Findings") },
  { id: "host-stuck", path: H, ready: "aside[aria-label^='Stuck on']", setup: async (page) => { await focusBody(page); await page.keyboard.press("h"); } },
  { id: "dc-story", path: `${E}/h/${AUDIT_IDS.dcHost}`, ready: "role=tablist >> visible=true" },
  {
    id: "eng-checklist", path: `${E}/s/checklist`, ready: "role=region[name='Engagement checklist']",
    setup: async (page) => { await page.locator("section[aria-label='Lateral movement']").scrollIntoViewIfNeeded(); },
  },
  { id: "credentials", path: `${E}/s/credentials`, ready: "role=heading[name=/credentials/i]" },
  {
    id: "findings", path: `${E}/s/findings`, ready: "role=dialog",
    setup: async (page) => {
      await page.getByRole("button", { name: /^Edit Domain compromise via Kerberoastable/ }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { id: "log", path: `${E}/s/log`, ready: "role=region[name='Log']" },
  {
    id: "log-images", path: `${E}/s/log`, ready: "role=region[name='Log']",
    setup: async (page) => {
      for (const title of ["Terminal strip", "Long tool output captured", "Desktop of the file server", "Cropped proof"]) {
        await page.getByRole("button", { name: new RegExp(title) }).click();
      }
      await expect(page.locator("li img")).toHaveCount(4);
      await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll("li img")] as HTMLImageElement[];
        return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      });
      await page.getByRole("button", { name: /Terminal strip/ }).scrollIntoViewIfNeeded();
    },
  },
  {
    id: "capture-image", path: H, ready: "img[alt='Pasted screenshot']",
    setup: async (page) => {
      await focusBody(page);
      await page.keyboard.press("l");
      await page.getByRole("dialog").waitFor();
      await page.getByLabel("Paste").first().focus();
      await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], "tall.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, AUDIT_PNGS.tall.base64);
      await page.waitForFunction(() => {
        const i = document.querySelector("img[alt='Pasted screenshot']") as HTMLImageElement | null;
        return !!i && i.complete && i.naturalWidth > 0;
      });
    },
  },
  { id: "exam-board", path: `/e/${AUDIT_IDS.examEngagement}`, ready: "role=button[name=/Metasploit|MSF/i]" },
  {
    id: "exam-host-locked", path: `/e/${AUDIT_IDS.examEngagement}/h/${AUDIT_IDS.msfHost}`, ready: "role=tab[name='Checklist'][selected]",
    setup: tab("Checklist"),
  },
  {
    id: "settings", path: "/settings", ready: "role=heading[name='Field Manual']",
    setup: async (page) => { await page.getByRole("heading", { name: "Field Manual" }).scrollIntoViewIfNeeded(); },
  },
  {
    id: "palette", path: H, ready: "role=listbox[name='Results']",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox").first().fill("smb");
    },
  },
  {
    id: "palette-hostmenu", path: H, ready: "select[aria-label='Fill for host']:focus",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox").first().waitFor();
      await page.keyboard.press("Alt+H");
    },
  },
  {
    id: "arsenal-drawer", path: H, ready: "role=listbox[name='Arsenal results']",
    setup: async (page) => {
      await focusBody(page);
      await page.keyboard.press("a");
      await page.locator("input[aria-label='Search the Arsenal']").fill("kerberos");
    },
  },
  { id: "arsenal-browse", path: "/arsenal", ready: "nav[aria-label='Arsenal']" },
  {
    id: "transfer-generator", path: "/arsenal", ready: "role=region[name='Transfer a file']",
    setup: async (page) => {
      await page.getByRole("link", { name: "Transfer a file" }).click();
      const host = page.getByRole("combobox", { name: "Host" });
      await host.waitFor();
      await host.selectOption(AUDIT_IDS.webHost);
    },
  },
];
