import { describe, it, expect } from "vitest";
import { parseLeadWebhook } from "../meta-leads-ingester.js";

describe("parseLeadWebhook", () => {
  it("extracts lead data from valid webhook payload", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "lead-456",
                ad_id: "ad-789",
                form_id: "form-101",
                field_data: [
                  { name: "full_name", values: ["John Doe"] },
                  { name: "email", values: ["john@example.com"] },
                  { name: "phone_number", values: ["+1234567890"] },
                ],
              },
            },
          ],
        },
      ],
    };
    const leads = parseLeadWebhook(payload);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toEqual({
      leadId: "lead-456",
      adId: "ad-789",
      formId: "form-101",
      name: "John Doe",
      email: "john@example.com",
      phone: "+1234567890",
    });
  });

  it("handles multiple leads in one webhook", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: { leadgen_id: "lead-1", ad_id: "ad-1", form_id: "f1", field_data: [] },
            },
            {
              field: "leadgen",
              value: { leadgen_id: "lead-2", ad_id: "ad-2", form_id: "f2", field_data: [] },
            },
          ],
        },
      ],
    };
    expect(parseLeadWebhook(payload)).toHaveLength(2);
  });

  it("returns empty array for non-leadgen changes", () => {
    const payload = { entry: [{ id: "page-123", changes: [{ field: "feed", value: {} }] }] };
    expect(parseLeadWebhook(payload)).toHaveLength(0);
  });

  it("handles missing field_data gracefully", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            { field: "leadgen", value: { leadgen_id: "lead-1", ad_id: "ad-1", form_id: "f1" } },
          ],
        },
      ],
    };
    const leads = parseLeadWebhook(payload);
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBeUndefined();
    expect(leads[0].email).toBeUndefined();
  });
});
