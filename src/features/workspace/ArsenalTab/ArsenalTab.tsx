import { useLocation } from "react-router";
import { ArsenalBrowse } from "../../arsenal/ArsenalBrowse/ArsenalBrowse";

/**
 * The Arsenal as an editor tab (`/e/:id/arsenal`). It opens on the card the opener asked for (the Arsenal store's
 * card), which ArsenalBrowse reads once as it mounts, so each opening mounts it afresh.
 */
export function ArsenalTab() {
  const location = useLocation();
  return <ArsenalBrowse key={location.key} />;
}
