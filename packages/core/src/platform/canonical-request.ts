import type { Actor, ExecutionModeName, Trigger } from "./types.js";
import type { DeploymentContext } from "./deployment-context.js";

export type SurfaceName = "api" | "mcp" | "chat" | "dashboard";

export interface SurfaceMetadata {
  surface: SurfaceName;
  requestId?: string;
  sessionId?: string;
  correlationId?: string;
}

export interface TargetHint {
  skillSlug?: string;
  deploymentId?: string;
  channel?: string;
  token?: string;
}

export interface CanonicalSubmitRequest {
  organizationId: string;
  actor: Actor;
  intent: string;
  parameters: Record<string, unknown>;
  trigger: Trigger;
  surface: SurfaceMetadata;
  idempotencyKey?: string;
  parentWorkUnitId?: string;
  traceId?: string;
  priority?: "low" | "normal" | "high";
  targetHint?: TargetHint;
  suggestedMode?: ExecutionModeName;
}

export interface AuthoritativeDeploymentResolver {
  resolve(request: CanonicalSubmitRequest): Promise<DeploymentContext>;
}
