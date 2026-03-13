// ---------------------------------------------------------------------------
// Manifest validation logic for the digital-ads cartridge.
// Extracted from types.ts to keep individual files under the 600-line limit.
// ---------------------------------------------------------------------------

export interface ManifestValidationError {
  field: string;
  message: string;
  severity?: "error" | "warning";
}

const MANIFEST_ID_REGEX = /^[a-z][a-z0-9-]*$/;
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
const ACTION_TYPE_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*){1,4}$/;

export function validateManifest(
  manifest: import("@switchboard/schemas").CartridgeManifest,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push({ field: "id", message: "id is required and must be a string" });
  } else if (!MANIFEST_ID_REGEX.test(manifest.id)) {
    errors.push({
      field: "id",
      message: `id must match pattern ${MANIFEST_ID_REGEX} (got "${manifest.id}")`,
    });
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push({ field: "name", message: "name is required and must be a non-empty string" });
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push({ field: "version", message: "version is required and must be a string" });
  } else if (!VERSION_REGEX.test(manifest.version)) {
    errors.push({
      field: "version",
      message: `version must be valid semver (got "${manifest.version}")`,
    });
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push({ field: "description", message: "description is required and must be a string" });
  }
  if (!Array.isArray(manifest.requiredConnections)) {
    errors.push({ field: "requiredConnections", message: "requiredConnections must be an array" });
  } else if (manifest.requiredConnections.length === 0) {
    errors.push({
      field: "requiredConnections",
      message: "requiredConnections is empty",
      severity: "warning",
    });
  }
  if (!Array.isArray(manifest.defaultPolicies)) {
    errors.push({ field: "defaultPolicies", message: "defaultPolicies must be an array" });
  }
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    errors.push({ field: "actions", message: "actions must be a non-empty array" });
  } else {
    const actionTypes = new Set<string>();
    for (const action of manifest.actions) {
      if (!action.actionType) {
        errors.push({ field: "actions", message: "each action must have an actionType" });
      } else {
        if (actionTypes.has(action.actionType)) {
          errors.push({ field: "actions", message: `duplicate action type: ${action.actionType}` });
        } else {
          actionTypes.add(action.actionType);
        }

        if (!ACTION_TYPE_REGEX.test(action.actionType)) {
          errors.push({
            field: `actions[${action.actionType}].actionType`,
            message: `actionType must match pattern ${ACTION_TYPE_REGEX} (got "${action.actionType}")`,
            severity: "warning",
          });
        }

        // Warn if action type prefix doesn't match manifest id
        const prefix = action.actionType.split(".")[0];
        if (prefix !== manifest.id) {
          errors.push({
            field: `actions[${action.actionType}].actionType`,
            message: `action type prefix "${prefix}" does not match manifest id "${manifest.id}"`,
            severity: "warning",
          });
        }
      }

      if (!action.name || typeof action.name !== "string") {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].name`,
          message: "action must have a name",
        });
      }

      if (!action.description) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}]`,
          message: "action must have a description",
        });
      }

      const validRisks = ["none", "low", "medium", "high", "critical"];
      if (!validRisks.includes(action.baseRiskCategory)) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].baseRiskCategory`,
          message: `invalid baseRiskCategory: ${action.baseRiskCategory}`,
        });
      }

      if (typeof action.reversible !== "boolean") {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].reversible`,
          message: "reversible must be a boolean",
        });
      }

      if (
        action.parametersSchema &&
        typeof action.parametersSchema === "object" &&
        Object.keys(action.parametersSchema).length === 0
      ) {
        errors.push({
          field: `actions[${action.actionType ?? "?"}].parametersSchema`,
          message: "parametersSchema is empty",
          severity: "warning",
        });
      }
    }
  }

  return errors;
}
