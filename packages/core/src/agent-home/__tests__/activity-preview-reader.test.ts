import { describe, expect, it } from "vitest";
import type {
  ActivityPreviewReader,
  ThreadMessageRecord,
} from "../activity-preview-reader.js";

describe("ActivityPreviewReader", () => {
  it("compiles against an in-memory stub", async () => {
    const stub: ActivityPreviewReader = {
      async readRecentBatch({ contactIds, orgId, limit }) {
        const out: Record<string, ThreadMessageRecord[]> = {};
        for (const id of contactIds) {
          out[id] = [
            {
              from: "contact" as const,
              text: `hello from ${id} in ${orgId}`,
              createdAt: new Date(0).toISOString(),
            },
          ].slice(0, limit);
        }
        return out;
      },
    };
    const result = await stub.readRecentBatch({
      contactIds: ["c1", "c2"],
      orgId: "o1",
      limit: 4,
    });
    expect(result.c1).toHaveLength(1);
    expect(result.c2![0]!.text).toContain("c2");
  });
});
