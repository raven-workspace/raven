import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Dashboard } from "./features/engagements/Dashboard/Dashboard";
import { SectionView } from "./features/engagements/sections/sections";
import { EngagementShell, HostRoute, SectionRoute } from "./features/engagements/EngagementShell/EngagementShell";
import { ArsenalBrowse } from "./features/arsenal/ArsenalBrowse/ArsenalBrowse";
import { ManualPage } from "./features/manual/ManualPage/ManualPage";
import { PayloadsWorkbench } from "./features/payloads/PayloadsWorkbench/PayloadsWorkbench";
import { SettingsPage } from "./features/settings/SettingsPage/SettingsPage";
import { useEscapeTo } from "./lib/keys";
import { TooltipProvider } from "./ui";
import { useVault, VaultGate } from "./features/vault/VaultGate/VaultGate";
import { WorkspaceShell } from "./features/workspace/WorkspaceShell/WorkspaceShell";
import { ArsenalTab } from "./features/workspace/ArsenalTab/ArsenalTab";
import { NotesPage } from "./features/notes/NotesPage/NotesPage";
import { FindingPage } from "./features/findings/FindingPage/FindingPage";
import { WORKSPACE_SHELL } from "./lib/shell";

// Dev-only component gallery. `import.meta.env.DEV` is false in builds, so the
// route and its chunk are dropped from release bundles.
const UiGallery = import.meta.env.DEV ? lazy(() => import("./dev/UiGallery")) : null;
// Audit mode only (`npm run dev:audit`): the sample report's §4.1 beside Raven's plain draft of the garnet fixture.
const ReportCompare = import.meta.env.MODE === "audit" ? lazy(() => import("./dev/ReportCompare")) : null;

function SettingsRoute() {
  useEscapeTo("/");
  return <SettingsPage onRestored={useVault().markLocked} />;
}

export default function App() {
  // Both shells render the same pages; the workspace shell wraps them in its window grid (src/lib/shell.ts).
  const pages = (
    <>
      <Route index element={<Dashboard />} />
      <Route path="e/:id" element={<EngagementShell layout={WORKSPACE_SHELL ? "workspace" : "sidebar"} />}>
        <Route index element={<SectionView section="board" />} />
        <Route path="s/:section" element={<SectionRoute />} />
        <Route path="h/:hostId" element={<HostRoute />} />
        {/* In the workspace shell the drawers are editor tabs, and a finding opens in one (design §2.1). */}
        {WORKSPACE_SHELL && (
          <>
            <Route path="f/:findingId" element={<FindingPage />} />
            <Route path="notes/:hostId?" element={<NotesPage />} />
            <Route path="arsenal" element={<ArsenalTab />} />
            <Route path="manual/:noteId?" element={<ManualPage />} />
            <Route path="payloads" element={<PayloadsWorkbench />} />
          </>
        )}
      </Route>
      <Route path="arsenal" element={<ArsenalBrowse />} />
      <Route path="manual/:noteId?" element={<ManualPage />} />
      <Route path="payloads" element={<PayloadsWorkbench />} />
      <Route path="settings" element={<SettingsRoute />} />
      {ReportCompare && (
        <Route
          path="__compare/garnet"
          element={
            <Suspense fallback={null}>
              <ReportCompare />
            </Suspense>
          }
        />
      )}
      {UiGallery && (
        <Route
          path="__ui"
          element={
            <Suspense fallback={null}>
              <UiGallery />
            </Suspense>
          }
        />
      )}
    </>
  );
  return (
    <TooltipProvider>
    <VaultGate chrome={WORKSPACE_SHELL ? "workspace" : "title-bar"}>
      <Routes>{WORKSPACE_SHELL ? <Route element={<WorkspaceShell />}>{pages}</Route> : pages}</Routes>
    </VaultGate>
    </TooltipProvider>
  );
}
