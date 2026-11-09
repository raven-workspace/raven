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

// dispatchEvent rather than click(): it switches the tab without depending on pointer hit-testing (at 900 the Order
// button once sat over the Findings tab and swallowed a real click).
const tab = (name: string) => (page: Page) => page.getByRole("tab", { name, exact: true }).dispatchEvent("click");
/** Opens a fact group by its toggle; a group that is already open stays as it is. */
const openGroup = (name: string) => async (page: Page) => {
  // The host page measures itself first; groups fold (stacked) or stay open (two columns) only after that.
  // With no data (the `empty` state run) there is no host to measure, only "Host not found".
  await page.locator("[data-host-layout]").or(page.getByText("Host not found")).first().waitFor();
  const toggle = page.locator(`button[title^='Open ${name}']`);
  if ((await toggle.count()) > 0) await toggle.first().click();
};
const FS01 = `${E}/h/${AUDIT_IDS.fileHost}`;
/** A command with a fill field the host does not answer, so the first Enter is held back by the copy guard. */
const GUARD_QUERY = "several ports";
const focusBody = (page: Page) => page.locator("body").click({ position: { x: 1, y: 1 } });
const IIS = `/e/${AUDIT_IDS.payloadsEngagement}/h/${AUDIT_IDS.iisHost}`;
const PG = `/e/${AUDIT_IDS.payloadsEngagement}/h/${AUDIT_IDS.pgHost}`;
const openPayloads = async (page: Page) => { await focusBody(page); await page.keyboard.press("p"); };

export const SCREENS: Screen[] = [
  { id: "dashboard", path: "/", ready: "role=heading[name='Engagements']" },
  { id: "board", path: E, ready: "section[aria-label='Information gathering']" },
  { id: "host-next", path: H, ready: "role=tab[name='Next'][selected]" },
  { id: "host-log", path: H, ready: "role=tablist >> visible=true", setup: tab("Log") },
  {
    id: "host-checklist", path: H, ready: "role=button[name='Full checklist'][expanded]",
    setup: async (page) => {
      await page.getByRole("button", { name: "Full checklist" }).click();
      const notice = page.getByRole("button", { name: /New credentials since done/ }).first();
      if (await notice.count()) await notice.click();
    },
  },
  { id: "host-findings", path: H, ready: "role=tab[name='Findings'][selected]", setup: tab("Findings") },
  {
    id: "host-facts-open", path: FS01, ready: "role=region[name='Services']",
    setup: async (page) => { await openGroup("Services")(page); await openGroup("Host Credentials")(page); },
  },
  {
    id: "host-vectors-open", path: `/e/${AUDIT_IDS.examEngagement}/h/${AUDIT_IDS.msfHost}`, ready: "role=region[name='Privesc vectors']",
    setup: openGroup("Privesc vectors"),
  },
  { id: "host-postfoothold", path: `/e/${AUDIT_IDS.examEngagement}/h/${AUDIT_IDS.msfHost}`, ready: "role=region[name='Who am I']" },
  {
    id: "finding-split", path: H, ready: "role=region[name='Finding']",
    setup: async (page) => { await focusBody(page); await page.keyboard.press("f"); },
  },
  {
    id: "sidebar-collapsed", path: H, ready: "role=button[name='Expand sidebar']",
    // The sidebar starts collapsed below 1000px, so only press ⌘B when it is open.
    setup: async (page) => {
      await focusBody(page);
      if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) await page.keyboard.press("Meta+B");
    },
  },
  {
    id: "sidebar-rail-tip", path: H, ready: "role=tooltip",
    // The collapsed rail's host tooltip (name and IP), opened by keyboard focus.
    setup: async (page) => {
      await focusBody(page);
      if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) await page.keyboard.press("Meta+B");
      await page.locator(`nav[aria-label='Engagement'] a[href$='/h/${AUDIT_IDS.webHost}']`).focus();
    },
  },
  {
    id: "eng-stuck", path: `${E}/s/checklist`, ready: "role=region[name='Engagement checklist']",
    // The engagement stuck check, open: subject and state are separate elements.
    setup: async (page) => { await page.getByRole("button", { name: /Stuck check/ }).click(); },
  },
  { id: "host-stuck", path: H, ready: "aside[aria-label^='Stuck on']", setup: async (page) => { await focusBody(page); await page.keyboard.press("h"); } },
  { id: "dc-next", path: `${E}/h/${AUDIT_IDS.dcHost}`, ready: "role=tablist >> visible=true" },
  {
    id: "eng-checklist", path: `${E}/s/checklist`, ready: "role=region[name='Engagement checklist']",
    setup: async (page) => { await page.locator("section[aria-label='Lateral movement']").scrollIntoViewIfNeeded(); },
  },
  { id: "credentials", path: `${E}/s/credentials`, ready: "role=tab[name='Matrix'][selected]" },
  {
    id: "findings", path: `${E}/s/findings`, ready: "role=region[name='Finding']",
    setup: async (page) => {
      await page.getByRole("button", { name: /^Edit Domain compromise via Kerberoastable/ }).click();
      await page.getByRole("region", { name: "Finding" }).waitFor();
    },
  },
  {
    id: "findings-list", path: `/e/${AUDIT_IDS.findingsListEngagement}/s/findings`, ready: "role=region[name='Findings']",
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
  { id: "exam-board", path: `/e/${AUDIT_IDS.examEngagement}`, ready: "role=status[name='Engagement status'] >> visible=true" },
  {
    id: "exam-host-locked", path: `/e/${AUDIT_IDS.examEngagement}/h/${AUDIT_IDS.msfHost}`, ready: "role=button[name='Full checklist'][expanded]",
    setup: async (page) => { await page.getByRole("button", { name: "Full checklist" }).click(); },
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
    id: "palette-credmenu", path: FS01, ready: "role=listbox[name^='Fill with credential']",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox").first().waitFor();
      await page.keyboard.press("Alt+KeyC");
    },
  },
  {
    id: "palette-guard", path: FS01, ready: "text=/not filled. Press ↵ again to copy anyway/",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox", { name: "Search" }).fill(GUARD_QUERY);
      await page.keyboard.press("Enter");
    },
  },
  {
    id: "palette-suggest", path: FS01, ready: "role=listbox[name^='Suggestions for']",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox", { name: "Search" }).fill("psexec");
      // TARGET_IP is filled from the host and offers every host's address as a suggestion.
      await page.getByRole("combobox", { name: "Value for TARGET_IP" }).focus();
    },
  },
  {
    id: "palette-hostmenu", path: H, ready: "role=listbox[name='Fill for host']",
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
  {
    id: "arsenal-drawer-empty", path: H, ready: "role=listbox[name='Arsenal results']",
    setup: async (page) => { await focusBody(page); await page.keyboard.press("a"); },
  },
  {
    // No host in view: the "log (no host)" label; ↵, ⌘↵, → and Esc must all still show.
    id: "arsenal-drawer-nohost", path: E, ready: "role=listbox[name='Arsenal results']",
    setup: async (page) => { await focusBody(page); await page.keyboard.press("a"); },
  },
  {
    id: "arsenal-drawer-smb", path: FS01, ready: "role=listbox[name='Arsenal results']",
    setup: async (page) => {
      await focusBody(page);
      await page.keyboard.press("a");
      await page.locator("input[aria-label='Search the Arsenal']").fill("smb");
    },
  },
  { id: "arsenal-browse", path: "/arsenal", ready: "nav[aria-label='Categories']" },
  {
    id: "arsenal-browse-search", path: "/arsenal", ready: "role=listbox",
    setup: async (page) => { await page.locator("input[aria-label='Search the Arsenal']").fill("lateral movement"); },
  },
  {
    id: "arsenal-card-long", path: "/arsenal", ready: "nav[aria-label='On this card'] button[aria-current='location']",
    setup: async (page) => {
      await page.locator("input[aria-label='Search the Arsenal']").fill("Windows PrivEsc Enumeration");
      await page.getByRole("option", { name: /Windows PrivEsc Enumeration/ }).first().click();
      await page.getByRole("article", { name: "Windows PrivEsc Enumeration" }).waitFor();
      // Scroll the reading pane so the "On this card" strip is stuck and has an active entry.
      await page.getByRole("region", { name: "Reading" }).evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
      // The strip follows the scroll through an IntersectionObserver: wait until the active entry is no longer the first one.
      await page.waitForFunction(() => {
        const nav = document.querySelector("nav[aria-label='On this card']");
        const buttons = [...(nav?.querySelectorAll("button[data-for]") ?? [])];
        const at = buttons.findIndex((b) => b.getAttribute("aria-current") === "location");
        return at > 0;
      });
    },
  },
  {
    id: "transfer-generator", path: "/arsenal", ready: "role=region[name='Transfer a file']",
    setup: async (page) => {
      // Below 1100px the category column becomes a select.
      const side = page.locator("button[data-category]", { hasText: "Shells & transfers" });
      const select = page.getByRole("combobox", { name: "Category" });
      await side.or(select).first().waitFor();
      if (await side.isVisible()) await side.click();
      else {
        await select.click();
        await page.getByRole("option", { name: /Shells & transfers/ }).click();
      }
      await page.getByRole("option", { name: /Transfer a file/ }).click();
      await page.getByRole("button", { name: /^Fill for host/ }).click();
      await page.getByRole("listbox", { name: "Fill for host" }).getByRole("option").nth(1).click();
    },
  },
  { id: "payloads-drawer", path: IIS, ready: "aside[aria-label='Payloads'] h2", setup: openPayloads },
  {
    id: "payloads-drawer-misfits", path: IIS, ready: "role=list[name=\"Don't fit here\"]",
    setup: async (page) => {
      await openPayloads(page);
      await page.locator("aside[aria-label='Payloads']").getByRole("button", { name: /^Don't fit here \(\d+\)$/ }).click();
    },
  },
  {
    // Three fits in a PowerShell prompt (the owner's "where my shells went" case), the second one picked by click.
    id: "payloads-drawer-fits", path: IIS, ready: "aside[aria-label='Payloads'] >> role=option[name=/powercat/][selected]",
    setup: async (page) => {
      await openPayloads(page);
      const aside = page.locator("aside[aria-label='Payloads']");
      await aside.getByRole("button", { name: /^Paste into: / }).click();
      await aside.getByRole("option", { name: /^PowerShell prompt/ }).click();
      await aside.getByRole("listbox", { name: "Fits" }).getByRole("option", { name: /powercat/ }).click();
    },
  },
  {
    id: "payloads-sql", path: PG, ready: "aside[aria-label='Payloads'] >> role=tab[name='SQL injection'][selected]",
    setup: async (page) => { await openPayloads(page); await page.keyboard.press("Alt+Digit3"); },
  },
  {
    // In-app navigation, so the Workbench keeps the IIS host the drawer was opened on.
    id: "payloads-workbench", path: IIS, ready: "main[aria-label='Payloads'] h2",
    setup: async (page) => {
      await openPayloads(page);
      await page.locator("aside[aria-label='Payloads']").getByRole("button", { name: "Full screen" }).click();
    },
  },
];
