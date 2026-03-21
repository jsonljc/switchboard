export interface LlmUsageEntry {
  orgId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  taskType: string;
  durationMs?: number;
  error?: string;
}

export interface LlmUsageLoggerConfig {
  sink: (entry: LlmUsageEntry) => Promise<void>;
}

export class LlmUsageLogger {
  private sink: (entry: LlmUsageEntry) => Promise<void>;

  constructor(config: LlmUsageLoggerConfig) {
    this.sink = config.sink;
  }

  async log(entry: LlmUsageEntry): Promise<void> {
    try {
      await this.sink(entry);
    } catch (err) {
      console.warn("[LlmUsageLogger] sink error:", err);
    }
  }
}
