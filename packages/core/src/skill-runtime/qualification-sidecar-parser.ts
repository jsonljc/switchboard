import {
  QualificationSignalsSchema,
  type WorkTraceQualificationSignals,
} from "@switchboard/schemas";

const OPEN_TAG = "<qualification_signals>";
const CLOSE_TAG = "</qualification_signals>";

export interface ParsedSidecar {
  /** The response text safe to send to the contact — never contains tags. */
  visibleResponse: string;
  /**
   * The audit row to persist on WorkTrace.qualificationSignals. `null` means
   * no sidecar tags were present (column stays NULL).
   */
  persisted: WorkTraceQualificationSignals | null;
}

/**
 * Strict trailing-block parser for the Phase 3b qualification sidecar.
 *
 * Rules (spec §4.2):
 *  - count(<qualification_signals>) > 1  → all blocks stripped, persisted=multiple_blocks.
 *  - count == 0                          → response unchanged, persisted=null.
 *  - count == 1, JSON-malformed          → block stripped, persisted=malformed_json.
 *  - count == 1, schema-mismatch         → block stripped, persisted=schema_mismatch.
 *  - count == 1, valid                   → block stripped, persisted=ok with payload.
 *
 * The block is always stripped from `visibleResponse` regardless of validity —
 * contacts must never see protocol leakage on any code path.
 */
export function parseQualificationSidecar(raw: string): ParsedSidecar {
  const openMatches = raw.match(new RegExp(OPEN_TAG, "g")) ?? [];
  const count = openMatches.length;

  if (count === 0) {
    return { visibleResponse: raw, persisted: null };
  }

  if (count > 1) {
    const stripped = raw
      .replace(new RegExp(`${OPEN_TAG}[\\s\\S]*?${CLOSE_TAG}`, "g"), "")
      .replace(new RegExp(OPEN_TAG, "g"), "")
      .trim();
    return {
      visibleResponse: stripped,
      persisted: { validationStatus: "multiple_blocks", raw: extractAllBlocks(raw) },
    };
  }

  const openIdx = raw.indexOf(OPEN_TAG);
  const closeIdx = raw.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);

  const visibleResponse = raw.slice(0, openIdx).trim();

  if (closeIdx === -1) {
    const inner = raw.slice(openIdx + OPEN_TAG.length).trim();
    return {
      visibleResponse,
      persisted: { validationStatus: "malformed_json", raw: inner },
    };
  }

  const inner = raw.slice(openIdx + OPEN_TAG.length, closeIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return {
      visibleResponse,
      persisted: { validationStatus: "malformed_json", raw: inner },
    };
  }

  const result = QualificationSignalsSchema.safeParse(parsed);
  if (!result.success) {
    return {
      visibleResponse,
      persisted: { validationStatus: "schema_mismatch", raw: inner, zodError: result.error },
    };
  }

  return {
    visibleResponse,
    persisted: { validationStatus: "ok", payload: result.data },
  };
}

function extractAllBlocks(raw: string): string {
  const blocks: string[] = [];
  const re = new RegExp(`${OPEN_TAG}[\\s\\S]*?(${CLOSE_TAG}|$)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push(m[0]);
  }
  return blocks.join("\n---\n");
}
