import { expect, type Locator, type Page } from "@playwright/test";
import { AUDIT_IDS, AUDIT_NOTE_IDS } from "../src/audit/fixtures";
import { AUDIT_PNGS } from "../src/audit/images";

export interface Screen {
  id: string;
  path: string;
  /** A Playwright selector that must be visible before checks run. */
  ready: string;
  setup?: (page: Page) => Promise<void>;
  /** The widths it runs at, when not every one of `WIDTHS` (a layout that exists only at one window size). */
  widths?: readonly number[];
}

export const WIDTHS = [900, 1024, 1280, 1440] as const;
/** The widths a screen runs at. */
export const widthsOf = (screen: Pick<Screen, "widths"> | undefined): readonly number[] => screen?.widths ?? WIDTHS;

/** ⌘ on macOS; Ctrl under `AUDIT_OS=linux`, where the app reads a Linux platform (visual.spec.ts). */
const MOD = process.env.AUDIT_OS === "linux" ? "Control" : "Meta";

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
  const toggle = page.getByRole("region", { name, exact: true }).locator("button.fact-group__toggle[aria-expanded='false']");
  if ((await toggle.count()) > 0) await toggle.first().click();
};
const FS01 = `${E}/h/${AUDIT_IDS.fileHost}`;
/** A command with a fill field the host does not answer, so the first Enter is held back by the copy guard. */
const GUARD_QUERY = "several ports";
const focusBody = (page: Page) => page.locator("body").click({ position: { x: 1, y: 1 } });
const IIS = `/e/${AUDIT_IDS.payloadsEngagement}/h/${AUDIT_IDS.iisHost}`;
const PG = `/e/${AUDIT_IDS.payloadsEngagement}/h/${AUDIT_IDS.pgHost}`;
const EXAM_DC = `/e/${AUDIT_IDS.examEngagement}/h/h-exam-dc01`;
const DRAWER = "aside[aria-label='Payloads']";
const WORKBENCH = "main[aria-label='Payloads']";
/** Picks "Uploaded file" as where the payload is pasted, in the drawer (a chip) or the Workbench (a toggle). */
const pickUploaded = (root: string) => async (page: Page) => {
  const chip = page.locator(root).getByRole("button", { name: /^Paste into: / });
  if (await chip.count()) {
    await chip.click();
    await page.getByRole("option", { name: /^Uploaded file/ }).click();
  } else await page.locator(root).getByRole("button", { name: "Uploaded file" }).click();
};
const openPayloads = async (page: Page) => { await focusBody(page); await page.keyboard.press("p"); };
const MANUAL_LONG = `/manual/${AUDIT_NOTE_IDS.long}`;
const REPORT = `/e/${AUDIT_IDS.examEngagement}/s/report`;
/** A tab of the report's tab row, by its label: a target is numbered ("2 ms01"), the rest read as named ("Appendix A"). */
export const reportTab = (page: Page, label: string) => {
  // A target's tab leads with its count ("1 ms01"), a free page's with its section number ("§6 Tools and versions").
  const exact = new RegExp(`^(§?\\d+ )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.getByRole("tablist", { name: "Report pages" }).getByRole("tab").filter({ has: page.locator("[data-tab-label]", { hasText: exact }) });
};
/**
 * Opens a report page from the tab row: a target or a tab by its label, or "Report details", the first part of Front
 * matter. The row lists every section once the report has set them up (Front matter is the first tab).
 */
export const openReportItem = (label: string) => async (page: Page) => {
  await reportTab(page, "Front matter").waitFor();
  if (label === "Report details") {
    await reportTab(page, "Front matter").click();
    await page.getByRole("tablist", { name: "Front matter parts" }).getByRole("tab", { name: "Details", exact: true }).click();
  } else await reportTab(page, label).click();
};
/** The open tab's checks: the To do panel, opened from the status strip's To do. */
export const reportChecks = async (page: Page) => {
  const todo = page.getByRole("group", { name: "Report status" }).getByRole("button", { name: /^To do \d+$/ });
  if ((await todo.getAttribute("aria-expanded")) !== "true") await todo.click();
  return page.getByRole("list", { name: "Checks" }).and(page.locator(":visible")).first();
};
/** Opens a part of Front matter or Closing: its tab, then the part in the segmented row ("2 Summary" reads as Summary). */
export const openReportPart = (group: "Front matter" | "Closing", part: string) => async (page: Page) => {
  await reportTab(page, "Front matter").waitFor();
  await reportTab(page, group).click();
  await page.getByRole("tablist", { name: `${group} parts` }).getByRole("tab", { name: new RegExp(`^(\\d+ )?${part}$`) }).click();
};
/** garnet's page, drafted: its machine heading carries the target's number. */
export const GARNET_HEADING = ".report-page >> role=heading[name=/^4\\.\\d+ garnet \\(10\\.10\\.30\\.31\\)$/]";
export const openGarnet = async (page: Page) => {
  await openReportItem("garnet")(page);
  await page.locator(GARNET_HEADING).waitFor();
};
/** garnet's "Identify the Jenkins version" output on the page: one plain code block copied from the log. */
export const garnetOutput = (page: Page) => page.locator(".report-page .report-codeblock").filter({ hasText: /^X-Jenkins: 2\.401\.3/ });
/** Clicks into a block's text and moves to the end of the clicked line, ready to type. ProseMirror takes up a click's
 *  selection a moment after mouseup; a key pressed sooner acts at the old selection. */
export const caretAtEnd = async (page: Page, block: Locator) => {
  await block.click();
  await page.waitForTimeout(150);
  await page.keyboard.press("End");
};
/** Opens a block's actions from its handle: the pointer moves onto the block (the handle shows for the block under
 *  it), then onto the handle's menu button. */
export const openBlockActions = async (page: Page, block: Locator) => {
  await block.scrollIntoViewIfNeeded();
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
  await page.locator(".report-handle-popup[data-state='open']").waitFor();
  await page.locator(".report-handle").getByRole("button", { name: "Block actions" }).click();
};
const NOTE_PANE = "section[aria-label='Note']";

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
      if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) await page.keyboard.press(`${MOD}+B`);
    },
  },
  {
    id: "sidebar-rail-tip", path: H, ready: "role=tooltip",
    // The collapsed rail's host tooltip (name and IP), opened by keyboard focus.
    setup: async (page) => {
      await focusBody(page);
      if (await page.getByRole("button", { name: "Collapse sidebar" }).isVisible()) await page.keyboard.press(`${MOD}+B`);
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
    id: "credentials-hash", path: `${E}/s/credentials`, ready: "role=tab[name='Matrix'][selected]",
    setup: async (page) => {
      await page.getByRole("button", { name: "Select ACME\\Administrator" }).click();
      await page.getByRole("tab", { name: "Crack" }).waitFor();
    },
  },
  { id: "credentials-inventory", path: `${E}/s/credentials?tab=inventory`, ready: "role=tab[name='Inventory'][selected]" },
  {
    id: "credentials-folded", path: `${E}/s/credentials`, ready: "role=tab[name='Matrix'][selected]",
    setup: async (page) => {
      await page.getByRole("button", { name: "Fold credential" }).click();
      await page.getByRole("button", { name: "Open credential" }).waitFor();
    },
  },
  {
    id: "findings", path: `${E}/s/findings`, ready: "role=region[name='Finding']",
    setup: async (page) => {
      await page.getByRole("button", { name: /^Edit Domain compromise via Kerberoastable/ }).click();
      await page.getByRole("region", { name: "Finding" }).waitFor();
    },
  },
  {
    id: "finding-add-screenshot", path: `${E}/s/findings`, ready: "role=group[name='Add a screenshot']",
    // Adding a screenshot from a finding's steps: the drop zone, the caption, the actions.
    setup: async (page) => {
      await page.getByRole("button", { name: /^Edit Domain compromise via Kerberoastable/ }).click();
      await page.getByRole("region", { name: "Finding" }).getByRole("button", { name: "Add screenshot" }).click();
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
      await page.keyboard.press(`${MOD}+K`);
      await page.getByRole("combobox").first().fill("smb");
    },
  },
  {
    // A lookup row's key: its Lookup group comes first, the options are its commands ready to fill.
    id: "palette-lookup", path: H, ready: "role=group[name^='STATUS_ZZ_DENIED'] >> role=option >> nth=0",
    setup: async (page) => {
      await page.keyboard.press(`${MOD}+K`);
      await page.getByRole("combobox").first().fill("STATUS_ZZ_DENIED");
    },
  },
  {
    id: "palette-credmenu", path: FS01, ready: "role=listbox[name^='Fill with credential']",
    setup: async (page) => {
      await page.keyboard.press(`${MOD}+K`);
      await page.getByRole("combobox").first().waitFor();
      await page.keyboard.press("Alt+KeyC");
    },
  },
  {
    id: "palette-guard", path: FS01, ready: "text=/not filled. Press ↵ again to copy anyway/",
    setup: async (page) => {
      await page.keyboard.press(`${MOD}+K`);
      await page.getByRole("combobox", { name: "Search" }).fill(GUARD_QUERY);
      await page.keyboard.press("Enter");
    },
  },
  {
    id: "palette-suggest", path: FS01, ready: "role=listbox[name^='Suggestions for']",
    setup: async (page) => {
      await page.keyboard.press(`${MOD}+K`);
      await page.getByRole("combobox", { name: "Search" }).fill("psexec");
      // TARGET_IP is filled from the host and offers every host's address as a suggestion.
      await page.getByRole("combobox", { name: "Value for TARGET_IP" }).focus();
    },
  },
  {
    id: "palette-hostmenu", path: H, ready: "role=listbox[name='Fill for host']",
    setup: async (page) => {
      await page.keyboard.press(`${MOD}+K`);
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
  {
    // Two reverse shells failed on this host: the Callbacks chip is amber and the clue sits under the chips.
    id: "payloads-drawer-callbacks", path: IIS, ready: `${DRAWER} >> text=Callbacks failed here twice`, setup: openPayloads,
  },
  {
    id: "payloads-drawer-tools", path: IIS, ready: "role=listbox[name='Tools']",
    setup: async (page) => { await openPayloads(page); await page.keyboard.press("Alt+KeyT"); },
  },
  {
    id: "payloads-workbench-read", path: IIS, ready: `${WORKBENCH} >> text=Callbacks failed here twice`,
    setup: async (page) => {
      await openPayloads(page);
      await page.locator(DRAWER).getByRole("button", { name: "Full screen" }).click();
    },
  },
  {
    id: "payloads-drawer-upload", path: IIS, ready: `${DRAWER} >> text=/Save as|Make /`,
    setup: async (page) => { await openPayloads(page); await pickUploaded(DRAWER)(page); },
  },
  {
    id: "payloads-workbench-upload", path: IIS, ready: `${WORKBENCH} >> text=/Save as|Make /`,
    setup: async (page) => {
      await openPayloads(page);
      await page.locator(DRAWER).getByRole("button", { name: "Full screen" }).click();
      await pickUploaded(WORKBENCH)(page);
    },
  },
  {
    // The Nishang cradle was built for an older LHOST: its block opens with the amber "Rebuild first" line.
    id: "payloads-drawer-stale", path: IIS, ready: `${DRAWER} >> text=/Rebuild first/`,
    setup: async (page) => {
      await openPayloads(page);
      await page.locator(DRAWER).getByRole("button", { name: /^Paste into: / }).click();
      await page.getByRole("option", { name: /^PowerShell prompt/ }).click();
      await page.locator(DRAWER).getByRole("listbox", { name: "Fits" }).getByRole("option", { name: /Nishang/ }).click();
    },
  },
  {
    // Exam-sim: Metasploit is locked to ms01, so a Meterpreter payload for dc01 carries the amber lock line.
    id: "payloads-drawer-msf-lock", path: EXAM_DC, ready: `${DRAWER} >> text=/Metasploit is locked to ms01/`,
    setup: async (page) => {
      await openPayloads(page);
      await page.keyboard.press("Alt+Digit4");
      await page.locator(DRAWER).getByRole("listbox", { name: "Fits" }).getByRole("option", { name: /Meterpreter \(staged\)/ }).first().click();
    },
  },
  // The Manual: a long note (five tables, one five columns wide with long cells) with no engagement in view.
  { id: "manual-long", path: MANUAL_LONG, ready: `${NOTE_PANE} article[aria-label='Zz Status Codes'] table` },
  {
    // Opened from ⌘K: the address the palette builds, with the match bar and the current match in Table 1.
    id: "manual-search", path: `${MANUAL_LONG}?q=access%20denied#table-1`, ready: `${NOTE_PANE} mark[data-current]`,
  },
  {
    // A tool page reached with M from a host: the host chip shows the host and the commands are filled for it.
    id: "manual-tool", path: H, ready: `${NOTE_PANE} article[aria-label='Zz Scanner']`,
    setup: async (page) => {
      await page.getByRole("tablist").first().waitFor();
      await focusBody(page);
      await page.keyboard.press("m");
      await page.getByRole("navigation", { name: "Manual notes" }).getByRole("button", { name: "Zz Scanner" }).click();
    },
  },
  {
    // A card link in a note opens the Arsenal drawer over the Manual.
    id: "manual-card-drawer", path: `/manual/${AUDIT_NOTE_IDS.links}`, ready: "aside[aria-label='Arsenal'] >> text=Kerberos Enumeration",
    setup: async (page) => {
      await page.locator(`${NOTE_PANE} button`, { hasText: "Kerberos Enumeration" }).first().click();
    },
  },
  {
    // A ?q= landing on a lookup-table row: the answer card above the note, the row marked in the table.
    id: "manual-lookup-card", path: `/manual/${AUDIT_NOTE_IDS.lookup}?q=STATUS_ZZ_DENIED#table-1`, ready: "[aria-label='Answer']",
  },
  { id: "manual-empty", path: "/manual?audit=empty", ready: "text=Import your Field Manual to fill the Manual" },
  // The Report on the mock exam: the report exists with no sections, so opening it drafts every page.
  { id: "report-details", path: REPORT, ready: "role=heading[name='Report details']", setup: openReportItem("Report details") },
  { id: "report-target", path: REPORT, ready: GARNET_HEADING, setup: openReportItem("garnet") },
  { id: "report-ad", path: REPORT, ready: ".report-page >> role=heading[name=/^5 Active Directory Set$/]", setup: openReportItem("AD set") },
  { id: "report-front-introduction", path: REPORT, ready: ".report-page >> role=heading[name=/^1 OffSec Certified Professional Exam Report$/]", setup: openReportPart("Front matter", "Introduction") },
  { id: "report-front-summary", path: REPORT, ready: ".report-page >> role=heading[name=/^2 High-Level Summary$/]", setup: openReportPart("Front matter", "Summary") },
  { id: "report-front-methodology", path: REPORT, ready: ".report-page >> role=heading[name=/^3 Methodologies$/]", setup: openReportPart("Front matter", "Methodology") },
  { id: "report-closing", path: REPORT, ready: ".report-page >> role=heading[name='Further Information']", setup: openReportPart("Closing", "Further information") },
  // web01 is stored at layout 5: opening it rebuilds the plain page, keeps the old one and offers it back.
  { id: "report-web01", path: REPORT, ready: "text=This page was rebuilt for a new layout.", setup: openReportItem("web01") },
  {
    id: "report-web01-restored", path: REPORT, ready: "text=This is your page from before the new layout.",
    setup: async (page) => {
      await openReportItem("web01")(page);
      await page.getByRole("button", { name: "Restore your previous page" }).click();
    },
  },
  {
    // An edited block copied from the log: Refresh from log asks before it replaces the owner's text.
    id: "report-refresh-confirm", path: REPORT, ready: "role=dialog[name='Replace this block with the current version?']",
    setup: async (page) => {
      await openGarnet(page);
      const block = garnetOutput(page);
      await caretAtEnd(page, block.locator("pre"));
      await page.keyboard.type(" X");
      await openBlockActions(page, block);
      await page.getByRole("menu", { name: "Block actions" }).getByRole("menuitem", { name: "Refresh from log" }).click();
    },
  },
  {
    // Add new evidence's notice, held open by the pointer (it closes itself after 5s).
    id: "report-notice", path: REPORT, ready: "body > [role=status]",
    setup: async (page) => {
      await openGarnet(page);
      await page.getByRole("button", { name: "Add new evidence" }).click();
      await page.locator("body > [role=status]").hover();
    },
  },
  {
    // The AD set's To do panel: the credential that moved from ad02 to app03 with no finding.
    id: "report-todo", path: REPORT, ready: "role=list[name='Checks'] >> visible=true",
    setup: async (page) => {
      await openReportItem("AD set")(page);
      await page.locator(".report-page >> role=heading[name=/^5 Active Directory Set$/]").waitFor();
      await reportChecks(page);
    },
  },
  {
    // An owner-written free page with its Page actions menu open.
    id: "report-free-page", path: REPORT, ready: "role=menu[name='Page actions']",
    setup: async (page) => {
      await openReportItem("Tools and versions")(page);
      await page.getByRole("button", { name: "Page actions" }).click();
    },
  },
  {
    // The owner's window (1400, sidebar open): about 1160px of pane, so the evidence column opens from the strip and
    // docks beside the page, the paper narrowing to make room.
    id: "report-dock", path: REPORT, ready: "aside[aria-label='Evidence']:not(.evidence-drawer) >> role=tablist[name='Evidence']", widths: [1400],
    setup: async (page) => {
      await openGarnet(page);
      await page.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true }).click();
    },
  },
  {
    // Under 1000px of pane the evidence column is a drawer over the page; from 1000 it docks beside the page, from
    // 1200 it is always there. Both open from the strip's Evidence button.
    id: "report-narrow", path: REPORT, ready: "role=tablist[name='Evidence'] >> visible=true",
    setup: async (page) => {
      await openGarnet(page);
      const toggle = page.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      // Checked once the drawer has faded in, not halfway through (a half-faded row reads as low contrast).
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    },
  },
];

/** Adds the audit switch for the workspace shell (src/lib/shell.ts) to a screen's path. */
const workspace = (path: string) => `${path}${path.includes("?") ? "&" : "?"}workspace`;
/** The chrome bar, ready once the Engagement picker shows its value. */
const chromeReady = (page: Page) => page.locator(".chrome-bar").getByRole("button", { name: /^Engagement: / }).waitFor();

/**
 * The workspace shell (`npm run tauri:overhaul`) at the window's minimum and its drawn size (design §1.1, §1.7). Run by
 * visual.spec only: audit:pixel compares the old shell, which must not move while the new one is built.
 */
export const WORKSPACE_SCREENS: Screen[] = [
  { id: "workspace-dashboard", path: workspace("/"), ready: ".chrome-bar >> role=button[name='Search hosts, notes and commands']", widths: [1100, 1440] },
  { id: "workspace-board", path: workspace(E), ready: "section[aria-label='Information gathering']", widths: [1100, 1440], setup: chromeReady },
  { id: "workspace-host", path: workspace(H), ready: "role=tab[name='Next'][selected]", widths: [1100, 1440], setup: chromeReady },
  {
    // The Explorer with the host in view open on its services (design §1.4).
    id: "workspace-explorer-services", path: workspace(H), ready: "role=list[name$=' services']", widths: [1100, 1440],
    setup: async (page) => {
      await chromeReady(page);
      await page.locator("aside.explorer").getByRole("button", { name: /^Show web-portal.*services$/ }).click();
    },
  },
  {
    id: "workspace-engagement-picker", path: workspace(E), ready: "role=listbox[name='Engagements']", widths: [1100, 1440],
    setup: (page) => page.locator(".chrome-bar").getByRole("button", { name: /^Engagement: / }).click(),
  },
  {
    id: "workspace-target-picker", path: workspace(H), ready: "role=listbox[name='Hosts']", widths: [1100, 1440],
    setup: (page) => page.locator(".chrome-bar").getByRole("button", { name: /^Target/ }).click(),
  },
];

/** Every screen visual.spec runs: the old shell's, then the workspace shell's. */
export const VISUAL_SCREENS: Screen[] = [...SCREENS, ...WORKSPACE_SCREENS];

