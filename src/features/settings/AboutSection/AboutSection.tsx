import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../lib/api";
import { Button, Dialog, Panel, queryState } from "../../../ui/index";
import "./AboutSection.scss";

/** Settings › About: Raven's licence, and the open source licences of everything it ships (THIRD_PARTY_NOTICES). */
export function AboutSection() {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      title="About"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          Open source licences
        </Button>
      }
    >
      <p className="about-section__text">
        Raven Workspace Community Edition is free software under the GNU AGPL-3.0. It is built with open source software,
        each part under its own licence. Open source licences lists them all, and the same list comes with the app as
        THIRD_PARTY_NOTICES.
      </p>
      <Dialog open={open} onOpenChange={setOpen} title="Open source licences" size="xl">
        {open && <Notices />}
      </Dialog>
    </Panel>
  );
}

function Notices() {
  // A file in the app bundle: it never changes while the app runs, and a failed read won't pass on a retry.
  const notices = useQuery({ queryKey: ["thirdPartyNotices"], queryFn: api.thirdPartyNotices, staleTime: Infinity, retry: false });
  return (
    <>
      {queryState([notices], "the licences")}
      {notices.data !== undefined && (
        // Focusable, so the keyboard can scroll it.
        <pre className="about-section__notices" tabIndex={0} aria-label="Open source licences">
          {notices.data}
        </pre>
      )}
    </>
  );
}
