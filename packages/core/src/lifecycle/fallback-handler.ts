import type {
  Contact,
  Opportunity,
  OwnerTask,
  TaskPriority,
  OpportunityStage,
  FallbackReason,
} from "@switchboard/schemas";
import type { OwnerTaskStore, CreateOwnerTaskInput } from "./owner-task-store.js";
import type { Message } from "../conversation-store.js";
import type { StageHandlerMap } from "./stage-handler-map.js";

export interface FallbackContext {
  contact: Contact;
  opportunity: Opportunity | null;
  recentMessages: Message[];
  missingCapability: string;
  fallbackReason: FallbackReason;
}

export interface FallbackNotification {
  channel: "dashboard" | "whatsapp";
  recipientId: string;
  message: string;
}

export interface FallbackResult {
  task: OwnerTask | null;
  notifications: FallbackNotification[];
}

export interface FallbackSLAConfig {
  urgent?: number;
  high?: number;
  medium?: number;
  low?: number;
}

const DEFAULT_SLA: Required<FallbackSLAConfig> = {
  urgent: 4,
  high: 12,
  medium: 24,
  low: 72,
};

export interface FallbackHandlerConfig {
  ownerTaskStore: OwnerTaskStore;
  stageHandlerMap: StageHandlerMap;
  slaConfig?: FallbackSLAConfig;
  highValueThreshold?: number;
}

export class FallbackHandler {
  private ownerTaskStore: OwnerTaskStore;
  private stageHandlerMap: StageHandlerMap;
  private slaConfig: Required<FallbackSLAConfig>;
  private highValueThreshold: number;

  constructor(config: FallbackHandlerConfig) {
    this.ownerTaskStore = config.ownerTaskStore;
    this.stageHandlerMap = config.stageHandlerMap;
    this.slaConfig = { ...DEFAULT_SLA, ...config.slaConfig };
    this.highValueThreshold = config.highValueThreshold ?? 100_000; // $1000 in cents
  }

  async handleUnrouted(context: FallbackContext): Promise<FallbackResult> {
    const { contact, opportunity, missingCapability, fallbackReason } = context;

    // Check if this stage has fallback disabled (e.g., "booked" with fallbackType: "none")
    if (opportunity) {
      const stageConfig = this.stageHandlerMap[opportunity.stage as OpportunityStage];
      if (stageConfig?.fallbackType === "none") {
        return { task: null, notifications: [] };
      }
    }

    const priority = this.derivePriority(opportunity);
    const dueAt = this.computeDueAt(priority);
    const title = this.buildTitle(contact, opportunity, missingCapability);
    const description = this.buildDescription(context);

    const taskInput: CreateOwnerTaskInput = {
      organizationId: contact.organizationId,
      contactId: contact.id,
      opportunityId: opportunity?.id ?? null,
      type: "fallback_handoff",
      title,
      description,
      suggestedAction: this.buildSuggestedAction(opportunity),
      priority,
      triggerReason: `no_${missingCapability}_active`,
      sourceAgent: null,
      fallbackReason,
      dueAt,
    };

    const task = await this.ownerTaskStore.create(taskInput);

    const notifications: FallbackNotification[] = [
      {
        channel: "dashboard",
        recipientId: contact.organizationId,
        message: `${contact.name ?? "New lead"} needs attention: ${title}`,
      },
    ];

    return { task, notifications };
  }

  private derivePriority(opportunity: Opportunity | null): TaskPriority {
    if (!opportunity) return "low";

    const stage = opportunity.stage as OpportunityStage;
    if (stage === "booked" || stage === "showed") return "urgent";
    if (stage === "qualified") {
      return (opportunity.estimatedValue ?? 0) > this.highValueThreshold ? "high" : "medium";
    }
    return "low";
  }

  private computeDueAt(priority: TaskPriority): Date {
    const hours = this.slaConfig[priority];
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private buildTitle(
    contact: Contact,
    opportunity: Opportunity | null,
    missingCapability: string,
  ): string {
    const name = contact.name ?? "Unknown lead";
    const service = opportunity?.serviceName ?? "general inquiry";
    return `${name} — ${service} (no ${missingCapability})`;
  }

  private buildDescription(context: FallbackContext): string {
    const { contact, opportunity, recentMessages, fallbackReason } = context;
    const parts: string[] = [];

    parts.push(`Contact: ${contact.name ?? contact.phone ?? "Unknown"}`);
    if (opportunity) {
      parts.push(`Service: ${opportunity.serviceName}`);
      parts.push(`Stage: ${opportunity.stage}`);
      if (opportunity.estimatedValue) {
        parts.push(`Est. value: $${(opportunity.estimatedValue / 100).toFixed(2)}`);
      }
    }
    parts.push(`Reason: agent ${fallbackReason}`);

    if (recentMessages.length > 0) {
      parts.push("");
      parts.push("Recent messages:");
      for (const msg of recentMessages.slice(-3)) {
        const dir = msg.direction === "inbound" ? "Lead" : "Agent";
        parts.push(`  ${dir}: ${msg.content.slice(0, 200)}`);
      }
    }

    return parts.join("\n");
  }

  private buildSuggestedAction(opportunity: Opportunity | null): string | null {
    if (!opportunity) return "Review lead and respond";

    const stage = opportunity.stage as OpportunityStage;
    switch (stage) {
      case "interested":
        return `Respond to inquiry about ${opportunity.serviceName}`;
      case "qualified":
        return `Follow up — lead is qualified for ${opportunity.serviceName}, timeline: ${opportunity.timeline ?? "unknown"}`;
      case "quoted":
        return `Follow up on quote for ${opportunity.serviceName}`;
      case "showed":
        return `Record payment for ${opportunity.serviceName}`;
      default:
        return null;
    }
  }
}
