import type { CrmProvider } from "./crm-provider.js";
import { InMemoryCrmProvider } from "./mock.js";

export function createCrmProvider(): CrmProvider {
  // Built-in CRM: always use the in-memory provider.
  // When DATABASE_URL is available, the bootstrap layer can swap in
  // a PrismaCrmProvider at a later stage.
  return new InMemoryCrmProvider();
}
