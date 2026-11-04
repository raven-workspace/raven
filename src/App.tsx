import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { SettingsPage } from "./features/settings/SettingsPage";
import { useVault, VaultGate } from "./features/vault/VaultGate";

// Dev-only component gallery. `import.meta.env.DEV` is false in builds, so the
// route and its chunk are dropped from release bundles.
const UiGallery = import.meta.env.DEV ? lazy(() => import("./dev/UiGallery")) : null;

function SettingsRoute() {
  return <SettingsPage onRestored={useVault().markLocked} />;
}

export default function App() {
  return (
    <VaultGate>
      <Routes>
        <Route index element={<div data-testid="app-root" />} />
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
  );
}
