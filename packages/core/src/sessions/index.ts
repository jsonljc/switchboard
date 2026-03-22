export { canTransition, validateTransition, SessionTransitionError } from "./state-machine.js";
export type {
  SessionStore,
  RunStore,
  PauseStore,
  ToolEventStore,
  RoleOverrideStore,
} from "./store-interfaces.js";
export { mergeRoleConfig } from "./role-config-merger.js";
export type { ManifestDefaults } from "./role-config-merger.js";
export { validateCheckpoint } from "./checkpoint-validator.js";
export type {
  CheckpointValidationResult,
  RoleCheckpointValidator,
} from "./checkpoint-validator.js";
export { buildResumePayload } from "./resume-payload-builder.js";
export {
  SessionManager,
  SafetyEnvelopeExceededError,
  ConcurrentResumeError,
} from "./session-manager.js";
export type {
  SessionManagerDeps,
  CreateSessionInput,
  RecordToolCallInput,
  PauseSessionInput,
  ResumeResult,
} from "./session-manager.js";
