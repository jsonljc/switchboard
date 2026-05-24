// Contacts read-side projection (powers the Mercury /contacts list surface)
export { listContactsForBrowse, InvalidCursorError } from "./list.js";
export type { ListContactsDeps } from "./list.js";

// Contact detail composite projection (powers /contacts/[id])
export {
  getContactDetail,
  ContactNotFoundError,
  buildContactDetailProfile,
  buildContactDetailOpportunities,
  buildContactDetailThreads,
  buildContactDetailOpenDecisions,
  buildContactDetailRevenueEvents,
} from "./detail.js";
export type { ContactDetailDeps } from "./detail.js";
export type { RouteTemplates } from "../lib/route-templates.js";
