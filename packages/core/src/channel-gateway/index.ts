export { ChannelGateway } from "./channel-gateway.js";
export type {
  ChannelGatewayConfig,
  GatewayConversationStore,
  GatewayContactStore,
  GatewayConversationStatusSetter,
  ConversationStatusUpsertContext,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
// Re-exported from ../storage/interfaces.js (not types.js) because ApprovalStore
// is the canonical storage interface, and ChannelGatewayConfig depends on it.
export type { ApprovalStore } from "../storage/interfaces.js";
export { UnknownChannelError, InactiveDeploymentError } from "./types.js";
export { resolveContactIdentity } from "./resolve-contact-identity.js";
export type { ResolvedContactIdentity } from "./resolve-contact-identity.js";
export type {
  OperatorChannelBindingStore,
  OperatorChannelBindingRecord,
} from "./operator-channel-binding-store.js";
export type { HandleApprovalResponseConfig } from "./types.js";
export {
  APPROVER_ROLES,
  handleApprovalResponse,
  NOT_FOUND_MSG,
  STALE_MSG,
  NOT_AUTHORIZED_MSG,
  APPROVAL_LOOKUP_ERROR_MSG,
  ALREADY_RESPONDED_MSG,
  REJECT_SUCCESS_MSG,
  APPROVAL_EXECUTION_ERROR_MSG,
  APPROVE_EXECUTED_MSG,
  APPROVE_DISPATCH_FAILED_MSG,
  PARTIAL_APPROVAL_MSG,
  SELF_APPROVAL_MSG,
} from "./handle-approval-response.js";
export { ConversationLifecycleTracker } from "./conversation-lifecycle.js";
export type {
  ConversationEndEvent,
  ConversationEndHandler,
  ConversationEndReason,
  ConversationLifecycleConfig,
  RecordMessageInput,
} from "./conversation-lifecycle.js";
export {
  ContactMutex,
  LoopDetector,
  type ContactMutexConfig,
  type LoopDetectorConfig,
} from "./concurrency.js";
