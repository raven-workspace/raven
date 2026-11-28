import { useEffect, useRef } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";
import type { ReferencePage } from "../../engines/tabs";
import { isFreeKey, useKeydown } from "../../lib/keys";
import { useArsenalStore } from "../arsenal/useArsenalStore";
import { MANUAL_NOTE_ID, manualKeysBlocked } from "../manual/keys";
import { NOTES_PAGE_ID } from "../notes/NotesPage/notesPageId";
import { useNotesStore } from "../notes/useNotesStore";
import { usePayloadsStore } from "../payloads/usePayloadsStore";
import { GENERATOR_LIST_ID } from "../payloads/usePayloadSession/usePayloadSession";
import { useEditorTabsStore } from "./useEditorTabsStore";
import { useTargetStore } from "./useTargetStore";

/** What each reference page's key focuses when it is already in view. */
const FOCUS: Record<ReferencePage, string> = { arsenal: "arsenal-search", manual: MANUAL_NOTE_ID, payloads: GENERATOR_LIST_ID };
const KEYS: Record<string, ReferencePage> = { a: "arsenal", m: "manual", p: "payloads" };

/**
 * Opens a reference page or the field notes the way their keys do (A, M, P, N), for the rail's buttons too: the page's
 * tab where it was left, or, already on it, its first control.
 */
export function useOpenView() {
  const navigate = useNavigate();
  const location = useLocation();
  const engagementId = useMatch("/e/:id/*")?.params.id ?? null;
  const routeHost = useMatch("/e/:id/h/:hostId")?.params.hostId ?? null;
  const matched = {
    arsenal: [useMatch("/arsenal"), useMatch("/e/:id/arsenal")],
    manual: [useMatch("/manual/*"), useMatch("/e/:id/manual/*")],
    payloads: [useMatch("/payloads"), useMatch("/e/:id/payloads")],
  };
  const onPage = (page: ReferencePage) => matched[page].some((m) => m !== null);

  /** Shows a reference page: its tab where it was left (or `fresh`, a route of its own), else its full page. */
  const showReference = (page: ReferencePage, fresh?: string) => {
    if (!engagementId) return void navigate(fresh ?? `/${page}`);
    const tab = useEditorTabsStore.getState().byEngagement[engagementId]?.find((t) => t.key === page);
    void navigate(fresh ? `/e/${engagementId}${fresh}` : (tab?.route ?? `/e/${engagementId}/${page}`));
  };
  /** The page, or on it, its first control. */
  const openReference = (page: ReferencePage) => {
    if (onPage(page)) document.getElementById(FOCUS[page])?.focus();
    else showReference(page);
  };
  /** The note's tab, or on it, its text. */
  const showNotes = (hostId: string | null) => {
    if (!engagementId) return;
    const route = hostId ? `/e/${engagementId}/notes/${encodeURIComponent(hostId)}` : `/e/${engagementId}/notes`;
    if (route !== location.pathname) void navigate(route);
    else document.querySelector<HTMLTextAreaElement>(`#${NOTES_PAGE_ID} textarea`)?.focus();
  };
  /** As N: on a host page its notes, else the engagement's (the notes store's subscription opens the tab). */
  const openNotes = () => useNotesStore.getState().toggle(routeHost ? "host" : "engagement");
  return { engagementId, routeHost, showReference, openReference, showNotes, openNotes };
}

/**
 * The drawers retired (docs/specs/terminal.md §8): in the workspace shell Arsenal, Manual, Payloads and Field notes
 * open as editor tabs inside an engagement, and Arsenal, Manual and Payloads as full pages from the Dashboard. Every
 * way in that used to open a drawer (A, P, N, ⌘K, a card link, More in Arsenal) still asks the drawer's store to open;
 * this turns that request into the page, and the drawer itself is never mounted.
 */
export function useDrawerTabs() {
  const { showReference, openReference, showNotes, engagementId, routeHost } = useOpenView();

  // The stores' subscriptions outlive renders: they read the latest of these through a ref.
  const latest = useRef({ showReference, showNotes, engagementId, routeHost });
  useEffect(() => {
    latest.current = { showReference, showNotes, engagementId, routeHost };
  });

  useEffect(() => {
    const offArsenal = useArsenalStore.subscribe((s) => {
      if (!s.open) return;
      // A command with no card opens on its own row; a card on the card. ArsenalBrowse reads both as it mounts.
      const { cardId, solo } = s;
      useArsenalStore.setState({
        open: false,
        fromManual: false,
        solo: null,
        ...(solo ? { cardId: null, lastRead: { kind: "command" as const, id: solo.id } } : {}),
      });
      latest.current.showReference("arsenal", cardId || solo ? "/arsenal" : undefined);
    });
    const offPayloads = usePayloadsStore.subscribe((s) => {
      if (!s.open) return;
      usePayloadsStore.setState({ open: false });
      latest.current.showReference("payloads", `/payloads?generator=${encodeURIComponent(s.generator)}`);
    });
    const offNotes = useNotesStore.subscribe((s) => {
      if (!s.open) return;
      useNotesStore.setState({ open: false });
      const { engagementId: eid, routeHost: host } = latest.current;
      const target = eid ? (useTargetStore.getState().byEngagement[eid] ?? null) : null;
      latest.current.showNotes(s.scope === "host" ? (host ?? target) : null);
    });
    return () => {
      offArsenal();
      offPayloads();
      offNotes();
    };
  }, []);

  // A, M and P: the page, or on it, its first control.
  useKeydown((e) => {
    const page = KEYS[e.key.toLowerCase()];
    if (!page || !isFreeKey(e) || (page === "manual" && manualKeysBlocked())) return;
    e.preventDefault();
    openReference(page);
  });
}
