import type { Playbook } from "@switchboard/schemas";

export interface PlaybookReader {
  readForOrganization(organizationId: string): Promise<Playbook | null>;
}
