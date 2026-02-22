import type {
  ActionEnvelope,
  Policy,
  IdentitySpec,
  RoleOverlay,
  ApprovalRequest,
  Principal,
  DelegationRule,
} from "@switchboard/schemas";
import type { ApprovalState } from "../approval/state-machine.js";
import type { Cartridge } from "@switchboard/cartridge-sdk";
import type {
  EnvelopeStore,
  PolicyStore,
  IdentityStore,
  ApprovalStore,
  CartridgeRegistry,
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
    status?: string;
    limit?: number;
  }): Promise<ActionEnvelope[]> {
    let results = [...this.store.values()];

    if (filter?.principalId) {
      results = results.filter((e) =>
        e.proposals.some((p) => p.parameters["principalId"] === filter.principalId),
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

  async listActive(filter?: { cartridgeId?: string }): Promise<Policy[]> {
    let results = [...this.store.values()].filter((p) => p.active);

    if (filter?.cartridgeId) {
      results = results.filter(
        (p) => p.cartridgeId === null || p.cartridgeId === filter.cartridgeId,
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

  async listDelegationRules(): Promise<DelegationRule[]> {
    return [...this.delegationRules.values()];
  }

  async saveDelegationRule(rule: DelegationRule): Promise<void> {
    this.delegationRules.set(rule.id, { ...rule });
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private store = new Map<
    string,
    { request: ApprovalRequest; state: ApprovalState; envelopeId: string }
  >();

  async save(approval: {
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  }): Promise<void> {
    this.store.set(approval.request.id, { ...approval });
  }

  async getById(id: string): Promise<{
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  } | null> {
    const entry = this.store.get(id);
    return entry ? { ...entry } : null;
  }

  async updateState(id: string, state: ApprovalState): Promise<void> {
    const entry = this.store.get(id);
    if (!entry) throw new Error(`Approval not found: ${id}`);
    this.store.set(id, { ...entry, state });
  }

  async listPending(): Promise<
    Array<{
      request: ApprovalRequest;
      state: ApprovalState;
      envelopeId: string;
    }>
  > {
    return [...this.store.values()].filter((e) => e.state.status === "pending");
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
