import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

/** The part of a react-query result this needs. */
export interface QueryLike {
  error: Error | null;
  isPending: boolean;
  refetch: () => unknown;
}

/**
 * The state of a pane that needs every query in `queries`: ErrorState (Retry refetches what failed) if any
 * failed, LoadingState while any is pending, else null (render the content). `what` names it: "credentials".
 */
export function queryState(queries: QueryLike[], what: string) {
  const failed = queries.filter((q) => q.error);
  if (failed.length > 0) {
    return (
      <ErrorState
        title={`Couldn't load ${what}`}
        hint="Retry. If it keeps failing, lock and unlock Raven."
        onRetry={() => failed.forEach((q) => void q.refetch())}
        detail={failed[0]!.error!.message}
      />
    );
  }
  if (queries.some((q) => q.isPending)) return <LoadingState label={what} />;
  return null;
}
