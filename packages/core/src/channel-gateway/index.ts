export { ChannelGateway } from "./channel-gateway.js";
export type {
  ChannelGatewayConfig,
  GatewayConversationStore,
  GatewayContactStore,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
export type { ApprovalStore } from "../storage/interfaces.js";
export { UnknownChannelError, InactiveDeploymentError } from "./types.js";
export { resolveContactIdentity } from "./resolve-contact-identity.js";
export type { ResolvedContactIdentity } from "./resolve-contact-identity.js";
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
