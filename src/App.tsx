import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Dashboard } from "./features/engagements/Dashboard";
import { SectionView } from "./features/engagements/sections";
import { EngagementShell, HostRoute, SectionRoute } from "./features/engagements/EngagementShell";
import { ArsenalBrowse } from "./features/arsenal/ArsenalBrowse";
import { ManualPage } from "./features/manual/ManualPage";
import { PayloadsWorkbench } from "./features/payloads/PayloadsWorkbench";
import { SettingsPage } from "./features/settings/SettingsPage";
import { useEscapeTo } from "./lib/keys";
import { TooltipProvider } from "./ui";
import { useVault, VaultGate } from "./features/vault/VaultGate";

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
  return (
    <TooltipProvider>
    <VaultGate>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="e/:id" element={<EngagementShell />}>
          <Route index element={<SectionView section="board" />} />
          <Route path="s/:section" element={<SectionRoute />} />
          <Route path="h/:hostId" element={<HostRoute />} />
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
      </Routes>
    </VaultGate>
    </TooltipProvider>
  );
}
