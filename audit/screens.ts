import { expect, type Page } from "@playwright/test";
import { AUDIT_IDS, AUDIT_NOTE_IDS } from "../src/audit/fixtures";
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
/** Opens a report page by its outline label: the outline row, or below 1000px the section picker above the page. */
export const openReportItem = (label: string | RegExp) => async (page: Page) => {
  const row = page.locator("[data-outline-row]:visible").filter({ hasText: label }).first();
  const picker = page.getByRole("combobox", { name: "Report section" }).and(page.locator(":visible"));
  await row.or(picker).first().waitFor();
  if (await row.isVisible()) await row.click();
  else {
    await picker.click();
    await page.getByRole("option", { name: label }).click();
  }
};
/** The open target's checks: in the outline, or below 1000px in the Checks disclosure above the page (opened). */
export const reportChecks = async (page: Page) => {
  const disclosure = page.getByRole("button", { name: /^Checks/ });
  if (await disclosure.isVisible()) await disclosure.click();
  return page.getByRole("list", { name: "Checks" }).and(page.locator(":visible")).first();
};
/** ms01's 400-line winPEAS run picked on the page and moved with its block's Move to appendix, then its appendix page
 *  opened. (Trimmed to 40 lines inline, it raises no "long block" check of its own.) */
const moveWinPeas = async (page: Page) => {
  await openReportItem("ms01")(page);
  await page.locator(".report-page .report-code", { hasText: "winPEASx64.exe" }).click();
  await page.getByRole("button", { name: "Move to appendix" }).click();
  await page.getByText(/^Full output: Appendix E\.1/).waitFor();
  await openReportItem(/^Appendix E: ms01/)(page);
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
    // A lookup row's key: its Lookup group comes first, the options are its commands ready to fill.
    id: "palette-lookup", path: H, ready: "role=group[name^='STATUS_ZZ_DENIED'] >> role=option >> nth=0",
    setup: async (page) => {
      await page.keyboard.press("Meta+K");
      await page.getByRole("combobox").first().fill("STATUS_ZZ_DENIED");
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
      await page.getByRole("button", { name: /^(Host |No host$)/ }).click();
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
  { id: "report-target", path: REPORT, ready: ".report-page >> role=heading[name='ms01']", setup: openReportItem("ms01") },
  { id: "report-ad", path: REPORT, ready: ".report-page >> role=heading[name='Attack chain']", setup: openReportItem(/^AD set/) },
  { id: "report-appendix", path: REPORT, ready: "role=heading[name='Appendix E: ms01']", setup: moveWinPeas },
  {
    // Under 1200px of pane the evidence rail is a drawer, opened from the strip; wider, it is the third column.
    id: "report-narrow", path: REPORT, ready: "role=tablist[name='Evidence'] >> visible=true",
    setup: async (page) => {
      await openReportItem("ms01")(page);
      await page.locator(".report-page .report-code").first().waitFor();
      const toggle = page.locator("section[aria-label='Report']").getByRole("button", { name: "Evidence", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      // Checked once the drawer has faded in, not halfway through (a half-faded row reads as low contrast).
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    },
  },
];
