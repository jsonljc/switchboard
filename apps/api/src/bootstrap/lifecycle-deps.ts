// ---------------------------------------------------------------------------
// Lifecycle Deps — contact lifecycle + fallback handler wiring
// ---------------------------------------------------------------------------
// Stubbed after domain code removal. Returns null to disable lifecycle routes.
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";

export interface LifecycleDeps {
  /** Placeholder for lifecycle service methods. */
  enabled: boolean;
}

export function buildLifecycleDeps(_prisma: PrismaClient): LifecycleDeps | null {
  // Lifecycle system not yet wired — return null to disable lifecycle routes
  return null;
}
