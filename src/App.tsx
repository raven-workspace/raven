import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Dashboard } from "./features/engagements/Dashboard";
import { SectionView } from "./features/engagements/sections";
import {
  EngagementShell,
  HostRoute,
  SectionRoute,
} from "./features/engagements/EngagementShell";
import { ArsenalBrowse } from "./features/arsenal/ArsenalBrowse";
import { PayloadsWorkbench } from "./features/payloads/PayloadsWorkbench";
import { SettingsPage } from "./features/settings/SettingsPage";
import { useEscapeTo } from "./lib/keys";
import { TooltipProvider } from "./ui";
import { useVault, VaultGate } from "./features/vault/VaultGate";

// Dev-only component gallery. `import.meta.env.DEV` is false in builds, so the
// route and its chunk are dropped from release bundles.
const UiGallery = import.meta.env.DEV
  ? lazy(() => import("./dev/UiGallery"))
  : null;

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
          <Route path="payloads" element={<PayloadsWorkbench />} />
          <Route path="settings" element={<SettingsRoute />} />
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
