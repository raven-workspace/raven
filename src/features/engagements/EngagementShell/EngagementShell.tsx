import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { api } from "../../../lib/api";
import { reportError } from "../../../lib/lockSignal";
import { isFreeKey, useEscapeTo, useKeydown } from "../../../lib/keys";
import type { Engagement } from "../../../types/engagement";
import { Button, EmptyState, queryState } from "../../../ui/index";
import { boardsSynced, resyncAndRefresh } from "../../checklist/resync";
import { autoTickFromLog } from "../../checklist/ticks";
import { HostView } from "../../hosts/HostView/HostView";
import { CapturePanel } from "../../capture/CapturePanel/CapturePanel";
import { NotesPanel } from "../../notes/NotesPanel/NotesPanel";
import { useNotesStore } from "../../notes/useNotesStore";
import { useCaptureStore } from "../../capture/useCaptureStore";
import { cx } from "../../../lib/cx";
import { EngagementHeader } from "../EngagementHeader/EngagementHeader";
import { Sidebar } from "../Sidebar/Sidebar";
import { StatusStrip } from "../StatusStrip/StatusStrip";
import { SECTIONS, SectionView, sectionPath, type SectionId } from "../sections/sections";
import { engagementKey, engagementsKey } from "../queries";
import "./EngagementShell.scss";

/** Layout for `/e/:id/*`: sidebar, header, status strip and the routed section. */
export function EngagementShell() {
  const { id = "", hostId, section } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openCapture = useCaptureStore((s) => s.openCapture);
  const query = useQuery({
    queryKey: engagementKey(id),
    queryFn: () => api.engagementGet(id),
    initialData: () => qc.getQueryData<Engagement[]>(engagementsKey)?.find((e) => e.id === id),
  });

  // F-R1: an engagement logged before step 3 has an empty checklist; tick it from its log once, on open, before
  // anything else syncs the board. Not blocking: a failure goes to the shared error path (a lock reaches the gate),
  // and the next open tries again.
  useEffect(() => {
    autoTickFromLog(id)
      .then((ran) => {
        if (!ran) return;
        void boardsSynced(qc, id);
      })
      // Then once more, so an imported or older engagement gets the domain admin cover. Runs whether the tick ran or not.
      .then(() => resyncAndRefresh(qc, id), reportError);
  }, [id, qc]);

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
    if (e.key === "n" || e.key === "N") {
      // N: field notes. In a host view they open on that host.
      e.preventDefault();
      useNotesStore.getState().toggle(hostId ? "host" : "engagement");
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length) {
      e.preventDefault();
      void navigate(sectionPath(id, SECTIONS[n - 1]!.id));
    }
  });

  if (query.isError && (query.error as { code?: string }).code === "not_found") {
    return (
      <div className="engagement-shell__state">
        <EmptyState
          title="Engagement not found"
          body="It may have been deleted."
          action={<Button onClick={() => void navigate("/")}>Back to engagements</Button>}
        />
      </div>
    );
  }
  if (!query.data) return <div className="engagement-shell__state">{queryState([query], "this engagement")}</div>;
  const e = query.data;
  // The Report section has its own strip (file name, due in, gaps) in this one's place: never two strips stacked.
  const strip = section !== "report";
  const bars = (hostId ? 0 : 1) + (strip ? 1 : 0);

  return (
    <div className="engagement-shell">
      <Sidebar engagementId={id} />
      {/* On a host page the host is the subject: no engagement header; the strip carries the engagement's name. */}
      <div className={cx("engagement-shell__column", bars === 2 && "engagement-shell__column--two-bars")}>
        {!hostId && <EngagementHeader engagement={e} />}
        {strip && <StatusStrip engagement={e} named={!!hostId} />}
        {/* The Report lays out its own panes and strip edge to edge. */}
        <main className={cx("engagement-shell__main", strip && "engagement-shell__main--padded")}>
          <Outlet />
        </main>
      </div>
      <CapturePanel engagement={e} />
      <NotesPanel engagement={e} hostId={hostId ?? null} />
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
