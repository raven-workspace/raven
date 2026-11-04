import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router";
import { TitleBar } from "./ui";

// Dev-only component gallery. `import.meta.env.DEV` is false in builds, so the
// route and its chunk are dropped from release bundles.
const UiGallery = import.meta.env.DEV ? lazy(() => import("./dev/UiGallery")) : null;

function Shell() {
  return (
    <div className="flex h-full flex-col bg-bg">
      <TitleBar title="Raven" />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<div data-testid="app-root" />} />
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
      </Route>
    </Routes>
  );
}
