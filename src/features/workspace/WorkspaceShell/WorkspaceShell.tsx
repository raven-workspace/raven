import { useEffect } from "react";
import { Outlet, useMatch } from "react-router";
import { cx } from "../../../lib/cx";
import { isDialogOpen, useKeydown } from "../../../lib/keys";
import { matches, SHORTCUTS } from "../../../lib/shortcuts";
import { HostDialog } from "../../hosts/HostDialog/HostDialog";
import { ChromeBar } from "../ChromeBar/ChromeBar";
import { Explorer } from "../Explorer/Explorer";
import { StatusBar } from "../StatusBar/StatusBar";
import { useExplorerStore } from "../useExplorerStore";
import { useTargetStore } from "../useTargetStore";
import "./WorkspaceShell.scss";

/**
 * The window grid around an engagement (design §1.1): the rail beside the frame, and in the frame the Explorer, the
 * editor area (editor tabs over the page) and the terminal panel, over the status bar. The rail and editor tabs are
 * still empty boxes that later issues fill (RAV-74 rail, RAV-76 editor tabs, the terminal panel after them). No
 * terminal panel yet, so its row is collapsed.
 *
 * ⌘B toggles the Explorer (closed, the editor takes its 264px back) and ⌘N adds a host, open or closed. Both are
 * chords, so `isFreeKey` (which refuses modifiers) does not apply; a dialog, or an editor that took the key (the
 * report's ⌘B bold), still wins.
 */
function EngagementFrame({ engagementId }: { engagementId: string }) {
  const explorerOpen = useExplorerStore((s) => s.open);
  const addingHost = useExplorerStore((s) => s.addingHost);
  useKeydown((e) => {
    if (e.defaultPrevented || isDialogOpen()) return;
    const explorer = useExplorerStore.getState();
    if (matches(SHORTCUTS.toggleSidebar, e)) {
      e.preventDefault();
      explorer.toggle();
    } else if (matches(SHORTCUTS.addHost, e)) {
      e.preventDefault();
      explorer.setAddingHost(true);
    }
  });
  return (
    <div className="workspace-shell__workspace">
      <div data-slot="rail" className="workspace-shell__rail" />
      <div className="workspace-shell__frame">
        <div className={cx("workspace-shell__frame-body", !explorerOpen && "workspace-shell__frame-body--no-explorer")}>
          {explorerOpen && (
            <div data-slot="explorer" className="workspace-shell__explorer">
              <Explorer engagementId={engagementId} />
            </div>
          )}
          <div className="workspace-shell__work workspace-shell__work--no-terminal">
            <div data-slot="editor-tabs" className="workspace-shell__tabs" />
            <div className="workspace-shell__editor">
              <Outlet />
            </div>
            <div data-slot="terminal" className="workspace-shell__terminal" />
          </div>
        </div>
        <div data-slot="status-bar" className="workspace-shell__status">
          <StatusBar engagementId={engagementId} />
        </div>
      </div>
      <HostDialog open={addingHost} onOpenChange={(open) => useExplorerStore.getState().setAddingHost(open)} engagementId={engagementId} />
    </div>
  );
}

/**
 * The workspace shell (`npm run tauri:overhaul`, src/lib/shell.ts): the chrome bar over the page. Inside an engagement
 * the page sits in the frame; outside one (the Dashboard, Settings, the full-page Arsenal, Manual and Payloads) it
 * fills the window under the chrome bar, with no rail, Explorer or terminal (docs/specs/terminal.md §8).
 */
export function WorkspaceShell() {
  const engagementId = useMatch("/e/:id/*")?.params.id;
  const hostId = useMatch("/e/:id/h/:hostId")?.params.hostId;

  // Opening a host's page makes it Target; a page with no host keeps the last one.
  useEffect(() => {
    if (engagementId && hostId) useTargetStore.getState().pick(engagementId, hostId);
  }, [engagementId, hostId]);

  return (
    <div className={engagementId ? "workspace-shell workspace-shell--engagement" : "workspace-shell"}>
      <ChromeBar />
      {engagementId ? (
        <EngagementFrame engagementId={engagementId} />
      ) : (
        <div className="workspace-shell__page">
          <Outlet />
        </div>
      )}
    </div>
  );
}
