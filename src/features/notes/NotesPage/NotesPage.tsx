import { useEffect, useRef } from "react";
import { useParams } from "react-router";
import { labelClass } from "../../../ui/index";
import { useEngagement } from "../../engagements/queries";
import { useHosts } from "../../hosts/queries";
import { NoteEditor } from "../NoteEditor/NoteEditor";
import { flushQuietly, noteKey } from "../useNotesStore";
import "./NotesPage.scss";

/**
 * Field notes as an editor tab (`/e/:id/notes` for the engagement's, `/e/:id/notes/:hostId` for a host's): the notes
 * drawer's editor as a page of its own. Text autosaves through the notes store, as in the drawer, and what is pending
 * saves at once when the tab closes or shows another note.
 */
export function NotesPage() {
  const { id = "", hostId } = useParams();
  const target = { engagementId: id, hostId: hostId ?? null };
  const key = noteKey(target);
  const engagement = useEngagement(id).data;
  const host = useHosts(id).data?.find((h) => h.id === hostId);
  const name = hostId ? host?.name : engagement?.name;
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => flushQuietly(), [key]);
  // Opening the tab puts the caret in the note, as opening the drawer did.
  useEffect(() => textRef.current?.focus(), [key]);

  return (
    <section aria-label={name ? `Notes: ${name}` : "Notes"} className="notes-page">
      {/* The space keeps "Notes forge" readable as one heading name; the grid ignores it. */}
      <h2 className="notes-page__title">
        <span className={labelClass}>Notes</span>{" "}
        {name && <span className="notes-page__name" title={name}>{name}</span>}
      </h2>
      <NoteEditor target={target} textRef={textRef} className="notes-page__editor" />
    </section>
  );
}
