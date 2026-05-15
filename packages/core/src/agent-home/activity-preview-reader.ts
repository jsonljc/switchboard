// packages/core/src/agent-home/activity-preview-reader.ts

// TODO(task-3): When @switchboard/schemas exports ThreadMessage, replace the
// inline shape below with:
//   import type { ThreadMessage } from "@switchboard/schemas";
//   export type ThreadMessageRecord = ThreadMessage & { createdAt: string };
//
// The cockpit UI does not render per-message timestamps, so the translator
// drops `createdAt` before placing rows in ActivityRow.preview. The reader
// carries it because group-by-createdAt is needed for ordering.
export type ThreadMessageRecord = {
  from: "contact" | "alex" | "operator";
  text: string;
  // ISO-8601 string; used for ordering, not displayed in the cockpit UI.
  createdAt: string;
};

export interface ActivityPreviewReader {
  readRecentBatch(args: {
    contactIds: readonly string[];
    orgId: string;
    limit: number;
  }): Promise<Record<string, readonly ThreadMessageRecord[]>>;
}
