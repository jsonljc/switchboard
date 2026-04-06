export interface ActionRequestStore {
  create(input: {
    deploymentId: string;
    type: string;
    surface: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string; status: string }>;
  updateStatus(id: string, status: string, review?: { reviewedBy: string }): Promise<unknown>;
}

export interface ActionRequestPipelineConfig {
  trustScore: number;
  trustLevel: "supervised" | "guided" | "autonomous";
  actionRequestStore: ActionRequestStore;
}

export interface EvaluationInput {
  deploymentId: string;
  type: string;
  surface: string;
  payload: Record<string, unknown>;
}

export interface EvaluationResult {
  decision: "execute" | "queue" | "block";
  actionRequestId?: string;
  reason: string;
}

const SANDBOX_SURFACES = new Set(["test_chat"]);
const READ_ONLY_TYPES = new Set(["read_file"]);

export class ActionRequestPipeline {
  constructor(private config: ActionRequestPipelineConfig) {}

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    // Sandbox surfaces always execute
    if (SANDBOX_SURFACES.has(input.surface)) {
      return { decision: "execute", reason: "sandbox_surface" };
    }

    // Read-only actions always execute
    if (READ_ONLY_TYPES.has(input.type)) {
      return { decision: "execute", reason: "read_only_action" };
    }

    // Supervised: queue for approval
    if (this.config.trustLevel === "supervised") {
      const actionRequest = await this.config.actionRequestStore.create(input);
      return {
        decision: "queue",
        actionRequestId: actionRequest.id,
        reason: "supervised_requires_approval",
      };
    }

    // Guided and Autonomous: execute immediately
    return { decision: "execute", reason: `trust_level_${this.config.trustLevel}` };
  }
}
