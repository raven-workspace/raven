import { useMemo, type Ref } from "react";
import { getToolkit } from "../../engines/library/store";
import { TokenInput } from "../palette/TokenInput";
import type { Suggestion } from "../palette/suggest";

/** Tokens that name a file to transfer: they get the Toolkit picker. */
export const isFileToken = (name: string): boolean => {
  const t = name.toUpperCase().replace(/-/g, "_");
  return t === "FILE" || t === "SCRIPT" || t.endsWith("_FILE");
};

/**
 * The Toolkit file picker: files for the target OS (all when unknown), staged first, each with its purpose. Free text
 * is allowed; a file the Toolkit lists as not staged shows where to get it.
 */
export function FilePicker({ name, os, value, onChange, className, placeholder, autoValue, ref }: {
  name: string; os?: "windows" | "linux" | null; value: string; onChange: (value: string) => void;
  className?: string; placeholder?: string; autoValue?: boolean; ref?: Ref<HTMLInputElement>;
}) {
  const toolkit = getToolkit();
  const files = useMemo(
    () => toolkit.filter((f) => !os || f.os === os).sort((a, b) => Number(b.staged) - Number(a.staged)),
    [toolkit, os],
  );
  const suggestions: Suggestion[] = files.map((f) => ({ value: f.file, hint: f.staged ? f.purpose : `${f.purpose}, not staged` }));
  const picked = files.find((f) => f.file === value.trim());
  return (
    <span className="inline-grid gap-1">
      <TokenInput name={name} className={className} placeholder={placeholder} autoValue={autoValue} value={value} suggestions={suggestions} onChange={onChange} ref={ref} />
      {picked && !picked.staged && (
        <span role="note" className="max-w-xs text-meta text-warn">
          not staged on Kali; get it from: {picked.where || "unknown"}
          {picked.note ? ` ${picked.note}` : ""}
        </span>
      )}
    </span>
  );
}
