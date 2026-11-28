import { KeyIcon } from "@phosphor-icons/react";
import { SHORTCUTS } from "../../../lib/shortcuts";
import { Field, fieldLabelClass, Input, Select, Textarea, Toggle } from "../../../ui/index";
import { HostChips } from "../HostChips/HostChips";
import { KindFields } from "../KindFields/KindFields";
import type { LogEntryFormState } from "../useLogEntryForm";
import "./LogEntryFields.scss";

/**
 * The log entry's fields, in order: Title; a screenshot's caption and file name or a flag's local/proof; the linked
 * hosts with their services or credentials line; Ran on; Observations. A fragment, so the sheet's body and the tab's
 * right column space them with their own gaps. The tab labels the hosts ("Hosts"), as its column does every field.
 */
export function LogEntryFields({ form, labelHosts = false }: { form: LogEntryFormState; labelHosts?: boolean }) {
  const { pd, r, hosts, hostsQ, set, enterSaves, captionRef, ranOnOptions } = form;
  const chips = (
    <HostChips
      hosts={hosts} linked={r.edits.hostIds} onLinked={(hostIds) => set({ hostIds })}
      loadError={hostsQ.isError ? { retry: () => void hostsQ.refetch() } : null}
    />
  );
  return (
    <>
      <Field label="Title">
        <Input
          value={r.titleInput}
          placeholder={r.autoTitle}
          onChange={(e) => set({ title: e.target.value, titleEdited: true })}
          onKeyDown={enterSaves}
        />
      </Field>

      <KindFields
        content={r.edits.content}
        caption={pd.caption}
        onCaption={(caption) => set({ caption })}
        flagKind={r.flagKind}
        onFlagKind={(flagKind) => set({ flagKind })}
        onKeyDown={enterSaves}
        captionRef={captionRef}
      />

      {labelHosts ? (
        <div className="log-entry-fields__hosts">
          {/* The chips are already named "Hosts" (their group), so the visible label is not read twice. */}
          <span className={fieldLabelClass} aria-hidden>
            Hosts
          </span>
          {chips}
        </div>
      ) : (
        chips
      )}
      {r.servicesLine && <p className="log-entry-fields__services">{r.servicesLine}</p>}
      {r.credentialsLine && (
        // The only cue that saving writes credential rows: foreground text with a key, unlike the services line.
        <p className="log-entry-fields__credentials">
          <KeyIcon size={16} weight="regular" aria-hidden className="log-entry-fields__key" />
          <span className="log-entry-fields__credentials-text">{r.credentialsLine}</span>
        </p>
      )}
      <Field label="Ran on">
        <Select
          value={r.edits.ranOn}
          onValueChange={(ranOn) => set({ ranOn })}
          placeholder="Machine"
          options={ranOnOptions.map((v) => ({ value: v, label: v }))}
          className="log-entry-fields__ran-on"
        />
      </Field>

      <Field label="Observations">
        <Textarea
          rows={2}
          value={pd.observations}
          placeholder="Tentative notes, not proven facts"
          onChange={(e) => set({ observations: e.target.value })}
          onKeyDown={enterSaves}
        />
      </Field>
    </>
  );
}

/** The toggles that apply: "Returned nothing" for a command, "Add as credentials" when a note holds them, "Private". */
export function LogEntryToggles({ form }: { form: LogEntryFormState }) {
  const { pd, r, kind, set } = form;
  return (
    <>
      {kind === "command" && (
        <Toggle on={pd.returnedNothing} keys={SHORTCUTS.captureReturnedNothing} onChange={() => set({ returnedNothing: !pd.returnedNothing })}>
          Returned nothing
        </Toggle>
      )}
      {r.credentials.length > 0 && (
        <Toggle on={!pd.asNote} keys={SHORTCUTS.captureAsNote} onChange={() => set({ asNote: !pd.asNote })}>
          Add as {r.credentials.length === 1 ? "credential" : "credentials"}
        </Toggle>
      )}
      <Toggle on={pd.private} keys={SHORTCUTS.capturePrivate} onChange={() => set({ private: !pd.private })}>
        Private
      </Toggle>
    </>
  );
}
