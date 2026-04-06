import type { StateStore } from "@switchboard/sdk";

export interface AgentStateStoreInterface {
  get(deploymentId: string, key: string): Promise<unknown | null>;
  set(deploymentId: string, key: string, value: unknown): Promise<void>;
  list(deploymentId: string, prefix: string): Promise<Array<{ key: string; value: unknown }>>;
  delete(deploymentId: string, key: string): Promise<void>;
}

export class StateProvider implements StateStore {
  constructor(
    private deploymentId: string,
    private store: AgentStateStoreInterface,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    return (await this.store.get(this.deploymentId, key)) as T | null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.store.set(this.deploymentId, key, value);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: unknown }>> {
    return this.store.list(this.deploymentId, prefix);
  }

  async delete(key: string): Promise<void> {
    await this.store.delete(this.deploymentId, key);
  }
}
