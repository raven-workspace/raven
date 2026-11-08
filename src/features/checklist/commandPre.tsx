/** A command in a plain block: wraps at whitespace; only a word longer than the whole line breaks, so it never scrolls sideways. */
export const COMMAND_PRE = "m-0 overflow-x-hidden whitespace-pre-wrap rounded-sm border border-line bg-surface px-2 py-2 font-mono text-code text-fg";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One word with its unresolved tokens wrapped in a warn-coloured mark (no background). */
function Marked({ word, re, tokens }: { word: string; re: RegExp | null; tokens: string[] }) {
  if (!re) return <>{word}</>;
  return (
    <>
      {word.split(re).map((part, i) =>
        tokens.includes(part) ? (
          <mark key={i} className="bg-transparent text-warn">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The command text, one span per whitespace-separated word, so a line wraps only at spaces (never inside `-sV` or an
 * IP). A word longer than the whole line breaks inside its own span rather than scrolling the block sideways. The spaces
 * stay plain text, so copying the text is unchanged.
 */
export function MarkedText({ text, tokens }: { text: string; tokens: string[] }) {
  const re = tokens.length > 0 ? new RegExp(`(${tokens.map(escape).join("|")})`) : null;
  return (
    <>
      {text.split(/(\s+)/).map((part, i) =>
        part === "" ? null : /^\s+$/.test(part) ? (
          part
        ) : (
          <span key={i} data-testid="command-word" className="inline-block max-w-full [overflow-wrap:anywhere]">
            <Marked word={part} re={re} tokens={tokens} />
          </span>
        ),
      )}
    </>
  );
}
