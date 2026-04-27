/**
 * Pure status resolver for channel provisioning (Task 6).
 *
 * Caller side-effects (env reads, fetches, DB writes) collapse each provision
 * step into a `StepResult`. This function maps the matrix of step results to a
 * single terminal `ProvisionStatus` using the precedence defined in spec
 * Decision 7:
 *
 *   config_error > pending_chat_register > health_check_failed >
 *   pending_meta_register > active
 *
 * The first failed step (top-down) wins; `statusDetail` is that step's reason.
 * Both meta-config and chat-config failures collapse to `config_error`; if both
 * are missing, the detail names both gaps.
 */

export type StepResult = { kind: "ok"; reason: null } | { kind: "fail"; reason: string };

export interface ResolveInput {
  /** WHATSAPP_GRAPH_TOKEN + WHATSAPP_APP_SECRET present + decryption ok. */
  metaConfig: StepResult;
  /** CHAT_PUBLIC_URL (or SWITCHBOARD_CHAT_URL) + INTERNAL_API_SECRET present. */
  chatConfig: StepResult;
  /** Result of /subscribed_apps. ok-by-default for non-whatsapp channels. */
  metaRegister: StepResult;
  /** Synchronous health probe. ok-by-default for non-whatsapp channels. */
  healthProbe: StepResult;
  /** Provision-notify call after the one-shot retry. */
  chatNotify: StepResult;
  channel: "whatsapp" | "telegram" | "slack";
}

export type ProvisionStatus =
  | "active"
  | "config_error"
  | "pending_chat_register"
  | "health_check_failed"
  | "pending_meta_register"
  | "error";

export interface ResolvedStatus {
  status: ProvisionStatus;
  statusDetail: string | null;
}

export function resolveProvisionStatus(input: ResolveInput): ResolvedStatus {
  // 1. Config errors (highest precedence). If both meta and chat configs are
  //    missing, name both in the detail so the operator sees the full picture.
  if (input.metaConfig.kind === "fail" && input.chatConfig.kind === "fail") {
    return {
      status: "config_error",
      statusDetail: `${input.metaConfig.reason}; ${input.chatConfig.reason}`,
    };
  }
  if (input.metaConfig.kind === "fail") {
    return { status: "config_error", statusDetail: input.metaConfig.reason };
  }
  if (input.chatConfig.kind === "fail") {
    return { status: "config_error", statusDetail: input.chatConfig.reason };
  }
  // 2. Notify failure — chat server unreachable, inbound channel can't deliver.
  if (input.chatNotify.kind === "fail") {
    return { status: "pending_chat_register", statusDetail: input.chatNotify.reason };
  }
  // 3. Health probe failure — credentials don't authenticate against Graph API.
  if (input.healthProbe.kind === "fail") {
    return { status: "health_check_failed", statusDetail: input.healthProbe.reason };
  }
  // 4. Meta /subscribed_apps registration failure.
  if (input.metaRegister.kind === "fail") {
    return { status: "pending_meta_register", statusDetail: input.metaRegister.reason };
  }
  // 5. All steps green.
  return { status: "active", statusDetail: null };
}
