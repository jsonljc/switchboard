import type { CartridgeManifest } from "@switchboard/schemas";

export const PAYMENTS_MANIFEST: CartridgeManifest = {
  id: "payments",
  name: "Payments Management",
  version: "1.0.0",
  description: "Govern payment operations — charges, refunds, invoices, subscriptions — via Stripe",
  actions: [
    {
      actionType: "payments.invoice.create",
      name: "Create Invoice",
      description: "Create and send an invoice to a customer",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          amount: { type: "number", description: "Invoice amount in dollars" },
          description: { type: "string" },
          currency: { type: "string" },
        },
        required: ["entityId", "amount"],
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "payments.invoice.void",
      name: "Void Invoice",
      description: "Void an open invoice (undo of invoice creation)",
      parametersSchema: {
        type: "object",
        properties: {
          invoiceId: { type: "string", description: "Stripe invoice ID to void" },
        },
        required: ["invoiceId"],
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "payments.charge.create",
      name: "Create Charge",
      description: "Charge a customer's payment method",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          amount: { type: "number", description: "Charge amount in dollars" },
          currency: { type: "string" },
          description: { type: "string" },
        },
        required: ["entityId", "amount"],
      },
      baseRiskCategory: "high",
      reversible: true,
    },
    {
      actionType: "payments.refund.create",
      name: "Create Refund",
      description: "Refund a previous charge (irreversible)",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          chargeId: { type: "string", description: "Stripe charge ID to refund" },
          amount: { type: "number", description: "Refund amount in dollars" },
          reason: { type: "string" },
        },
        required: ["chargeId", "amount"],
      },
      baseRiskCategory: "critical",
      reversible: false,
    },
    {
      actionType: "payments.subscription.cancel",
      name: "Cancel Subscription",
      description: "Cancel a customer subscription (revenue loss)",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          subscriptionId: { type: "string" },
          cancelAtPeriodEnd: { type: "boolean" },
        },
        required: ["subscriptionId"],
      },
      baseRiskCategory: "high",
      reversible: false,
    },
    {
      actionType: "payments.subscription.modify",
      name: "Modify Subscription",
      description: "Modify an active subscription (quantity, price, etc.)",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          subscriptionId: { type: "string" },
          changes: { type: "object", description: "Fields to change on the subscription" },
        },
        required: ["subscriptionId", "changes"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "payments.link.create",
      name: "Create Payment Link",
      description: "Generate a shareable payment link",
      parametersSchema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Link amount in dollars" },
          currency: { type: "string" },
          description: { type: "string" },
        },
        required: ["amount"],
      },
      baseRiskCategory: "low",
      reversible: true,
    },
    {
      actionType: "payments.link.deactivate",
      name: "Deactivate Payment Link",
      description: "Deactivate an active payment link (undo of link creation)",
      parametersSchema: {
        type: "object",
        properties: {
          linkId: { type: "string", description: "Stripe payment link ID" },
        },
        required: ["linkId"],
      },
      baseRiskCategory: "low",
      reversible: false,
    },
    {
      actionType: "payments.credit.apply",
      name: "Apply Credit",
      description: "Apply a credit to a customer's balance",
      parametersSchema: {
        type: "object",
        properties: {
          entityId: { type: "string", description: "Stripe customer ID" },
          amount: { type: "number", description: "Credit amount in dollars" },
          description: { type: "string" },
        },
        required: ["entityId", "amount"],
      },
      baseRiskCategory: "medium",
      reversible: true,
    },
    {
      actionType: "payments.batch.invoice",
      name: "Batch Create Invoices",
      description: "Create and send invoices to multiple customers",
      parametersSchema: {
        type: "object",
        properties: {
          invoices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entityId: { type: "string" },
                amount: { type: "number" },
                description: { type: "string" },
              },
              required: ["entityId", "amount"],
            },
          },
          currency: { type: "string" },
        },
        required: ["invoices"],
      },
      baseRiskCategory: "high",
      reversible: true,
    },
  ],
  requiredConnections: ["stripe"],
  defaultPolicies: ["payments-default"],
};
