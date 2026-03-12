// ---------------------------------------------------------------------------
// In-Memory Store Implementations — Map-based, for testing
// ---------------------------------------------------------------------------

import type {
  Intervention,
  GovernanceStatus,
  OutcomeStatus,
  AccountLearningProfile,
  MonitorCheckpoint,
  TestCampaign,
  TestCampaignStatus,
} from "@switchboard/schemas";
import type {
  InterventionStore,
  DiagnosticCycleStore,
  DiagnosticCycleRecord,
  RevenueAccountStore,
  RevenueAccountRecord,
  WeeklyDigestStore,
  WeeklyDigestRecord,
  AccountProfileStore,
  MonitorCheckpointStore,
  TestCampaignStore,
} from "./interfaces.js";

// ---------------------------------------------------------------------------
// InMemoryInterventionStore
// ---------------------------------------------------------------------------

export class InMemoryInterventionStore implements InterventionStore {
  private readonly data = new Map<string, Intervention>();

  async save(intervention: Intervention): Promise<void> {
    this.data.set(intervention.id, { ...intervention });
  }

  async getById(id: string): Promise<Intervention | null> {
    return this.data.get(id) ?? null;
  }

  async listByCycle(cycleId: string): Promise<Intervention[]> {
    return [...this.data.values()].filter((i) => i.cycleId === cycleId);
  }

  async listByAccount(
    _accountId: string,
    opts?: { status?: GovernanceStatus; limit?: number },
  ): Promise<Intervention[]> {
    let results = [...this.data.values()];
    if (opts?.status) {
      results = results.filter((i) => i.status === opts.status);
    }
    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }
    return results;
  }

  async listPendingOutcomes(): Promise<Intervention[]> {
    return [...this.data.values()].filter(
      (i) => i.outcomeStatus === "PENDING" && i.measurementStartedAt,
    );
  }

  async updateStatus(id: string, status: GovernanceStatus): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, status, updatedAt: new Date().toISOString() });
    }
  }

  async updateOutcome(id: string, outcomeStatus: OutcomeStatus): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, outcomeStatus, updatedAt: new Date().toISOString() });
    }
  }
}

// ---------------------------------------------------------------------------
// InMemoryDiagnosticCycleStore
// ---------------------------------------------------------------------------

export class InMemoryDiagnosticCycleStore implements DiagnosticCycleStore {
  private readonly data = new Map<string, DiagnosticCycleRecord>();

  async save(cycle: DiagnosticCycleRecord): Promise<void> {
    this.data.set(cycle.id, { ...cycle });
  }

  async getLatest(accountId: string): Promise<DiagnosticCycleRecord | null> {
    const cycles = [...this.data.values()]
      .filter((c) => c.accountId === accountId)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return cycles[0] ?? null;
  }

  async listByAccount(accountId: string, limit?: number): Promise<DiagnosticCycleRecord[]> {
    const cycles = [...this.data.values()]
      .filter((c) => c.accountId === accountId)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return limit ? cycles.slice(0, limit) : cycles;
  }
}

// ---------------------------------------------------------------------------
// InMemoryRevenueAccountStore
// ---------------------------------------------------------------------------

export class InMemoryRevenueAccountStore implements RevenueAccountStore {
  private readonly data = new Map<string, RevenueAccountRecord>();

  private key(orgId: string, accountId: string): string {
    return `${orgId}:${accountId}`;
  }

  async upsert(account: RevenueAccountRecord): Promise<void> {
    this.data.set(this.key(account.organizationId, account.accountId), { ...account });
  }

  async getByAccountId(orgId: string, accountId: string): Promise<RevenueAccountRecord | null> {
    return this.data.get(this.key(orgId, accountId)) ?? null;
  }

  async listDue(): Promise<RevenueAccountRecord[]> {
    const now = new Date().toISOString();
    return [...this.data.values()].filter((a) => a.active && a.nextCycleAt <= now);
  }
}

// ---------------------------------------------------------------------------
// InMemoryWeeklyDigestStore
// ---------------------------------------------------------------------------

export class InMemoryWeeklyDigestStore implements WeeklyDigestStore {
  private readonly data = new Map<string, WeeklyDigestRecord>();

  async save(digest: WeeklyDigestRecord): Promise<void> {
    this.data.set(digest.id, { ...digest });
  }

  async getLatest(accountId: string): Promise<WeeklyDigestRecord | null> {
    const digests = [...this.data.values()]
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return digests[0] ?? null;
  }

  async listByAccount(accountId: string, limit?: number): Promise<WeeklyDigestRecord[]> {
    const digests = [...this.data.values()]
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return limit ? digests.slice(0, limit) : digests;
  }
}

// ---------------------------------------------------------------------------
// InMemoryAccountProfileStore
// ---------------------------------------------------------------------------

export class InMemoryAccountProfileStore implements AccountProfileStore {
  private readonly data = new Map<string, AccountLearningProfile>();

  async save(profile: AccountLearningProfile): Promise<void> {
    this.data.set(profile.accountId, { ...profile });
  }

  async getByAccountId(accountId: string): Promise<AccountLearningProfile | null> {
    return this.data.get(accountId) ?? null;
  }
}

// ---------------------------------------------------------------------------
// InMemoryMonitorCheckpointStore
// ---------------------------------------------------------------------------

export class InMemoryMonitorCheckpointStore implements MonitorCheckpointStore {
  private readonly data = new Map<string, MonitorCheckpoint>();

  async save(checkpoint: MonitorCheckpoint): Promise<void> {
    this.data.set(checkpoint.id, { ...checkpoint });
  }

  async listByIntervention(interventionId: string): Promise<MonitorCheckpoint[]> {
    return [...this.data.values()]
      .filter((c) => c.interventionId === interventionId)
      .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  }

  async getLatest(interventionId: string): Promise<MonitorCheckpoint | null> {
    const checkpoints = [...this.data.values()]
      .filter((c) => c.interventionId === interventionId)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    return checkpoints[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// InMemoryTestCampaignStore
// ---------------------------------------------------------------------------

export class InMemoryTestCampaignStore implements TestCampaignStore {
  private readonly data = new Map<string, TestCampaign>();

  async save(campaign: TestCampaign): Promise<void> {
    this.data.set(campaign.id, { ...campaign });
  }

  async getById(id: string): Promise<TestCampaign | null> {
    return this.data.get(id) ?? null;
  }

  async listByAccount(
    accountId: string,
    opts?: { status?: TestCampaignStatus; limit?: number },
  ): Promise<TestCampaign[]> {
    let results = [...this.data.values()].filter((c) => c.accountId === accountId);
    if (opts?.status) {
      results = results.filter((c) => c.status === opts.status);
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }
    return results;
  }

  async updateStatus(id: string, status: TestCampaignStatus): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, status, updatedAt: new Date().toISOString() });
    }
  }
}
