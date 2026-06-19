"use client";
import type { ReactNode } from "react";
import { resolveQueryState, type QueryLike } from "./resolve-query-state";
import { ConnectionTrouble, AllClear } from "./states";
import { Skeleton } from "./skeleton";

export interface QueryStatesProps<T> {
  query: QueryLike<T>;
  isEmpty?: (data: T) => boolean;
  loading?: ReactNode;
  error?: ReactNode | ((error: unknown) => ReactNode);
  empty?: ReactNode;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}

function DefaultLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 px-6 py-8">
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

export function QueryStates<T>({
  query,
  isEmpty,
  loading,
  error,
  empty,
  onRetry,
  children,
}: QueryStatesProps<T>) {
  const state = resolveQueryState(query, isEmpty);
  switch (state.status) {
    case "loading":
      return <>{loading ?? <DefaultLoading />}</>;
    case "error":
      if (typeof error === "function") return <>{error(state.error)}</>;
      return <>{error ?? <ConnectionTrouble onRetry={onRetry} />}</>;
    case "empty":
      return <>{empty ?? <AllClear />}</>;
    case "data":
      return <>{children(state.data)}</>;
  }
}
