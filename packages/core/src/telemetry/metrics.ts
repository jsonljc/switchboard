/**
 * Lightweight metrics abstraction compatible with Prometheus/prom-client.
 * When prom-client is installed, use createPromMetrics() to wire real counters.
 * Otherwise falls back to in-memory counters for testing/inspection.
 */

export interface SwitchboardMetrics {
  proposalsTotal: Counter;
  proposalsDenied: Counter;
  approvalsCreated: Counter;
  approvalsExpired: Counter;
  executionsTotal: Counter;
  executionsSuccess: Counter;
  executionsFailed: Counter;
  proposalLatencyMs: Histogram;
  approvalLatencyMs: Histogram;
  executionLatencyMs: Histogram;
  policyEngineLatencyMs: Histogram;
}

export interface Counter {
  inc(labels?: Record<string, string>, value?: number): void;
}

export interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
}

class InMemoryCounter implements Counter {
  private value = 0;
  inc(_labels?: Record<string, string>, amount = 1): void {
    this.value += amount;
  }
  get(): number {
    return this.value;
  }
}

class InMemoryHistogram implements Histogram {
  private values: number[] = [];
  observe(_labels: Record<string, string>, value: number): void {
    this.values.push(value);
  }
  getValues(): number[] {
    return [...this.values];
  }
}

let activeMetrics: SwitchboardMetrics | null = null;

export function setMetrics(metrics: SwitchboardMetrics): void {
  activeMetrics = metrics;
}

export function getMetrics(): SwitchboardMetrics {
  if (!activeMetrics) {
    activeMetrics = createInMemoryMetrics();
  }
  return activeMetrics;
}

export function createInMemoryMetrics(): SwitchboardMetrics {
  return {
    proposalsTotal: new InMemoryCounter(),
    proposalsDenied: new InMemoryCounter(),
    approvalsCreated: new InMemoryCounter(),
    approvalsExpired: new InMemoryCounter(),
    executionsTotal: new InMemoryCounter(),
    executionsSuccess: new InMemoryCounter(),
    executionsFailed: new InMemoryCounter(),
    proposalLatencyMs: new InMemoryHistogram(),
    approvalLatencyMs: new InMemoryHistogram(),
    executionLatencyMs: new InMemoryHistogram(),
    policyEngineLatencyMs: new InMemoryHistogram(),
  };
}
