import {
  BookOpenText,
  Files,
  Flag,
  Gear,
  Kanban,
  Key,
  ListBullets,
  ListChecks,
  Lock,
  NotePencil,
  Package,
  ShareNetwork,
  Stack,
  TerminalWindow,
  type Icon,
} from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router";
import { RAIL_SECTIONS, railViewOf, type RailSection, type RailView } from "../../../engines/rail";
import { pageOf } from "../../../engines/tabs";
import { isDialogOpen, useKeydown } from "../../../lib/keys";
import { ariaKeys, matches, SHORTCUTS, type Keys } from "../../../lib/shortcuts";
import { IconButton, RavenMark, TitleBarShortcuts, type Hint } from "../../../ui/index";
import { TabMarker } from "../../../ui/TabMarker";
import { SECTIONS, sectionPath } from "../../engagements/sections/sections";
import { useVaultLock } from "../../vault/VaultGate/VaultGate";
import { useOpenView } from "../useDrawerTabs";
import { useExplorerStore } from "../useExplorerStore";
import "./Rail.scss";

const SECTION_ICONS: Record<RailSection, Icon> = {
  board: Kanban,
  log: ListBullets,
  credentials: Key,
  findings: Flag,
  network: ShareNetwork,
  checklist: ListChecks,
};

/** The keys listed under the rail's Shortcuts button after the page's own: the rail's, then the app's. */
const EVERYWHERE: Hint[] = [
  { keys: SHORTCUTS.toggleSidebar, label: "Explorer", priority: 1 },
  { keys: "1–6", label: "sections", priority: 1 },
  { keys: "7", label: "Report", priority: 1 },
  { keys: "N", label: "Field notes", priority: 1 },
  { keys: "A", label: "Arsenal", priority: 1 },
  { keys: "P", label: "Payloads", priority: 1 },
  { keys: "M", label: "Manual", priority: 1 },
  { keys: SHORTCUTS.addHost, label: "add host", priority: 1 },
  { keys: SHORTCUTS.closeTab, label: "close tab", priority: 1 },
  { keys: SHORTCUTS.search, label: "search", priority: 1 },
  { keys: SHORTCUTS.lock, label: "lock", priority: 1 },
  { keys: SHORTCUTS.settings, label: "settings", priority: 1 },
];

/** What the current-view bar follows: the slot marked current. */
const FOLLOW_CURRENT = { selected: '[data-rail-slot][data-current="true"]', items: "[data-rail-slot]", attributes: ["data-current"] };

/** One view's 56 × 36 slot with its 28 × 28 button centred; the current one carries the bar (drawn by the marker). */
function Slot({ view, current, icon, label, keys, onClick, expanded }: {
  view: RailView | "terminals";
  current: RailView | null;
  icon: Icon;
  label: string;
  keys: Keys;
  onClick: () => void;
  expanded?: boolean;
}) {
  const here = view === current;
  return (
    <div data-rail-slot={view} data-current={here} className="rail__slot">
      <IconButton
        icon={icon}
        label={label}
        shortcut={keys}
        tooltipSide="right"
        aria-keyshortcuts={ariaKeys(keys)}
        aria-current={here ? "page" : undefined}
        aria-expanded={expanded}
        onClick={onClick}
      />
    </div>
  );
}

/**
 * The rail (design §1.2): the mark, the views (Explorer, Terminals, the six sections in Raven's order so 1–6 count
 * down it, then Field notes, Arsenal, Payloads and Manual), and the app group at the foot. The current view's 2 × 20
 * accent bar follows the route and glides between slots (TabMarker; it jumps under reduced motion). Each button does
 * what its key does: the sections navigate, A, M, P and N open or focus their tab, and Explorer toggles the Explorer
 * as ⌘B does. Terminals toggles the terminal panel as ⌃` will, and does nothing until that panel exists.
 */
export function Rail({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = `${location.pathname}${location.search}${location.hash}`;
  const current = railViewOf(pageOf(engagementId, route));
  const explorerOpen = useExplorerStore((s) => s.open);
  const { openReference, openNotes } = useOpenView();
  const lock = useVaultLock();
  const openSettings = () => void navigate("/settings");

  // ⌘, opens Settings. A chord, so `isFreeKey` doesn't apply; a dialog, or the report editor's own ⌘, (subscript),
  // still wins.
  useKeydown((e) => {
    if (!matches(SHORTCUTS.settings, e) || e.defaultPrevented || isDialogOpen()) return;
    e.preventDefault();
    openSettings();
  });

  const sectionLabel = (id: RailSection) => SECTIONS.find((s) => s.id === id)!.label;

  return (
    <nav aria-label="Workspace" className="rail">
      <Link to="/" aria-label="Raven home" className="rail__mark">
        <RavenMark />
      </Link>
      <div className="rail__views">
        <TabMarker className="rail__marker" follow={FOLLOW_CURRENT} />
        <Slot
          view="explorer"
          current={current}
          icon={Files}
          label="Explorer"
          keys={SHORTCUTS.toggleSidebar}
          expanded={explorerOpen}
          onClick={() => useExplorerStore.getState().toggle()}
        />
        {/* No terminal panel yet (the panel issue): the button is in place and does nothing. */}
        <Slot view="terminals" current={current} icon={TerminalWindow} label="Terminals" keys={SHORTCUTS.toggleTerminal} onClick={() => {}} />
        <div aria-hidden="true" className="rail__dots">
          <span className="rail__dot" />
          <span className="rail__dot" />
          <span className="rail__dot" />
        </div>
        {RAIL_SECTIONS.map((id, i) => (
          <Slot
            key={id}
            view={id}
            current={current}
            icon={SECTION_ICONS[id]}
            label={sectionLabel(id)}
            keys={String(i + 1)}
            onClick={() => void navigate(sectionPath(engagementId, id))}
          />
        ))}
        <Slot view="notes" current={current} icon={NotePencil} label="Field notes" keys="N" onClick={openNotes} />
        <Slot view="arsenal" current={current} icon={Stack} label="Arsenal" keys="A" onClick={() => openReference("arsenal")} />
        <Slot view="payloads" current={current} icon={Package} label="Payloads" keys="P" onClick={() => openReference("payloads")} />
        <Slot view="manual" current={current} icon={BookOpenText} label="Manual" keys="M" onClick={() => openReference("manual")} />
      </div>
      <div className="rail__app">
        <TitleBarShortcuts everywhere={EVERYWHERE} place="rail" />
        <IconButton
          icon={Lock}
          label="Lock"
          shortcut={SHORTCUTS.lock}
          tooltipSide="right"
          aria-keyshortcuts={ariaKeys(SHORTCUTS.lock)}
          onClick={() => lock?.()}
        />
        <IconButton
          icon={Gear}
          label="Settings"
          shortcut={SHORTCUTS.settings}
          tooltipSide="right"
          aria-keyshortcuts={ariaKeys(SHORTCUTS.settings)}
          onClick={openSettings}
        />
      </div>
    </nav>
  );
}
