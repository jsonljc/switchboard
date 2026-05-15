// packages/core/src/agent-home/activity-preview-reader.ts

import type { ThreadMessage } from "@switchboard/schemas";

// Persisted-message extension of the schemas-package ThreadMessage shape.
// The cockpit UI does not render per-message timestamps, so the translator
// drops `createdAt` before placing rows in ActivityRow.preview. The reader
// carries it because group-by-createdAt is needed for ordering.
export type ThreadMessageRecord = ThreadMessage & { createdAt: string };

export interface ActivityPreviewReader {
  readRecentBatch(args: {
    contactIds: readonly string[];
    orgId: string;
    limit: number;
  }): Promise<Record<string, readonly ThreadMessageRecord[]>>;
}
