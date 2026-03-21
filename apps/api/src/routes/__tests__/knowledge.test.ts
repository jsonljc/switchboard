import { describe, it, expect } from "vitest";

interface DocumentListItem {
  documentId: string;
  fileName: string;
  sourceType: string;
  chunkCount: number;
  uploadedAt: string;
}

function buildDocumentList(
  chunks: Array<{ documentId: string; sourceType: string; createdAt: Date }>,
  fileNames: Map<string, string>,
): DocumentListItem[] {
  const grouped = new Map<string, { sourceType: string; count: number; earliest: Date }>();

  for (const chunk of chunks) {
    const existing = grouped.get(chunk.documentId);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(chunk.documentId, {
        sourceType: chunk.sourceType,
        count: 1,
        earliest: chunk.createdAt,
      });
    }
  }

  return Array.from(grouped.entries()).map(([docId, info]) => ({
    documentId: docId,
    fileName: fileNames.get(docId) ?? docId,
    sourceType: info.sourceType,
    chunkCount: info.count,
    uploadedAt: info.earliest.toISOString(),
  }));
}

describe("Knowledge Document List", () => {
  it("groups chunks by documentId", () => {
    const now = new Date();
    const chunks = [
      { documentId: "doc1", sourceType: "document", createdAt: now },
      { documentId: "doc1", sourceType: "document", createdAt: now },
      { documentId: "doc2", sourceType: "wizard", createdAt: now },
    ];
    const names = new Map([
      ["doc1", "menu.pdf"],
      ["doc2", "wizard-data"],
    ]);

    const result = buildDocumentList(chunks, names);
    expect(result).toHaveLength(2);
    expect(result[0]?.chunkCount).toBe(2);
    expect(result[0]?.fileName).toBe("menu.pdf");
    expect(result[1]?.chunkCount).toBe(1);
  });
});
