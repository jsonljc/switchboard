"use client";

import type { ReactNode } from "react";

export function ZoneSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="zone-skeleton">
      <div className="skeleton-line" />
      <div className="skeleton-line" />
    </div>
  );
}

export function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="zone-error">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="btn btn-text">
        Retry
      </button>
    </div>
  );
}

export function ZoneEmpty({ message, cta }: { message: string; cta?: ReactNode }) {
  return (
    <div className="zone-empty">
      <p>{message}</p>
      {cta}
    </div>
  );
}
