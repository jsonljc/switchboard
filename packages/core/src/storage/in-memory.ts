import type {
  ActionEnvelope,
  Policy,
  IdentitySpec,
  RoleOverlay,
  ApprovalRequest,
  Principal,
  DelegationRule,
  CompetenceRecord,
  CompetencePolicy,
} from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";
import type {
  EnvelopeStore,
  PolicyStore,
  IdentityStore,
  ApprovalStore,
  CartridgeRegistry,
  CompetenceStore,
} from "./interfaces.js";

export class InMemoryEnvelopeStore implements EnvelopeStore {
  private store = new Map<string, ActionEnvelope>();

  async save(envelope: ActionEnvelope): Promise<void> {
    this.store.set(envelope.id, { ...envelope });
  }

  async getById(id: string): Promise<ActionEnvelope | null> {
    const envelope = this.store.get(id);
    return envelope ? { ...envelope } : null;
  }

  async update(id: string, updates: Partial<ActionEnvelope>): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Envelope not found: ${id}`);
    this.store.set(id, { ...existing, ...updates, updatedAt: new Date() });
  }

  async list(filter?: {
    principalId?: string;
    organizationId?: string;
    status?: string;
    limit?: number;
  }): Promise<ActionEnvelope[]> {
    let results = [...this.store.values()];

    if (filter?.principalId) {
      results = results.filter((e) =>
        e.proposals.some((p) => p.parameters["_principalId"] === filter.principalId),
      );
    }
    if (filter?.organizationId) {
      results = results.filter((e) =>
        e.proposals.some((p) => p.parameters["_organizationId"] === filter.organizationId),
      );
    }
    if (filter?.status) {
      results = results.filter((e) => e.status === filter.status);
    }
    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }
}

export class InMemoryPolicyStore implements PolicyStore {
  private store = new Map<string, Policy>();

  async save(policy: Policy): Promise<void> {
    this.store.set(policy.id, { ...policy });
  }

  async getById(id: string): Promise<Policy | null> {
    const policy = this.store.get(id);
    return policy ? { ...policy } : null;
  }

  async update(id: string, data: Partial<Policy>): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Policy not found: ${id}`);
    this.store.set(id, { ...existing, ...data, updatedAt: new Date() });
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async listActive(filter?: { cartridgeId?: string; organizationId?: string | null }): Promise<Policy[]> {
    let results = [...this.store.values()].filter((p) => p.active);

    if (filter?.cartridgeId) {
      results = results.filter(
        (p) => p.cartridgeId === null || p.cartridgeId === filter.cartridgeId,
      );
    }

    // When organizationId is provided, return policies that are global (null org)
    // OR belong to the specified organization.
    if (filter?.organizationId !== undefined) {
      const orgId = filter.organizationId;
      results = results.filter(
        (p) => p.organizationId === null || p.organizationId === orgId,
      );
    }

    return results.sort((a, b) => a.priority - b.priority);
  }
}

export class InMemoryIdentityStore implements IdentityStore {
  private specs = new Map<string, IdentitySpec>();
  private overlays = new Map<string, RoleOverlay[]>();
  private principals = new Map<string, Principal>();
  private delegationRules = new Map<string, DelegationRule>();

  async saveSpec(spec: IdentitySpec): Promise<void> {
    this.specs.set(spec.id, { ...spec });
  }

  async getSpecByPrincipalId(principalId: string): Promise<IdentitySpec | null> {
    for (const spec of this.specs.values()) {
      if (spec.principalId === principalId) return { ...spec };
    }
    return null;
  }

  async getSpecById(id: string): Promise<IdentitySpec | null> {
    const spec = this.specs.get(id);
    return spec ? { ...spec } : null;
  }

  async listOverlaysBySpecId(specId: string): Promise<RoleOverlay[]> {
    return [...(this.overlays.get(specId) ?? [])];
  }

  async getOverlayById(id: string): Promise<RoleOverlay | null> {
    for (const list of this.overlays.values()) {
      const found = list.find((o) => o.id === id);
      if (found) return { ...found };
    }
    return null;
  }

  async saveOverlay(overlay: RoleOverlay): Promise<void> {
    const list = this.overlays.get(overlay.identitySpecId) ?? [];
    const idx = list.findIndex((o) => o.id === overlay.id);
    if (idx >= 0) {
      list[idx] = { ...overlay };
    } else {
      list.push({ ...overlay });
    }
    this.overlays.set(overlay.identitySpecId, list);
  }

  async getPrincipal(id: string): Promise<Principal | null> {
    const principal = this.principals.get(id);
    return principal ? { ...principal } : null;
  }

  async savePrincipal(principal: Principal): Promise<void> {
    this.principals.set(principal.id, { ...principal });
  }

  async listDelegationRules(organizationId?: string): Promise<DelegationRule[]> {
    const rules = [...this.delegationRules.values()];
    if (!organizationId) return rules;
    // Filter to rules where the grantor belongs to the specified org
    return rules.filter((rule) => {
      const grantor = this.principals.get(rule.grantor);
      return grantor && grantor.organizationId === organizationId;
    });
  }

  async saveDelegationRule(rule: DelegationRule): Promise<void> {
    this.delegationRules.set(rule.id, { ...rule });
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private store = new Map<
    string,
    { request: ApprovalRequest; state: ApprovalState; envelopeId: string; organizationId?: string | null }
  >();

  async save(approval: {
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
    organizationId?: string | null;
  }): Promise<void> {
    this.store.set(approval.request.id, { ...approval });
  }

  async getById(id: string): Promise<{
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
    organizationId?: string | null;
  } | null> {
    const entry = this.store.get(id);
    return entry ? { ...entry } : null;
  }

  async updateState(id: string, state: ApprovalState): Promise<void> {
    const entry = this.store.get(id);
    if (!entry) throw new Error(`Approval not found: ${id}`);
    this.store.set(id, { ...entry, state });
  }

  async listPending(organizationId?: string): Promise<
    Array<{
      request: ApprovalRequest;
      state: ApprovalState;
      envelopeId: string;
      organizationId?: string | null;
    }>
  > {
    let results = [...this.store.values()].filter((e) => e.state.status === "pending");
    if (organizationId) {
      results = results.filter((e) => e.organizationId === organizationId);
    }
    return results;
  }
}

export class InMemoryCartridgeRegistry implements CartridgeRegistry {
  private store = new Map<string, Cartridge>();

  register(cartridgeId: string, cartridge: Cartridge): void {
    this.store.set(cartridgeId, cartridge);
  }

  get(cartridgeId: string): Cartridge | null {
    return this.store.get(cartridgeId) ?? null;
  }

  list(): string[] {
    return [...this.store.keys()];
  }
}

export function matchActionTypePattern(pattern: string, actionType: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
  );
  return regex.test(actionType);
}

export class InMemoryCompetenceStore implements CompetenceStore {
  private records = new Map<string, CompetenceRecord>();
  private policies = new Map<string, CompetencePolicy>();

  private recordKey(principalId: string, actionType: string): string {
    return `${principalId}:${actionType}`;
  }

  async getRecord(principalId: string, actionType: string): Promise<CompetenceRecord | null> {
    const record = this.records.get(this.recordKey(principalId, actionType));
    return record ? { ...record, history: [...record.history] } : null;
  }

  async saveRecord(record: CompetenceRecord): Promise<void> {
    this.records.set(this.recordKey(record.principalId, record.actionType), {
      ...record,
      history: [...record.history],
    });
  }

  async listRecords(principalId: string): Promise<CompetenceRecord[]> {
    return [...this.records.values()].filter((r) => r.principalId === principalId);
  }

  async getPolicy(actionType: string): Promise<CompetencePolicy | null> {
    // First try exact match
    for (const policy of this.policies.values()) {
      if (policy.enabled && policy.actionTypePattern === actionType) {
        return { ...policy };
      }
    }
    // Then try glob match
    for (const policy of this.policies.values()) {
      if (
        policy.enabled &&
        policy.actionTypePattern !== null &&
        matchActionTypePattern(policy.actionTypePattern, actionType)
      ) {
        return { ...policy };
      }
    }
    return null;
  }

  async getDefaultPolicy(): Promise<CompetencePolicy | null> {
    for (const policy of this.policies.values()) {
      if (policy.enabled && policy.actionTypePattern === null) {
        return { ...policy };
      }
    }
    return null;
  }

  async savePolicy(policy: CompetencePolicy): Promise<void> {
    this.policies.set(policy.id, { ...policy });
  }

  async listPolicies(): Promise<CompetencePolicy[]> {
    return [...this.policies.values()];
  }
}
