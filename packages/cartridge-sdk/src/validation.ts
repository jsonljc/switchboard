import type { CartridgeManifest } from "@switchboard/schemas";
import { GuardrailConfigSchema } from "@switchboard/schemas";
import type { Cartridge } from "./cartridge.js";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const MANIFEST_ID_RE = /^[a-z][a-z0-9-]*$/;
const ACTION_TYPE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){1,4}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const VALID_RISK_CATEGORIES = new Set(["none", "low", "medium", "high", "critical"]);

const REQUIRED_METHODS: Array<keyof Cartridge> = [
  "initialize",
  "enrichContext",
  "execute",
  "getRiskInput",
  "getGuardrails",
  "healthCheck",
];

export function validateManifest(manifest: CartridgeManifest): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // --- id ---
  if (!manifest.id || !MANIFEST_ID_RE.test(manifest.id)) {
    errors.push({
      code: "INVALID_MANIFEST_ID",
      message: `Manifest id must match ${MANIFEST_ID_RE} (kebab-case, starts with lowercase letter)`,
      path: "id",
    });
  }

  // --- name ---
  if (!manifest.name || manifest.name.trim().length === 0) {
    errors.push({
      code: "MISSING_MANIFEST_NAME",
      message: "Manifest name must be non-empty",
      path: "name",
    });
  }

  // --- version ---
  if (!manifest.version || !SEMVER_RE.test(manifest.version)) {
    errors.push({
      code: "INVALID_VERSION",
      message: "Manifest version must be valid semver (X.Y.Z)",
      path: "version",
    });
  }

  // --- description ---
  if (!manifest.description || manifest.description.trim().length === 0) {
    errors.push({
      code: "MISSING_DESCRIPTION",
      message: "Manifest description must be non-empty",
      path: "description",
    });
  }

  // --- actions ---
  if (!manifest.actions || manifest.actions.length === 0) {
    errors.push({
      code: "NO_ACTIONS",
      message: "Manifest must define at least one action",
      path: "actions",
    });
  } else {
    const seenTypes = new Set<string>();

    for (let i = 0; i < manifest.actions.length; i++) {
      const action = manifest.actions[i]!;
      const actionPath = `actions[${i}]`;

      // actionType format
      if (!action.actionType || !ACTION_TYPE_RE.test(action.actionType)) {
        errors.push({
          code: "INVALID_ACTION_TYPE",
          message: `Action type "${action.actionType}" must match dotted notation (2+ segments, e.g. "domain.resource.verb")`,
          path: `${actionPath}.actionType`,
        });
      }

      // duplicate actionType
      if (action.actionType && seenTypes.has(action.actionType)) {
        errors.push({
          code: "DUPLICATE_ACTION_TYPE",
          message: `Duplicate action type "${action.actionType}"`,
          path: `${actionPath}.actionType`,
        });
      }
      if (action.actionType) {
        seenTypes.add(action.actionType);
      }

      // name
      if (!action.name || action.name.trim().length === 0) {
        errors.push({
          code: "MISSING_ACTION_NAME",
          message: `Action at index ${i} must have a non-empty name`,
          path: `${actionPath}.name`,
        });
      }

      // description
      if (!action.description || action.description.trim().length === 0) {
        errors.push({
          code: "MISSING_ACTION_DESCRIPTION",
          message: `Action at index ${i} must have a non-empty description`,
          path: `${actionPath}.description`,
        });
      }

      // baseRiskCategory
      if (!VALID_RISK_CATEGORIES.has(action.baseRiskCategory)) {
        errors.push({
          code: "INVALID_RISK_CATEGORY",
          message: `Action "${action.actionType}" has invalid risk category "${action.baseRiskCategory}". Must be one of: none, low, medium, high, critical`,
          path: `${actionPath}.baseRiskCategory`,
        });
      }

      // reversible
      if (typeof action.reversible !== "boolean") {
        errors.push({
          code: "MISSING_REVERSIBLE",
          message: `Action "${action.actionType}" must have a boolean "reversible" field`,
          path: `${actionPath}.reversible`,
        });
      }

      // parametersSchema warning
      if (
        !action.parametersSchema ||
        Object.keys(action.parametersSchema).length === 0
      ) {
        warnings.push({
          code: "EMPTY_PARAMETERS_SCHEMA",
          message: `Action "${action.actionType}" has no parametersSchema defined`,
          path: `${actionPath}.parametersSchema`,
        });
      }
    }

    // Action type prefix mismatch warning
    if (manifest.actions.length > 0 && manifest.id && MANIFEST_ID_RE.test(manifest.id)) {
      const idPrefix = manifest.id.replace(/-/g, "");
      const allSharePrefix = manifest.actions.every((a) => {
        const firstSegment = a.actionType?.split(".")[0];
        return firstSegment !== undefined && idPrefix.includes(firstSegment);
      });
      if (!allSharePrefix) {
        warnings.push({
          code: "ACTION_TYPE_PREFIX_MISMATCH",
          message: `Action type prefixes don't appear related to manifest id "${manifest.id}"`,
        });
      }
    }
  }

  // --- requiredConnections warning ---
  if (!manifest.requiredConnections || manifest.requiredConnections.length === 0) {
    warnings.push({
      code: "NO_REQUIRED_CONNECTIONS",
      message: "No required connections defined; most cartridges need at least one",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function validateCartridge(cartridge: unknown): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!cartridge || typeof cartridge !== "object") {
    return {
      valid: false,
      errors: [{ code: "MISSING_MANIFEST", message: "Cartridge must be a non-null object" }],
      warnings: [],
    };
  }

  const cart = cartridge as Record<string, unknown>;

  // Check manifest exists
  if (!("manifest" in cart) || !cart["manifest"]) {
    errors.push({
      code: "MISSING_MANIFEST",
      message: "Cartridge is missing the 'manifest' property",
    });
    return { valid: false, errors, warnings };
  }

  // Validate manifest
  const manifestResult = validateManifest(cart["manifest"] as CartridgeManifest);
  errors.push(...manifestResult.errors);
  warnings.push(...manifestResult.warnings);

  // Check required methods
  for (const method of REQUIRED_METHODS) {
    if (typeof (cart as Record<string, unknown>)[method] !== "function") {
      errors.push({
        code: "MISSING_METHOD",
        message: `Cartridge is missing required method: ${method}`,
      });
    }
  }

  // Check optional captureSnapshot
  if (typeof cart["captureSnapshot"] !== "function") {
    warnings.push({
      code: "NO_CAPTURE_SNAPSHOT",
      message: "Cartridge does not implement optional captureSnapshot method",
    });
  }

  // Validate guardrails if getGuardrails is present
  if (typeof cart["getGuardrails"] === "function") {
    try {
      const guardrails = (cart as unknown as Cartridge).getGuardrails();
      const parseResult = GuardrailConfigSchema.safeParse(guardrails);
      if (!parseResult.success) {
        errors.push({
          code: "INVALID_GUARDRAILS",
          message: `getGuardrails() return value fails schema validation: ${parseResult.error.message}`,
        });
      } else {
        // Check for empty rateLimits
        if (parseResult.data.rateLimits.length === 0) {
          warnings.push({
            code: "NO_RATE_LIMITS",
            message: "Guardrails have no rate limits defined",
          });
        }
      }
    } catch (e) {
      errors.push({
        code: "INVALID_GUARDRAILS",
        message: `getGuardrails() threw an error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
