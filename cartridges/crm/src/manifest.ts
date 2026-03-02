import type { CartridgeManifest } from "@switchboard/schemas";

export const CRM_MANIFEST: CartridgeManifest = {
  id: "crm",
  name: "CRM Management",
  version: "1.0.0",
  description: "Built-in unified inbox — search contacts, manage deals, and log activities",
  actions: [
    // Read actions
    {
      actionType: "crm.contact.search",
      name: "Search Contacts",
      description: "Search for contacts by name, email, or company",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (name, email, or company)" },
          limit: { type: "number", description: "Maximum number of results" },
        },
        required: ["query"],
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "crm.deal.list",
      name: "List Deals",
      description: "List deals with optional filters by contact, pipeline, or stage",
      parametersSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "Filter by contact ID" },
          pipeline: { type: "string", description: "Filter by pipeline name" },
          stage: { type: "string", description: "Filter by deal stage" },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "crm.activity.list",
      name: "List Activities",
      description: "List recent activities (notes, calls, meetings, emails, tasks)",
      parametersSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "Filter by contact ID" },
          dealId: { type: "string", description: "Filter by deal ID" },
          type: { type: "string", description: "Filter by activity type (note, email, call, meeting, task)" },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "crm.pipeline.status",
      name: "Pipeline Status",
      description: "Get pipeline overview with deal counts and total values per stage",
      parametersSchema: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "Pipeline ID (defaults to main pipeline)" },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    // Write actions
    {
      actionType: "crm.contact.create",
      name: "Create Contact",
      description: "Create a new contact in the CRM",
      parametersSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Contact email address" },
          firstName: { type: "string", description: "First name" },
          lastName: { type: "string", description: "Last name" },
          company: { type: "string", description: "Company name" },
          phone: { type: "string", description: "Phone number" },
          channel: { type: "string", description: "Source channel (telegram, email, web)" },
          properties: { type: "object", description: "Additional properties" },
        },
        required: ["email"],
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "crm.contact.update",
      name: "Update Contact",
      description: "Update an existing contact's properties",
      parametersSchema: {
        type: "object",
        properties: {
          contactId: { type: "string", description: "Contact ID to update" },
          data: { type: "object", description: "Fields to update" },
        },
        required: ["contactId", "data"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "crm.deal.create",
      name: "Create Deal",
      description: "Create a new deal in the pipeline",
      parametersSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Deal name" },
          pipeline: { type: "string", description: "Pipeline name (defaults to 'default')" },
          stage: { type: "string", description: "Deal stage (defaults to 'lead')" },
          amount: { type: "number", description: "Deal value in dollars" },
          contactIds: {
            type: "array",
            items: { type: "string" },
            description: "Associated contact IDs",
          },
        },
        required: ["name"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "crm.activity.log",
      name: "Log Activity",
      description: "Log an activity (note, call, meeting, email, task) against contacts or deals",
      parametersSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Activity type: note, email, call, meeting, task" },
          subject: { type: "string", description: "Activity subject line" },
          body: { type: "string", description: "Activity body/details" },
          contactIds: {
            type: "array",
            items: { type: "string" },
            description: "Associated contact IDs",
          },
          dealIds: {
            type: "array",
            items: { type: "string" },
            description: "Associated deal IDs",
          },
        },
        required: ["type"],
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    // Advisor actions (read-only diagnostics)
    {
      actionType: "crm.pipeline.diagnose",
      name: "Diagnose Pipeline Health",
      description: "Analyze pipeline velocity, stage conversion rates, stalled deals, and concentration risk",
      parametersSchema: {
        type: "object",
        properties: {
          pipelineId: { type: "string", description: "Pipeline ID (defaults to main pipeline)" },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "crm.activity.analyze",
      name: "Analyze Activity Cadence",
      description: "Identify dormant contacts, overdue follow-ups, unengaged leads, and activity trends",
      parametersSchema: {
        type: "object",
        properties: {
          daysSinceDormant: { type: "number", description: "Days of inactivity before a contact is considered dormant (default: 30)" },
          daysSinceFollowup: { type: "number", description: "Days since last activity before a follow-up is overdue (default: 7)" },
        },
      },
      baseRiskCategory: "low",
      reversible: false,
    },
  ],
  requiredConnections: [],
  defaultPolicies: ["crm-default"],
};
