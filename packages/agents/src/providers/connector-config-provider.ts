// ---------------------------------------------------------------------------
// Connector Config Provider — bridges connection store to agent router/handler
// ---------------------------------------------------------------------------

import type { ConnectorDestinationConfig } from "../route-plan.js";

export class InMemoryConnectorConfigProvider {
  private store = new Map<string, Map<string, ConnectorDestinationConfig>>();

  register(organizationId: string, entry: ConnectorDestinationConfig): void {
    let orgMap = this.store.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.store.set(organizationId, orgMap);
    }
    orgMap.set(entry.id, entry);
  }

  remove(organizationId: string, connectorId: string): boolean {
    return this.store.get(organizationId)?.delete(connectorId) ?? false;
  }

  listForOrg(organizationId: string): ConnectorDestinationConfig[] {
    const orgMap = this.store.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  toRouterConfigs(organizationId: string): ConnectorDestinationConfig[] {
    return this.listForOrg(organizationId);
  }

  toLookup(organizationId: string): (id: string) => ConnectorDestinationConfig | undefined {
    const orgMap = this.store.get(organizationId);
    return (id: string) => orgMap?.get(id);
  }
}
