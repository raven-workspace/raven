import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useParams } from "react-router";
import { api } from "../../lib/api";
import { isFreeKey, useEscapeTo, useKeydown } from "../../lib/keys";
import type { Engagement } from "../../types/engagement";
import { EmptyState } from "../../ui";
import { HostView } from "../hosts/HostView";
import { CapturePanel } from "../capture/CapturePanel";
import { useCaptureStore } from "../capture/useCaptureStore";
import { EngagementHeader } from "./EngagementHeader";
import { Sidebar } from "./Sidebar";
import { StatusStrip } from "./StatusStrip";
import { SECTIONS, SectionView, sectionPath, type SectionId } from "./sections";

/** Layout for `/e/:id/*`: sidebar, header, status strip and the routed section. */
export function EngagementShell() {
  const { id = "", hostId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openCapture = useCaptureStore((s) => s.openCapture);
  const query = useQuery({
    queryKey: ["engagement", id],
    queryFn: () => api.engagementGet(id),
    initialData: () => qc.getQueryData<Engagement[]>(["engagements"])?.find((e) => e.id === id),
  });

  // Esc: host view -> engagement, engagement -> dashboard.
  useEscapeTo(hostId ? `/e/${id}` : "/");
  useKeydown((e) => {
    if (!isFreeKey(e)) return;
    if (e.key === "l" || e.key === "L") {
      // L: capture. From a host view, that host is preselected.
      e.preventDefault();
      openCapture({ engagementId: id, hostId: hostId ?? null });
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length) {
      e.preventDefault();
      void navigate(sectionPath(id, SECTIONS[n - 1]!.id));
    }
  });

  if (query.isError) {
    const missing = (query.error as { code?: string }).code === "not_found";
    return (
      <div className="px-8 py-6">
        <EmptyState
          title={missing ? "Engagement not found" : "Couldn't load this engagement"}
          body={missing ? "It may have been deleted." : query.error.message}
          action={
            <Link to="/" className="text-[13px] text-fg-2 hover:text-fg">
              Back to engagements
            </Link>
          }
        />
      </div>
    );
  }
  if (!query.data) return null;
  const e = query.data;

  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_1fr]">
      <Sidebar engagementId={id} />
      <div className="flex min-h-0 min-w-0 flex-col">
        <EngagementHeader engagement={e} />
        <StatusStrip engagement={e} />
        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <Outlet />
        </main>
      </div>
      <CapturePanel engagement={e} />
    </div>
  );
}

/** `e/:id/s/:section`; unknown sections fall back to the board. */
export function SectionRoute() {
  const { section } = useParams();
  const known = SECTIONS.some((s) => s.id === section);
  return <SectionView section={known ? (section as SectionId) : "board"} />;
}

/** `e/:id/h/:hostId`. */
export function HostRoute() {
  const { id = "", hostId = "" } = useParams();
  return <HostView engagementId={id} hostId={hostId} />;
}
