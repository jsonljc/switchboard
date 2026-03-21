// ---------------------------------------------------------------------------
// Store Interfaces — Read/write contracts for revenue growth persistence
// ---------------------------------------------------------------------------
// These interfaces live in the cartridge. The db package matches the shape
// via structural typing (cartridges can't import db, db can't import cartridges).
// ---------------------------------------------------------------------------

import type {
  Intervention,
  GovernanceStatus,
  OutcomeStatus,
  ConstraintType,
  DiagnosticCycle,
  WeeklyDigest,
  AccountLearningProfile,
  MonitorCheckpoint,
  TestCampaign,
  TestCampaignStatus,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// DiagnosticCycleRecord — Persistent representation of a diagnostic cycle
// ---------------------------------------------------------------------------

export type DiagnosticCycleRecord = DiagnosticCycle;

// ---------------------------------------------------------------------------
// RevenueAccountRecord — Tracks accounts enrolled in revenue growth
// ---------------------------------------------------------------------------

export interface RevenueAccountRecord {
  organizationId: string;
  accountId: string;
  active: boolean;
  cadenceMinutes: number;
  nextCycleAt: string; // ISO datetime
  lastCycleId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// WeeklyDigestRecord — Persistent representation of a weekly digest
// ---------------------------------------------------------------------------

export type WeeklyDigestRecord = WeeklyDigest;

// ---------------------------------------------------------------------------
// InterventionStore — CRUD for intervention records
// ---------------------------------------------------------------------------

export interface InterventionStore {
  save(intervention: Intervention): Promise<void>;
  getById(id: string): Promise<Intervention | null>;
  listByCycle(cycleId: string): Promise<Intervention[]>;
  listByAccount(
    accountId: string,
    opts?: { status?: GovernanceStatus; limit?: number },
  ): Promise<Intervention[]>;
  /** Interventions with outcomeStatus=PENDING and measurementStartedAt set */
  listPendingOutcomes(): Promise<Intervention[]>;
  updateStatus(id: string, status: GovernanceStatus): Promise<void>;
  updateOutcome(id: string, outcomeStatus: OutcomeStatus): Promise<void>;
}

// ---------------------------------------------------------------------------
// DiagnosticCycleStore — CRUD for diagnostic cycle records
// ---------------------------------------------------------------------------

export interface DiagnosticCycleStore {
  save(cycle: DiagnosticCycleRecord): Promise<void>;
  getLatest(accountId: string): Promise<DiagnosticCycleRecord | null>;
  listByAccount(accountId: string, limit?: number): Promise<DiagnosticCycleRecord[]>;
}

// ---------------------------------------------------------------------------
// RevenueAccountStore — CRUD for enrolled revenue accounts
// ---------------------------------------------------------------------------

export interface RevenueAccountStore {
  upsert(account: RevenueAccountRecord): Promise<void>;
  getByAccountId(orgId: string, accountId: string): Promise<RevenueAccountRecord | null>;
  /** Returns accounts where active=true and nextCycleAt <= now */
  listDue(): Promise<RevenueAccountRecord[]>;
}

// ---------------------------------------------------------------------------
// WeeklyDigestStore — CRUD for weekly digest records
// ---------------------------------------------------------------------------

export interface WeeklyDigestStore {
  save(digest: WeeklyDigestRecord): Promise<void>;
  getLatest(accountId: string): Promise<WeeklyDigestRecord | null>;
  listByAccount(accountId: string, limit?: number): Promise<WeeklyDigestRecord[]>;
}

// ---------------------------------------------------------------------------
// AccountProfileStore — CRUD for account learning profiles
// ---------------------------------------------------------------------------

export interface AccountProfileStore {
  save(profile: AccountLearningProfile): Promise<void>;
  getByAccountId(accountId: string): Promise<AccountLearningProfile | null>;
}

// ---------------------------------------------------------------------------
// MonitorCheckpointStore — CRUD for post-change monitoring checkpoints
// ---------------------------------------------------------------------------

export interface MonitorCheckpointStore {
  save(checkpoint: MonitorCheckpoint): Promise<void>;
  listByIntervention(interventionId: string): Promise<MonitorCheckpoint[]>;
  getLatest(interventionId: string): Promise<MonitorCheckpoint | null>;
}

// ---------------------------------------------------------------------------
// TestCampaignStore — CRUD for creative testing campaigns
// ---------------------------------------------------------------------------

export interface TestCampaignStore {
  save(campaign: TestCampaign): Promise<void>;
  getById(id: string): Promise<TestCampaign | null>;
  listByAccount(
    accountId: string,
    opts?: { status?: TestCampaignStatus; limit?: number },
  ): Promise<TestCampaign[]>;
  updateStatus(id: string, status: TestCampaignStatus): Promise<void>;
}

// ---------------------------------------------------------------------------
// Convenience re-export of constraint type for calibration
// ---------------------------------------------------------------------------

export type { ConstraintType };
