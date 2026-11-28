import { useEffect, useLayoutEffect, useRef } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router";
import { boardRoute, pathOf } from "../../../engines/tabs";
import { ChromeBar } from "../ChromeBar/ChromeBar";
import { EDITOR_PANEL_ID, EditorTabs } from "../EditorTabs/EditorTabs";
import { useDrawerTabs } from "../useDrawerTabs";
import { useEditorTabsStore } from "../useEditorTabsStore";
import { useTargetStore } from "../useTargetStore";
import "./WorkspaceShell.scss";

/**
 * Keeps the editor tabs on the route (design §2.1): every route in view is the active tab, opening one if its page has
 * none. Coming into an engagement restores its tabs; arriving at its home (the board's route, as the Dashboard and the
 * Engagement picker do) shows the tab that was in view when it was left. A deep link keeps its own page.
 */
function useTabRouting(engagementId: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = `${location.pathname}${location.search}${location.hash}`;
  const entered = useRef<string | null>(null);
  // Before paint, so a restored tab replaces the board without the board showing first.
  useLayoutEffect(() => {
    if (!engagementId) {
      entered.current = null;
      return;
    }
    const tabs = useEditorTabsStore.getState();
    if (entered.current !== engagementId) {
      entered.current = engagementId;
      const active = tabs.restore(engagementId);
      const home = pathOf(route).replace(/\/+$/, "") === boardRoute(engagementId) && route === pathOf(route);
      if (home && active && active !== route) {
        void navigate(active, { replace: true });
        return;
      }
    }
    tabs.visit(engagementId, route);
  }, [engagementId, route, navigate]);
}

/**
 * The window grid around an engagement (design §1.1): the rail beside the frame, and in the frame the Explorer, the
 * editor area (editor tabs over the page) and the terminal panel, over the status bar. The rail, Explorer and status
 * bar slots are empty boxes that later issues fill (RAV-74 rail, RAV-75 Explorer, RAV-78 status bar, the terminal
 * panel after them). No terminal panel yet, so its row is collapsed.
 */
function EngagementFrame({ engagementId }: { engagementId: string }) {
  return (
    <div className="workspace-shell__workspace">
      <div data-slot="rail" className="workspace-shell__rail" />
      <div className="workspace-shell__frame">
        <div className="workspace-shell__frame-body">
          <div data-slot="explorer" className="workspace-shell__explorer" />
          <div className="workspace-shell__work workspace-shell__work--no-terminal">
            <div data-slot="editor-tabs" className="workspace-shell__tabs">
              <EditorTabs engagementId={engagementId} />
            </div>
            <div id={EDITOR_PANEL_ID} role="tabpanel" className="workspace-shell__editor">
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
 * the page sits in the frame, under its editor tab; outside one (the Dashboard, Settings, the full-page Arsenal, Manual
 * and Payloads) it fills the window under the chrome bar, with no rail, Explorer or terminal (docs/specs/terminal.md
 * §8). There are no drawers: what opened one opens its tab or full page (useDrawerTabs).
 */
export function WorkspaceShell() {
  const engagementId = useMatch("/e/:id/*")?.params.id;
  const hostId = useMatch("/e/:id/h/:hostId")?.params.hostId;
  useTabRouting(engagementId);
  useDrawerTabs();

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
