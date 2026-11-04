import { RavenError } from "../types/errors";

const listeners = new Set<() => void>();

/** Subscribe to "the backend says the vault is locked". Returns an unsubscribe function. */
export function onLockedError(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Call with any rejected query/mutation error; fires the callbacks when it is `locked`. */
export function reportError(err: unknown): void {
  if (RavenError.from(err).code !== "locked") return;
  for (const cb of [...listeners]) cb();
}
