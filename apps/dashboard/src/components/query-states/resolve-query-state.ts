/**
 * The keys-pending-safe state machine behind <QueryStates>.
 *
 * Every dashboard read hook is `enabled: !!keys` (useScopedQueryKeys() is null
 * until the session resolves orgId). A disabled query is pending+idle, so React
 * Query reports isLoading:false, data:undefined, error:null. A gate written
 * `if (isLoading)` is therefore skipped during keys-pending and flashes a
 * false-empty. We never read isLoading; we derive state from {data, error}.
 *
 * Precedence: data (incl. empty) ▸ error ▸ loading. `data != null` wins over
 * `error` so a cached list survives a failed background poll.
 */
export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "empty" }
  | { status: "data"; data: T };

export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
}

export function resolveQueryState<T>(
  query: QueryLike<T>,
  isEmpty?: (data: T) => boolean,
): QueryState<T> {
  if (query.data != null) {
    return isEmpty?.(query.data) ? { status: "empty" } : { status: "data", data: query.data };
  }
  if (query.error != null) return { status: "error", error: query.error };
  return { status: "loading" };
}
