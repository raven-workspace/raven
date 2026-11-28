import * as RD from "@radix-ui/react-dialog";
import type { RefObject } from "react";
import type { Engagement } from "../../../types/engagement";
import { XIcon } from "@phosphor-icons/react";
import { Button, Chip, IconButton, Kbd, Toolbar } from "../../../ui/index";
import { KindChips } from "../KindChips/KindChips";
import { LogEntryFields, LogEntryToggles } from "../LogEntryFields/LogEntryFields";
import { PasteArea } from "../PasteArea/PasteArea";
import { useLogEntryForm } from "../useLogEntryForm";
import { useLogEntryStore } from "../useLogEntryStore";
import "./LogEntryForm.scss";

/**
 * The log entry form as the engagement shell's sheet lays it out: a header, the fields in one scrolling column, and
 * Discard and Save in the footer. Save closes the sheet; Discard clears the draft and keeps it open. The log entry tab
 * (LogEntryTab) lays the same form out for the workspace shell.
 */
export function LogEntryForm({ engagement, pasteRef }: { engagement: Engagement; pasteRef: RefObject<HTMLElement | null> }) {
  const form = useLogEntryForm({
    engagement,
    pasteRef,
    onSaved: () => useLogEntryStore.getState().close(),
    onDiscarded: () => pasteRef.current?.focus(),
  });
  const { pd, r, kind, notice, error, saving, msfWarning, set } = form;

  return (
    <div className="log-entry-form" onKeyDown={form.onKeyDown}>
      <header className="log-entry-form__header">
        <div className="log-entry-form__heading">
          <RD.Title className="log-entry-form__title">Add to log</RD.Title>
          {pd.private && <Chip>Private, not in reports</Chip>}
        </div>
        <RD.Close asChild>
          <IconButton icon={XIcon} label="Close" shortcut="Esc" />
        </RD.Close>
      </header>

      <div className="log-entry-form__body">
        {notice && <p className="log-entry-form__notice">{notice}</p>}
        <KindChips kind={kind} onChange={(k) => set({ kind: k })} />

        <PasteArea
          kind={kind}
          text={pd.text}
          image={pd.image}
          bindRef={form.bindPaste}
          onText={(text) => set({ text })}
          onPaste={form.onPaste}
          onKeyDown={kind === "note" ? form.noteEnter : form.enterSaves}
          onRemoveImage={form.removeImage}
        />

        <LogEntryFields form={form} />

        <Toolbar>
          <LogEntryToggles form={form} />
        </Toolbar>
      </div>

      {msfWarning && <p className="log-entry-form__warning">{msfWarning}</p>}
      <footer className="log-entry-form__footer">
        <Button onClick={form.discard}>Discard</Button>
        <p role="alert" className="log-entry-form__error">
          {error}
        </p>
        <Button variant="primary" onClick={() => void form.save()} disabled={!r.canSave || saving}>
          Save <Kbd variant="inline" aria-hidden>↵</Kbd>
        </Button>
      </footer>
    </div>
  );
}
