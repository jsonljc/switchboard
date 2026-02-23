import { describe, it, expect } from "vitest";
import {
  PrincipalSchema,
  RiskInputSchema,
  IdentitySpecSchema,
  RoleOverlaySchema,
  PolicySchema,
  ActionEnvelopeSchema,
  ActionPlanSchema,
  DecisionTraceSchema,
  ResolvedEntitySchema,
  UndoRecipeSchema,
  AuditEntrySchema,
  IncomingMessageSchema,
  ConversationStateSchema,
  ApprovalRequestSchema,
  DelegationRuleSchema,
  CompositeRiskContextSchema,
  CheckCodeSchema,
  AuditEventTypeSchema,
  GovernanceProfileSchema,
} from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = (d = new Date()) => d.toISOString();

// ---------------------------------------------------------------------------
// 1. PrincipalSchema
// ---------------------------------------------------------------------------
describe("PrincipalSchema", () => {
  it("accepts a valid principal", () => {
    const result = PrincipalSchema.safeParse({
      id: "usr_001",
      type: "user",
      name: "Alice",
      organizationId: "org_001",
      roles: ["requester", "approver"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid type", () => {
    const result = PrincipalSchema.safeParse({
      id: "usr_002",
      type: "bot", // invalid
      name: "Bob",
      organizationId: null,
      roles: ["requester"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = PrincipalSchema.safeParse({
      id: "usr_003",
      // missing type, name, organizationId, roles
    });
    expect(result.success).toBe(false);
  });

  it("allows null organizationId", () => {
    const result = PrincipalSchema.safeParse({
      id: "usr_004",
      type: "agent",
      name: "Agent Smith",
      organizationId: null,
      roles: [],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. RiskInputSchema
// ---------------------------------------------------------------------------
describe("RiskInputSchema", () => {
  const validRiskInput = {
    baseRisk: "medium",
    exposure: { dollarsAtRisk: 500, blastRadius: 3 },
    reversibility: "full",
    sensitivity: {
      entityVolatile: false,
      learningPhase: true,
      recentlyModified: false,
    },
  };

  it("accepts a valid risk input", () => {
    const result = RiskInputSchema.safeParse(validRiskInput);
    expect(result.success).toBe(true);
  });

  it("rejects negative dollarsAtRisk", () => {
    const result = RiskInputSchema.safeParse({
      ...validRiskInput,
      exposure: { dollarsAtRisk: -100, blastRadius: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative blastRadius", () => {
    const result = RiskInputSchema.safeParse({
      ...validRiskInput,
      exposure: { dollarsAtRisk: 0, blastRadius: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts boundary value of zero for exposure fields", () => {
    const result = RiskInputSchema.safeParse({
      ...validRiskInput,
      exposure: { dollarsAtRisk: 0, blastRadius: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid reversibility value", () => {
    const result = RiskInputSchema.safeParse({
      ...validRiskInput,
      reversibility: "maybe",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. IdentitySpecSchema
// ---------------------------------------------------------------------------
describe("IdentitySpecSchema", () => {
  const validSpec = {
    id: "is_001",
    principalId: "usr_001",
    organizationId: "org_001",
    name: "Default Identity",
    description: "Standard identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: {
      daily: 1000,
      weekly: 5000,
      monthly: 20000,
      perAction: 500,
    },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: ["delete_production_db"],
    trustBehaviors: ["read_only_queries"],
    createdAt: iso(),
    updatedAt: iso(),
  };

  it("accepts a valid identity spec", () => {
    const result = IdentitySpecSchema.safeParse(validSpec);
    expect(result.success).toBe(true);
  });

  it("accepts null spend limits", () => {
    const result = IdentitySpecSchema.safeParse({
      ...validSpec,
      globalSpendLimits: {
        daily: null,
        weekly: null,
        monthly: null,
        perAction: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative spend limits", () => {
    const result = IdentitySpecSchema.safeParse({
      ...validSpec,
      globalSpendLimits: {
        daily: -1,
        weekly: 5000,
        monthly: 20000,
        perAction: 500,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. RoleOverlaySchema
// ---------------------------------------------------------------------------
describe("RoleOverlaySchema", () => {
  const validOverlay = {
    id: "ro_001",
    identitySpecId: "is_001",
    name: "Weekend Restriction",
    description: "Restrict actions during weekends",
    mode: "restrict",
    priority: 10,
    active: true,
    conditions: {
      timeWindows: [
        {
          dayOfWeek: [0, 6],
          startHour: 0,
          endHour: 23,
          timezone: "America/New_York",
        },
      ],
      cartridgeIds: ["cart_001"],
    },
    overrides: {
      additionalForbiddenBehaviors: ["deploy"],
    },
    createdAt: iso(),
    updatedAt: iso(),
  };

  it("accepts a valid role overlay", () => {
    const result = RoleOverlaySchema.safeParse(validOverlay);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid mode", () => {
    const result = RoleOverlaySchema.safeParse({
      ...validOverlay,
      mode: "merge", // invalid — must be "restrict" | "extend"
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative priority", () => {
    const result = RoleOverlaySchema.safeParse({
      ...validOverlay,
      priority: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. PolicySchema
// ---------------------------------------------------------------------------
describe("PolicySchema", () => {
  const validPolicy = {
    id: "pol_001",
    name: "Block High-Risk Deploys",
    description: "Deny deployments when risk is high",
    organizationId: "org_001",
    cartridgeId: null,
    priority: 100,
    active: true,
    rule: {
      composition: "AND",
      conditions: [
        { field: "action.type", operator: "eq", value: "deploy" },
        { field: "risk.category", operator: "in", value: ["high", "critical"] },
      ],
    },
    effect: "deny",
    createdAt: iso(),
    updatedAt: iso(),
  };

  it("accepts a valid policy with a rule tree", () => {
    const result = PolicySchema.safeParse(validPolicy);
    expect(result.success).toBe(true);
  });

  it("accepts nested conditions via children", () => {
    const result = PolicySchema.safeParse({
      ...validPolicy,
      rule: {
        composition: "OR",
        children: [
          {
            composition: "AND",
            conditions: [
              { field: "risk.score", operator: "gte", value: 80 },
              { field: "action.type", operator: "eq", value: "deploy" },
            ],
          },
          {
            conditions: [
              { field: "principal.type", operator: "eq", value: "agent" },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid effect", () => {
    const result = PolicySchema.safeParse({
      ...validPolicy,
      effect: "escalate", // invalid
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. ActionEnvelopeSchema
// ---------------------------------------------------------------------------
describe("ActionEnvelopeSchema", () => {
  const validEnvelope = {
    id: "env_001",
    version: 1,
    incomingMessage: null,
    conversationId: "conv_001",
    proposals: [],
    resolvedEntities: [],
    plan: null,
    decisions: [],
    approvalRequests: [],
    executionResults: [],
    auditEntryIds: ["aud_001"],
    status: "proposed",
    createdAt: iso(),
    updatedAt: iso(),
    parentEnvelopeId: null,
  };

  it("accepts a valid envelope", () => {
    const result = ActionEnvelopeSchema.safeParse(validEnvelope);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const result = ActionEnvelopeSchema.safeParse({
      ...validEnvelope,
      status: "unknown_status",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative version", () => {
    const result = ActionEnvelopeSchema.safeParse({
      ...validEnvelope,
      version: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. ActionPlanSchema
// ---------------------------------------------------------------------------
describe("ActionPlanSchema", () => {
  const validPlan = {
    id: "plan_001",
    envelopeId: "env_001",
    strategy: "sequential",
    approvalMode: "single_approval",
    summary: "Deploy then notify",
    proposalOrder: ["prop_001", "prop_002"],
  };

  it("accepts a valid plan", () => {
    const result = ActionPlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid strategy", () => {
    const result = ActionPlanSchema.safeParse({
      ...validPlan,
      strategy: "parallel", // invalid — must be atomic | best_effort | sequential
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid approval mode", () => {
    const result = ActionPlanSchema.safeParse({
      ...validPlan,
      approvalMode: "batch",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. DecisionTraceSchema
// ---------------------------------------------------------------------------
describe("DecisionTraceSchema", () => {
  const validTrace = {
    actionId: "act_001",
    envelopeId: "env_001",
    checks: [
      {
        checkCode: "RISK_SCORING",
        checkData: { rawScore: 42 },
        humanDetail: "Risk score is moderate",
        matched: true,
        effect: "allow",
      },
    ],
    computedRiskScore: {
      rawScore: 42,
      category: "medium",
      factors: [
        {
          factor: "exposure",
          weight: 0.5,
          contribution: 21,
          detail: "Moderate exposure",
        },
      ],
    },
    finalDecision: "allow",
    approvalRequired: "none",
    explanation: "Action permitted under current policy.",
    evaluatedAt: iso(),
  };

  it("accepts a valid decision trace", () => {
    const result = DecisionTraceSchema.safeParse(validTrace);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid checkCode enum value", () => {
    const result = DecisionTraceSchema.safeParse({
      ...validTrace,
      checks: [
        {
          ...validTrace.checks[0],
          checkCode: "INVALID_CHECK",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a rawScore above 100", () => {
    const result = DecisionTraceSchema.safeParse({
      ...validTrace,
      computedRiskScore: {
        ...validTrace.computedRiskScore,
        rawScore: 101,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. ResolvedEntitySchema
// ---------------------------------------------------------------------------
describe("ResolvedEntitySchema", () => {
  const validEntity = {
    id: "re_001",
    inputRef: "customer:Acme",
    resolvedType: "organization",
    resolvedId: "org_acme",
    resolvedName: "Acme Corp",
    confidence: 0.95,
    alternatives: [
      { id: "org_acme2", name: "Acme LLC", score: 0.6 },
    ],
    status: "resolved",
  };

  it("accepts a valid resolved entity", () => {
    const result = ResolvedEntitySchema.safeParse(validEntity);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const result = ResolvedEntitySchema.safeParse({
      ...validEntity,
      status: "pending",
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    const result = ResolvedEntitySchema.safeParse({
      ...validEntity,
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence below 0", () => {
    const result = ResolvedEntitySchema.safeParse({
      ...validEntity,
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. UndoRecipeSchema
// ---------------------------------------------------------------------------
describe("UndoRecipeSchema", () => {
  const validRecipe = {
    originalActionId: "act_001",
    originalEnvelopeId: "env_001",
    reverseActionType: "restore_backup",
    reverseParameters: { backupId: "bak_123" },
    undoExpiresAt: iso(new Date(Date.now() + 86_400_000)),
    undoRiskCategory: "low",
    undoApprovalRequired: "standard",
  };

  it("accepts a valid undo recipe", () => {
    const result = UndoRecipeSchema.safeParse(validRecipe);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid risk category", () => {
    const result = UndoRecipeSchema.safeParse({
      ...validRecipe,
      undoRiskCategory: "extreme",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. AuditEntrySchema
// ---------------------------------------------------------------------------
describe("AuditEntrySchema", () => {
  const validAuditEntry = {
    id: "aud_001",
    eventType: "action.executed",
    timestamp: iso(),
    actorType: "agent",
    actorId: "agent_001",
    entityType: "action",
    entityId: "act_001",
    riskCategory: "low",
    visibilityLevel: "org",
    summary: "Action executed successfully",
    snapshot: { before: {}, after: {} },
    evidencePointers: [
      { type: "inline", hash: "sha256:abc123", storageRef: null },
    ],
    redactionApplied: false,
    redactedFields: [],
    chainHashVersion: 1,
    schemaVersion: 1,
    entryHash: "sha256:deadbeef",
    previousEntryHash: null,
    envelopeId: "env_001",
    organizationId: "org_001",
  };

  it("accepts a valid audit entry", () => {
    const result = AuditEntrySchema.safeParse(validAuditEntry);
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive chainHashVersion", () => {
    const result = AuditEntrySchema.safeParse({
      ...validAuditEntry,
      chainHashVersion: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid evidence pointer type", () => {
    const result = AuditEntrySchema.safeParse({
      ...validAuditEntry,
      evidencePointers: [
        { type: "external", hash: "sha256:abc", storageRef: null },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts previousEntryHash as non-null for chained entries", () => {
    const result = AuditEntrySchema.safeParse({
      ...validAuditEntry,
      previousEntryHash: "sha256:cafebabe",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. IncomingMessageSchema
// ---------------------------------------------------------------------------
describe("IncomingMessageSchema", () => {
  const validMessage = {
    id: "msg_001",
    channel: "telegram",
    channelMessageId: "tg_12345",
    threadId: null,
    principalId: "usr_001",
    organizationId: null,
    text: "Transfer 500 USD to Acme Corp",
    attachments: [],
    timestamp: iso(),
  };

  it("accepts a valid incoming message", () => {
    const result = IncomingMessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid channel", () => {
    const result = IncomingMessageSchema.safeParse({
      ...validMessage,
      channel: "discord", // not in enum
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid channel values", () => {
    for (const ch of ["telegram", "slack", "whatsapp", "email", "api"] as const) {
      const result = IncomingMessageSchema.safeParse({
        ...validMessage,
        channel: ch,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 13. ConversationStateSchema
// ---------------------------------------------------------------------------
describe("ConversationStateSchema", () => {
  const validConversation = {
    id: "conv_001",
    threadId: "thread_001",
    channel: "slack",
    principalId: "usr_001",
    status: "active",
    currentIntent: "transfer_funds",
    pendingProposalIds: ["prop_001"],
    pendingApprovalIds: [],
    clarificationQuestion: null,
    lastActivityAt: iso(),
    expiresAt: iso(new Date(Date.now() + 3_600_000)),
  };

  it("accepts a valid conversation state", () => {
    const result = ConversationStateSchema.safeParse(validConversation);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const result = ConversationStateSchema.safeParse({
      ...validConversation,
      status: "paused",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid status values", () => {
    const statuses = [
      "active",
      "awaiting_clarification",
      "awaiting_approval",
      "completed",
      "expired",
    ] as const;
    for (const status of statuses) {
      const result = ConversationStateSchema.safeParse({
        ...validConversation,
        status,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. ApprovalRequestSchema
// ---------------------------------------------------------------------------
describe("ApprovalRequestSchema", () => {
  const validApproval = {
    id: "apr_001",
    actionId: "act_001",
    envelopeId: "env_001",
    conversationId: null,
    summary: "Transfer $500 to Acme Corp",
    riskCategory: "medium",
    bindingHash: "sha256:binding123",
    evidenceBundle: {
      decisionTrace: {},
      contextSnapshot: { key: "value" },
      identitySnapshot: { name: "Alice" },
    },
    suggestedButtons: [
      { label: "Approve", action: "approve" },
      { label: "Reject", action: "reject" },
    ],
    approvers: ["usr_002"],
    fallbackApprover: null,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    patchValue: null,
    expiresAt: iso(new Date(Date.now() + 3_600_000)),
    expiredBehavior: "deny",
    createdAt: iso(),
  };

  it("accepts a valid approval request", () => {
    const result = ApprovalRequestSchema.safeParse(validApproval);
    expect(result.success).toBe(true);
  });

  it("rejects when bindingHash is missing", () => {
    const { bindingHash: _, ...withoutHash } = validApproval;
    const result = ApprovalRequestSchema.safeParse(withoutHash);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = ApprovalRequestSchema.safeParse({
      ...validApproval,
      status: "cancelled",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid expiredBehavior", () => {
    const result = ApprovalRequestSchema.safeParse({
      ...validApproval,
      expiredBehavior: "escalate",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15. DelegationRuleSchema — maxChainDepth
// ---------------------------------------------------------------------------
describe("DelegationRuleSchema", () => {
  const validRule = {
    id: "del_001",
    grantor: "admin_1",
    grantee: "user_1",
    scope: "*",
    expiresAt: null,
  };

  it("accepts a valid delegation rule without maxChainDepth", () => {
    const result = DelegationRuleSchema.safeParse(validRule);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxChainDepth).toBeUndefined();
    }
  });

  it("accepts a valid delegation rule with maxChainDepth", () => {
    const result = DelegationRuleSchema.safeParse({
      ...validRule,
      maxChainDepth: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxChainDepth).toBe(3);
    }
  });

  it("rejects maxChainDepth of 0", () => {
    const result = DelegationRuleSchema.safeParse({
      ...validRule,
      maxChainDepth: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxChainDepth", () => {
    const result = DelegationRuleSchema.safeParse({
      ...validRule,
      maxChainDepth: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer maxChainDepth", () => {
    const result = DelegationRuleSchema.safeParse({
      ...validRule,
      maxChainDepth: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16. CompositeRiskContextSchema
// ---------------------------------------------------------------------------
describe("CompositeRiskContextSchema", () => {
  const validContext = {
    recentActionCount: 10,
    windowMs: 3600000,
    cumulativeExposure: 5000,
    distinctTargetEntities: 3,
    distinctCartridges: 2,
  };

  it("accepts a valid composite risk context", () => {
    const result = CompositeRiskContextSchema.safeParse(validContext);
    expect(result.success).toBe(true);
  });

  it("rejects negative recentActionCount", () => {
    const result = CompositeRiskContextSchema.safeParse({
      ...validContext,
      recentActionCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative cumulativeExposure", () => {
    const result = CompositeRiskContextSchema.safeParse({
      ...validContext,
      cumulativeExposure: -100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero values", () => {
    const result = CompositeRiskContextSchema.safeParse({
      recentActionCount: 0,
      windowMs: 0,
      cumulativeExposure: 0,
      distinctTargetEntities: 0,
      distinctCartridges: 0,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. New CheckCode and AuditEventType enums
// ---------------------------------------------------------------------------
describe("New enum values", () => {
  it("CheckCodeSchema accepts COMPOSITE_RISK", () => {
    const result = CheckCodeSchema.safeParse("COMPOSITE_RISK");
    expect(result.success).toBe(true);
  });

  it("CheckCodeSchema accepts DELEGATION_CHAIN", () => {
    const result = CheckCodeSchema.safeParse("DELEGATION_CHAIN");
    expect(result.success).toBe(true);
  });

  it("AuditEventTypeSchema accepts delegation.chain_resolved", () => {
    const result = AuditEventTypeSchema.safeParse("delegation.chain_resolved");
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. GovernanceProfileSchema
// ---------------------------------------------------------------------------
describe("GovernanceProfileSchema", () => {
  it("accepts all valid profile values", () => {
    for (const profile of ["observe", "guarded", "strict", "locked"] as const) {
      const result = GovernanceProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid profile value", () => {
    const result = GovernanceProfileSchema.safeParse("permissive");
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 19. IdentitySpecSchema with governanceProfile
// ---------------------------------------------------------------------------
describe("IdentitySpecSchema — governanceProfile", () => {
  const baseSpec = {
    id: "is_001",
    principalId: "usr_001",
    organizationId: "org_001",
    name: "Default Identity",
    description: "Standard identity spec",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: {
      daily: 1000,
      weekly: 5000,
      monthly: 20000,
      perAction: 500,
    },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    createdAt: iso(),
    updatedAt: iso(),
  };

  it("accepts IdentitySpec without governanceProfile", () => {
    const result = IdentitySpecSchema.safeParse(baseSpec);
    expect(result.success).toBe(true);
  });

  it("accepts IdentitySpec with valid governanceProfile", () => {
    const result = IdentitySpecSchema.safeParse({
      ...baseSpec,
      governanceProfile: "strict",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governanceProfile).toBe("strict");
    }
  });

  it("rejects IdentitySpec with invalid governanceProfile", () => {
    const result = IdentitySpecSchema.safeParse({
      ...baseSpec,
      governanceProfile: "yolo",
    });
    expect(result.success).toBe(false);
  });
});
