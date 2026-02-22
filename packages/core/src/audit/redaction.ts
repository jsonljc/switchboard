export interface RedactionConfig {
  patterns: RegExp[];
  fieldPaths: string[];
  replacement: string;
}

export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  patterns: [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // email
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, // phone
    /\b(?:sk|pk|api|key|token|secret)[-_][a-zA-Z0-9]{20,}\b/gi, // API tokens
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // credit card
  ],
  fieldPaths: ["credentials", "password", "secret", "apiKey", "accessToken", "refreshToken"],
  replacement: "[REDACTED]",
};

export interface RedactionResult {
  redacted: Record<string, unknown>;
  redactedFields: string[];
  redactionApplied: boolean;
}

export function redactSnapshot(
  snapshot: Record<string, unknown>,
  config: RedactionConfig = DEFAULT_REDACTION_CONFIG,
): RedactionResult {
  const redactedFields: string[] = [];
  const redacted = redactObject(snapshot, config, "", redactedFields);

  return {
    redacted: redacted as Record<string, unknown>,
    redactedFields,
    redactionApplied: redactedFields.length > 0,
  };
}

function redactObject(
  obj: unknown,
  config: RedactionConfig,
  path: string,
  redactedFields: string[],
): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return redactString(obj, config, path, redactedFields);
  }

  if (Array.isArray(obj)) {
    return obj.map((item, i) =>
      redactObject(item, config, `${path}[${i}]`, redactedFields),
    );
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fieldPath = path ? `${path}.${key}` : key;

      // Check if field path should be fully redacted
      if (config.fieldPaths.some((fp) => key === fp || fieldPath.endsWith(`.${fp}`))) {
        result[key] = config.replacement;
        redactedFields.push(fieldPath);
      } else {
        result[key] = redactObject(value, config, fieldPath, redactedFields);
      }
    }
    return result;
  }

  return obj;
}

function redactString(
  value: string,
  config: RedactionConfig,
  path: string,
  redactedFields: string[],
): string {
  let result = value;
  let wasRedacted = false;

  for (const pattern of config.patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const replaced = result.replace(regex, config.replacement);
    if (replaced !== result) {
      result = replaced;
      wasRedacted = true;
    }
  }

  if (wasRedacted) {
    redactedFields.push(path);
  }

  return result;
}
