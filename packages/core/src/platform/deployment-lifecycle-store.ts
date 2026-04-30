import type { Actor } from "./types.js";

export type DeploymentLifecycleActionKind =
  | "agent_deployment.halt"
  | "agent_deployment.resume"
  | "agent_deployment.suspend";

export interface HaltAllInput {
  organizationId: string;
  operator: Actor;
  reason: string | null;
}

export interface HaltAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface ResumeInput {
  organizationId: string;
  skillSlug: string;
  operator: Actor;
}

export interface ResumeResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface SuspendAllInput {
  organizationId: string;
  operator: Actor;
  reason: string;
}

export interface SuspendAllResult {
  workTraceId: string;
  affectedDeploymentIds: string[];
  count: number;
}

export interface DeploymentLifecycleStore {
  haltAll(input: HaltAllInput): Promise<HaltAllResult>;
  resume(input: ResumeInput): Promise<ResumeResult>;
  suspendAll(input: SuspendAllInput): Promise<SuspendAllResult>;
}
