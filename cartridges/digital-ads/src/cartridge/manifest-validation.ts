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

  errors.push(...validateMetadata(manifest));
  errors.push(...validateArrayFields(manifest));
  errors.push(...validateActions(manifest));

  return errors;
}

function validateMetadata(
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

  return errors;
}

function validateArrayFields(
  manifest: import("@switchboard/schemas").CartridgeManifest,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

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

  return errors;
}

function validateActions(
  manifest: import("@switchboard/schemas").CartridgeManifest,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    errors.push({ field: "actions", message: "actions must be a non-empty array" });
    return errors;
  }

  const actionTypes = new Set<string>();
  for (const action of manifest.actions) {
    errors.push(...validateAction(action, manifest.id, actionTypes));
  }

  return errors;
}

function validateAction(
  action: {
    actionType?: string;
    name?: string;
    description?: string;
    baseRiskCategory: string;
    reversible?: boolean;
    parametersSchema?: Record<string, unknown>;
  },
  manifestId: string,
  actionTypes: Set<string>,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!action.actionType) {
    errors.push({ field: "actions", message: "each action must have an actionType" });
    return errors;
  }

  errors.push(...validateActionType(action.actionType, manifestId, actionTypes));
  errors.push(...validateActionFields(action));

  return errors;
}

function validateActionType(
  actionType: string,
  manifestId: string,
  actionTypes: Set<string>,
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (actionTypes.has(actionType)) {
    errors.push({ field: "actions", message: `duplicate action type: ${actionType}` });
  } else {
    actionTypes.add(actionType);
  }

  if (!ACTION_TYPE_REGEX.test(actionType)) {
    errors.push({
      field: `actions[${actionType}].actionType`,
      message: `actionType must match pattern ${ACTION_TYPE_REGEX} (got "${actionType}")`,
      severity: "warning",
    });
  }

  const prefix = actionType.split(".")[0];
  if (prefix !== manifestId) {
    errors.push({
      field: `actions[${actionType}].actionType`,
      message: `action type prefix "${prefix}" does not match manifest id "${manifestId}"`,
      severity: "warning",
    });
  }

  return errors;
}

function validateActionFields(action: {
  actionType?: string;
  name?: string;
  description?: string;
  baseRiskCategory: string;
  reversible?: boolean;
  parametersSchema?: Record<string, unknown>;
}): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  const actionType = action.actionType ?? "?";

  if (!action.name || typeof action.name !== "string") {
    errors.push({ field: `actions[${actionType}].name`, message: "action must have a name" });
  }

  if (!action.description) {
    errors.push({ field: `actions[${actionType}]`, message: "action must have a description" });
  }

  const validRisks = ["none", "low", "medium", "high", "critical"];
  if (!validRisks.includes(action.baseRiskCategory)) {
    errors.push({
      field: `actions[${actionType}].baseRiskCategory`,
      message: `invalid baseRiskCategory: ${action.baseRiskCategory}`,
    });
  }

  if (typeof action.reversible !== "boolean") {
    errors.push({
      field: `actions[${actionType}].reversible`,
      message: "reversible must be a boolean",
    });
  }

  if (
    action.parametersSchema &&
    typeof action.parametersSchema === "object" &&
    Object.keys(action.parametersSchema).length === 0
  ) {
    errors.push({
      field: `actions[${actionType}].parametersSchema`,
      message: "parametersSchema is empty",
      severity: "warning",
    });
  }

  return errors;
}
