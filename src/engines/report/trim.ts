const INLINE_MAX_LINES = 60;
const DEFAULT_HEAD_LINES = 40;

/** The lines an output starts with on the page: all of it when short, else the first 40 for the owner to widen. */
export function defaultKeep(lineCount: number): [number, number][] | null {
  return lineCount <= INLINE_MAX_LINES ? null : [[0, DEFAULT_HEAD_LINES - 1]];
}
