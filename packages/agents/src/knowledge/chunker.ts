// ---------------------------------------------------------------------------
// Text Chunker — Recursive text splitter for RAG document ingestion
// ---------------------------------------------------------------------------
// Splits text into ~500 token chunks with configurable overlap.
// Token count approximated as text.length / 4.
// Splits on paragraph > sentence > word boundaries in priority order.
// ---------------------------------------------------------------------------

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

export interface TextChunk {
  content: string;
  index: number;
}

const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 50;
const CHARS_PER_TOKEN = 4;

const SPLIT_SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", " "];

function splitBySeparator(text: string, separator: string): string[] {
  const parts = text.split(separator);
  // Re-attach separator to each part (except the last)
  return parts.map((part, i) => (i < parts.length - 1 ? part + separator : part));
}

function recursiveSplit(text: string, maxChars: number, separatorIdx: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  if (separatorIdx >= SPLIT_SEPARATORS.length) {
    // Last resort: hard cut
    const result: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      result.push(text.slice(i, i + maxChars));
    }
    return result;
  }

  const separator = SPLIT_SEPARATORS[separatorIdx]!;
  const parts = splitBySeparator(text, separator);

  if (parts.length <= 1) {
    return recursiveSplit(text, maxChars, separatorIdx + 1);
  }

  const result: string[] = [];
  let current = "";

  for (const part of parts) {
    if (current.length + part.length > maxChars && current.length > 0) {
      result.push(current);
      current = part;
    } else {
      current += part;
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  // Recursively split any chunks still over the limit
  return result.flatMap((chunk) =>
    chunk.length > maxChars ? recursiveSplit(chunk, maxChars, separatorIdx + 1) : [chunk],
  );
}

export function chunkText(text: string, options?: ChunkOptions): TextChunk[] {
  if (!text.trim()) {
    return [];
  }

  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const rawChunks = recursiveSplit(text.trim(), maxChars, 0);

  if (overlapChars <= 0 || rawChunks.length <= 1) {
    return rawChunks.map((content, index) => ({ content: content.trim(), index }));
  }

  // Apply overlap
  const result: TextChunk[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const current = rawChunks[i] ?? "";
    if (i === 0) {
      result.push({ content: current.trim(), index: i });
    } else {
      const prevContent = rawChunks[i - 1] ?? "";
      const overlapText = prevContent.slice(-overlapChars);
      const combined = (overlapText + current).trim();
      result.push({ content: combined, index: i });
    }
  }

  return result;
}
