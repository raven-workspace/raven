import { MagnifyingGlass } from "@phosphor-icons/react";
import { useMatch, useNavigate } from "react-router";
import { cx } from "../../../lib/cx";
import { hasNativeTitleBar } from "../../../lib/platform";
import { ariaKeys, keyLabel, SHORTCUTS } from "../../../lib/shortcuts";
import { Button, Kbd } from "../../../ui/index";
import { ChipPicker } from "../../arsenal/ChipPicker/ChipPicker";
import { useEngagement, useEngagements } from "../../engagements/queries";
import { sectionPath } from "../../engagements/sections/sections";
import { useHosts } from "../../hosts/queries";
import { usePaletteStore } from "../../palette/usePaletteStore";
import { useTargetStore } from "../useTargetStore";
import "./ChromeBar.scss";

/** The Engagement picker: the engagement in view; picking another opens it. */
function EngagementPicker({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const engagement = useEngagement(engagementId).data;
  const engagements = useEngagements().data ?? [];
  const options = engagements
    .filter((e) => e.status === "active" || e.id === engagementId)
    .map((e) => ({ id: e.id, name: e.name }));
  return (
    <ChipPicker
      prefix="Engagement"
      {...(engagement ? { shown: engagement.name } : {})}
      label={engagement ? `Engagement: ${engagement.name}` : "Engagement"}
      listLabel="Engagements"
      title="Switch engagement"
      align="start"
      options={options}
      value={engagementId}
      onPick={(id) => id && void navigate(`/e/${id}`)}
    />
  );
}

/**
 * The Target picker: the host in view, kept on pages with no host. Picking a host makes it Target (so the Explorer
 * selects it) and opens its page, even when it already is Target and a page with no host is in view.
 */
function TargetPicker({ engagementId }: { engagementId: string }) {
  const navigate = useNavigate();
  const hosts = useHosts(engagementId).data ?? [];
  const targetId = useTargetStore((s) => s.byEngagement[engagementId] ?? null);
  const target = hosts.find((h) => h.id === targetId);
  return (
    <ChipPicker
      prefix="Target"
      {...(target ? { shown: target.name } : {})}
      label={target ? `Target: ${target.name}` : "Target"}
      listLabel="Hosts"
      title="Pick the target host"
      align="start"
      options={hosts.map((h) => ({ id: h.id, name: h.name, ...(h.ip ? { detail: h.ip } : {}) }))}
      value={target?.id ?? null}
      repick
      onPick={(id) => {
        if (!id) return;
        useTargetStore.getState().pick(engagementId, id);
        void navigate(`/e/${engagementId}/h/${id}`);
      }}
    />
  );
}

/**
 * The chrome bar (design §1.3): the window's 38px title bar. macOS draws its window controls over the first track,
 * which stays empty; on Linux the desktop's own title bar sits above, so there is no controls track. Empty space is the
 * drag region (`data-tauri-drag-region` on each empty box); the controls opt out by being controls. Outside an
 * engagement only search shows (the Dashboard has no pickers and no report to build).
 */
export function ChromeBar() {
  const navigate = useNavigate();
  const engagementId = useMatch("/e/:id/*")?.params.id;
  const native = hasNativeTitleBar();
  return (
    <header data-tauri-drag-region className={cx("chrome-bar", native && "chrome-bar--below-native")}>
      {!native && <div data-tauri-drag-region className="chrome-bar__controls" />}
      <div data-tauri-drag-region className="chrome-bar__pickers">
        {engagementId && (
          <>
            <EngagementPicker engagementId={engagementId} />
            <TargetPicker engagementId={engagementId} />
          </>
        )}
      </div>
      <button
        type="button"
        className="chrome-bar__search"
        aria-keyshortcuts={ariaKeys(SHORTCUTS.search)}
        onClick={() => usePaletteStore.getState().open()}
      >
        <MagnifyingGlass size={16} aria-hidden className="chrome-bar__search-icon" />
        <span className="chrome-bar__search-text">Search hosts, notes and commands</span>
        <Kbd aria-hidden="true">{keyLabel(SHORTCUTS.search)}</Kbd>
      </button>
      <div data-tauri-drag-region className="chrome-bar__actions">
        {engagementId && (
          <Button variant="primary" size="md" onClick={() => void navigate(sectionPath(engagementId, "report"))}>
            Build report
          </Button>
        )}
      </div>
    </header>
  );
}
