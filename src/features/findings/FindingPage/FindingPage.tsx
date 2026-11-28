import { useLocation, useNavigate, useParams } from "react-router";
import { boardRoute } from "../../../engines/tabs";
import { EmptyState, queryState } from "../../../ui/index";
import { useEditorTabsStore } from "../../workspace/useEditorTabsStore";
import { FindingSplit } from "../FindingSplit/FindingSplit";
import { useFindings } from "../queries";
import "./FindingPage.scss";

/**
 * A finding in an editor tab (`/e/:id/f/:findingId`, workspace shell): the split the Findings section opens, as a page
 * of its own. Saving or leaving the split closes its tab.
 */
export function FindingPage() {
  const { id = "", findingId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const findingsQ = useFindings(id);
  const finding = findingsQ.data?.find((f) => f.id === findingId);

  const closeTab = () => {
    const route = `${location.pathname}${location.search}${location.hash}`;
    const next = useEditorTabsStore.getState().close(id, `f:${findingId}`, route);
    void navigate(next ?? boardRoute(id));
  };

  if (!findingsQ.data) return queryState([findingsQ], "this finding");
  if (!finding) return <EmptyState title="Finding not found" body="It may have been deleted." />;
  // With one affected host its context shows beside the finding, as on the host page.
  const only = finding.hostIds.length === 1 ? finding.hostIds[0]! : null;
  return (
    <div className="finding-page">
      <FindingSplit key={finding.id} eid={id} hostId={only} edit={finding} onClose={closeTab} />
    </div>
  );
}
