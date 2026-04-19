"use client";

import { useState, useCallback } from "react";
import type { BusinessFacts } from "@switchboard/schemas";

interface BusinessFactsFormProps {
  initialFacts?: Partial<BusinessFacts>;
  onSave: (facts: BusinessFacts) => void;
  isSaving?: boolean;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const DEFAULT_FACTS: BusinessFacts = {
  businessName: "",
  timezone: "Asia/Singapore",
  locations: [{ name: "", address: "" }],
  openingHours: Object.fromEntries(
    DAYS.map((d) => [d, { open: "09:00", close: "18:00", closed: false }]),
  ),
  services: [{ name: "", description: "", currency: "SGD" }],
  escalationContact: { name: "", channel: "whatsapp", address: "" },
  additionalFaqs: [],
};

export function BusinessFactsForm({ initialFacts, onSave, isSaving }: BusinessFactsFormProps) {
  const [facts, setFacts] = useState<BusinessFacts>({
    ...DEFAULT_FACTS,
    ...initialFacts,
  } as BusinessFacts);

  const updateField = useCallback(
    <K extends keyof BusinessFacts>(key: K, value: BusinessFacts[K]) => {
      setFacts((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const addLocation = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      locations: [...prev.locations, { name: "", address: "" }],
    }));
  }, []);

  const removeLocation = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      locations: prev.locations.filter((_, i) => i !== index),
    }));
  }, []);

  const updateLocation = useCallback((index: number, field: string, value: string) => {
    setFacts((prev) => ({
      ...prev,
      locations: prev.locations.map((loc, i) => (i === index ? { ...loc, [field]: value } : loc)),
    }));
  }, []);

  const addService = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      services: [...prev.services, { name: "", description: "", currency: "SGD" }],
    }));
  }, []);

  const removeService = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      services: prev.services.filter((_, i) => i !== index),
    }));
  }, []);

  const updateService = useCallback((index: number, field: string, value: string | number) => {
    setFacts((prev) => ({
      ...prev,
      services: prev.services.map((svc, i) => (i === index ? { ...svc, [field]: value } : svc)),
    }));
  }, []);

  const updateHours = useCallback((day: string, field: string, value: string | boolean) => {
    setFacts((prev) => ({
      ...prev,
      openingHours: {
        ...prev.openingHours,
        [day]: { ...prev.openingHours[day], [field]: value },
      },
    }));
  }, []);

  const addFaq = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: [...prev.additionalFaqs, { question: "", answer: "" }],
    }));
  }, []);

  const removeFaq = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: prev.additionalFaqs.filter((_, i) => i !== index),
    }));
  }, []);

  const updateFaq = useCallback((index: number, field: "question" | "answer", value: string) => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: prev.additionalFaqs.map((faq, i) =>
        i === index ? { ...faq, [field]: value } : faq,
      ),
    }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSave(facts);
    },
    [facts, onSave],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-4">Business Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Business Name *</label>
            <input
              type="text"
              value={facts.businessName}
              onChange={(e) => updateField("businessName", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Timezone</label>
            <input
              type="text"
              value={facts.timezone}
              onChange={(e) => updateField("timezone", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Locations *</h3>
          <button
            type="button"
            onClick={addLocation}
            className="text-sm text-primary hover:underline"
          >
            + Add location
          </button>
        </div>
        {facts.locations.map((loc, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-3">
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 gap-3 flex-1">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={loc.name}
                    onChange={(e) => updateLocation(i, "name", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Address *</label>
                  <input
                    type="text"
                    value={loc.address}
                    onChange={(e) => updateLocation(i, "address", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              {facts.locations.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLocation(i)}
                  className="ml-2 text-sm text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Parking Notes</label>
                <input
                  type="text"
                  value={loc.parkingNotes ?? ""}
                  onChange={(e) => updateLocation(i, "parkingNotes", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Basement parking available"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Access Notes</label>
                <input
                  type="text"
                  value={loc.accessNotes ?? ""}
                  onChange={(e) => updateLocation(i, "accessNotes", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Take lift to level 3"
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Opening Hours *</h3>
        <div className="space-y-2">
          {DAYS.map((day) => {
            const hours = facts.openingHours[day] ?? {
              open: "09:00",
              close: "18:00",
              closed: false,
            };
            return (
              <div key={day} className="flex items-center gap-3">
                <span className="w-28 text-sm capitalize">{day}</span>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={hours.closed}
                    onChange={(e) => updateHours(day, "closed", e.target.checked)}
                  />
                  Closed
                </label>
                {!hours.closed && (
                  <>
                    <input
                      type="time"
                      value={hours.open}
                      onChange={(e) => updateHours(day, "open", e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                    <span className="text-sm">to</span>
                    <input
                      type="time"
                      value={hours.close}
                      onChange={(e) => updateHours(day, "close", e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Services *</h3>
          <button
            type="button"
            onClick={addService}
            className="text-sm text-primary hover:underline"
          >
            + Add service
          </button>
        </div>
        {facts.services.map((svc, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-3">
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 gap-3 flex-1">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={svc.name}
                    onChange={(e) => updateService(i, "name", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description *</label>
                  <input
                    type="text"
                    value={svc.description}
                    onChange={(e) => updateService(i, "description", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              {facts.services.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeService(i)}
                  className="ml-2 text-sm text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={svc.durationMinutes ?? ""}
                  onChange={(e) =>
                    updateService(i, "durationMinutes", parseInt(e.target.value) || 0)
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Price</label>
                <input
                  type="text"
                  value={svc.price ?? ""}
                  onChange={(e) => updateService(i, "price", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 150"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <input
                  type="text"
                  value={svc.currency ?? "SGD"}
                  onChange={(e) => updateService(i, "currency", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Booking Policies</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cancellation Policy</label>
            <textarea
              value={facts.bookingPolicies?.cancellationPolicy ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  cancellationPolicy: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reschedule Policy</label>
            <textarea
              value={facts.bookingPolicies?.reschedulePolicy ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  reschedulePolicy: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Preparation Instructions</label>
            <textarea
              value={facts.bookingPolicies?.prepInstructions ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  prepInstructions: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
              placeholder="e.g. Brush your teeth before arriving"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-4">Escalation Contact *</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={facts.escalationContact.name}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  name: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Channel *</label>
            <select
              value={facts.escalationContact.channel}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  channel: e.target.value as "whatsapp" | "telegram" | "email" | "sms",
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address *</label>
            <input
              type="text"
              value={facts.escalationContact.address}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  address: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              placeholder="e.g. +6591234567"
            />
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Additional FAQs</h3>
          <button type="button" onClick={addFaq} className="text-sm text-primary hover:underline">
            + Add FAQ
          </button>
        </div>
        {facts.additionalFaqs.map((faq, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-2">
            <div className="flex justify-between">
              <label className="block text-sm font-medium mb-1">Question</label>
              <button
                type="button"
                onClick={() => removeFaq(i)}
                className="text-sm text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
            <input
              type="text"
              value={faq.question}
              onChange={(e) => updateFaq(i, "question", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <label className="block text-sm font-medium mb-1">Answer</label>
            <textarea
              value={faq.answer}
              onChange={(e) => updateFaq(i, "answer", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
        ))}
      </section>

      <div className="pt-4 border-t">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Business Facts"}
        </button>
      </div>
    </form>
  );
}
