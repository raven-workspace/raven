import type { ReactNodeViewProps } from "prosekit/react";
import { Select } from "../../../../ui";
import { CODE_LANGUAGES } from "../codeHighlight";

/** Radix Select takes no empty value: plain text ("" on the node) is this in the picker. */
const PLAIN = "text";
export const LANGUAGE_OPTIONS = CODE_LANGUAGES.map((l) => ({ value: l.value || PLAIN, label: l.label }));
export const toPicker = (language: string) => (CODE_LANGUAGES.some((l) => l.value === language) && language ? language : PLAIN);
export const fromPicker = (value: string) => (value === PLAIN ? "" : value);

/**
 * A code block the owner writes (or a command edited on the page): monospace on the code tint, coloured by the app's
 * highlight.js, with its language picker (Ink chrome, never printed) at the top right while hovered or typed in.
 */
export function CodeBlockView({ node, contentRef, setAttrs }: ReactNodeViewProps) {
  const language = (node.attrs.language as string) ?? "";
  return (
    <div className="report-codeblock" data-language={language || undefined}>
      {/* The editable text is a <code> ProseKit puts inside this <pre>. */}
      <pre ref={contentRef} className="report-code report-pre" />
      <div contentEditable={false} className="report-codeblock-lang">
        <Select
          aria-label="Code language"
          className="h-7 w-36"
          options={LANGUAGE_OPTIONS}
          value={toPicker(language)}
          onValueChange={(v) => setAttrs({ language: fromPicker(v) })}
        />
      </div>
    </div>
  );
}
