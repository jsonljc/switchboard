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

export interface EnvelopeStore {
  save(envelope: ActionEnvelope): Promise<void>;
  getById(id: string): Promise<ActionEnvelope | null>;
  update(id: string, updates: Partial<ActionEnvelope>): Promise<void>;
  list(filter?: {
    principalId?: string;
    organizationId?: string;
    status?: string;
    limit?: number;
  }): Promise<ActionEnvelope[]>;
}

export interface PolicyStore {
  save(policy: Policy): Promise<void>;
  getById(id: string): Promise<Policy | null>;
  update(id: string, data: Partial<Policy>): Promise<void>;
  delete(id: string): Promise<boolean>;
  listActive(filter?: { cartridgeId?: string; organizationId?: string | null }): Promise<Policy[]>;
}

export interface IdentityStore {
  saveSpec(spec: IdentitySpec): Promise<void>;
  getSpecByPrincipalId(principalId: string): Promise<IdentitySpec | null>;
  getSpecById(id: string): Promise<IdentitySpec | null>;
  listOverlaysBySpecId(specId: string): Promise<RoleOverlay[]>;
  getOverlayById(id: string): Promise<RoleOverlay | null>;
  saveOverlay(overlay: RoleOverlay): Promise<void>;
  getPrincipal(id: string): Promise<Principal | null>;
  savePrincipal(principal: Principal): Promise<void>;
  listDelegationRules(organizationId?: string): Promise<DelegationRule[]>;
  saveDelegationRule(rule: DelegationRule): Promise<void>;
}

export interface ApprovalStore {
  save(approval: {
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  }): Promise<void>;
  getById(id: string): Promise<{
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
  } | null>;
  updateState(id: string, state: ApprovalState): Promise<void>;
  listPending(organizationId?: string): Promise<
    Array<{
      request: ApprovalRequest;
      state: ApprovalState;
      envelopeId: string;
    }>
  >;
}

export interface CartridgeRegistry {
  register(cartridgeId: string, cartridge: Cartridge): void;
  get(cartridgeId: string): Cartridge | null;
  list(): string[];
}

export interface CompetenceStore {
  getRecord(principalId: string, actionType: string): Promise<CompetenceRecord | null>;
  saveRecord(record: CompetenceRecord): Promise<void>;
  listRecords(principalId: string): Promise<CompetenceRecord[]>;
  getPolicy(actionType: string): Promise<CompetencePolicy | null>;
  getDefaultPolicy(): Promise<CompetencePolicy | null>;
  savePolicy(policy: CompetencePolicy): Promise<void>;
  listPolicies(): Promise<CompetencePolicy[]>;
}

export interface StorageContext {
  envelopes: EnvelopeStore;
  policies: PolicyStore;
  identity: IdentityStore;
  approvals: ApprovalStore;
  cartridges: CartridgeRegistry;
  competence: CompetenceStore;
}
