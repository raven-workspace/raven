import { useEffect } from "react";
import { Outlet, useMatch } from "react-router";
import { ChromeBar } from "../ChromeBar/ChromeBar";
import { useTargetStore } from "../useTargetStore";
import "./WorkspaceShell.scss";

/**
 * The window grid around an engagement (design §1.1): the rail beside the frame, and in the frame the Explorer, the
 * editor area (editor tabs over the page) and the terminal panel, over the status bar. The slots are empty boxes that
 * later issues fill (RAV-74 rail, RAV-75 Explorer, RAV-76 editor tabs, RAV-78 status bar, the terminal panel after
 * them). No terminal panel yet, so its row is collapsed.
 */
function EngagementFrame() {
  return (
    <div className="workspace-shell__workspace">
      <div data-slot="rail" className="workspace-shell__rail" />
      <div className="workspace-shell__frame">
        <div className="workspace-shell__frame-body">
          <div data-slot="explorer" className="workspace-shell__explorer" />
          <div className="workspace-shell__work workspace-shell__work--no-terminal">
            <div data-slot="editor-tabs" className="workspace-shell__tabs" />
            <div className="workspace-shell__editor">
              <Outlet />
            </div>
            <div data-slot="terminal" className="workspace-shell__terminal" />
          </div>
        </div>
        <div data-slot="status-bar" className="workspace-shell__status" />
      </div>
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
        <EngagementFrame />
      ) : (
        <div className="workspace-shell__page">
          <Outlet />
        </div>
      )}
    </div>
  );
}
