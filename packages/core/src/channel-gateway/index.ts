export { ChannelGateway } from "./channel-gateway.js";
export type {
  ChannelGatewayConfig,
  GatewayConversationStore,
  IncomingChannelMessage,
  ReplySink,
} from "./types.js";
export { UnknownChannelError, InactiveDeploymentError } from "./types.js";
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
