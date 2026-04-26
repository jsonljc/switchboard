"use client";

import { useEffect, useState } from "react";

type SourceType = "tally" | "typeform" | "webflow" | "google-forms" | "generic";

interface LeadWebhookSummary {
  id: string;
  label: string;
  tokenPrefix: string;
  sourceType: SourceType;
  greetingTemplateName: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface CreatedResponse extends LeadWebhookSummary {
  token: string;
  url: string;
}

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: "tally", label: "Tally (recommended — free webhooks)" },
  { value: "google-forms", label: "Google Forms (free, requires Apps Script)" },
  { value: "typeform", label: "Typeform (paid plan required)" },
  { value: "webflow", label: "Webflow (paid Site Plan required)" },
  { value: "generic", label: "Generic / custom HTML form" },
];

async function fetchList(): Promise<LeadWebhookSummary[]> {
  const r = await fetch("/api/dashboard/lead-webhooks");
  if (!r.ok) throw new Error(`failed to load (${r.status})`);
  const data = (await r.json()) as { webhooks: LeadWebhookSummary[] };
  return data.webhooks;
}

async function fetchCreate(input: {
  label: string;
  sourceType: SourceType;
  greetingTemplateName?: string;
}): Promise<CreatedResponse> {
  const r = await fetch("/api/dashboard/lead-webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`failed to create (${r.status})`);
  return (await r.json()) as CreatedResponse;
}

async function fetchRevoke(id: string): Promise<void> {
  const r = await fetch(`/api/dashboard/lead-webhooks/${id}/revoke`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(`failed to revoke (${r.status})`);
}

export function LeadWebhooksList() {
  const [items, setItems] = useState<LeadWebhookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("tally");
  const [greetingTemplateName, setGreetingTemplateName] = useState("");
  const [revealed, setRevealed] = useState<{ url: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await fetchList());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    try {
      const created = await fetchCreate({
        label,
        sourceType,
        greetingTemplateName: greetingTemplateName.trim() || undefined,
      });
      setRevealed({ url: created.url, label: created.label });
      setLabel("");
      setGreetingTemplateName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create");
    }
  }

  async function onRevoke(id: string) {
    if (
      !confirm("Revoke this webhook? Any form posting to this URL will start failing immediately.")
    )
      return;
    try {
      await fetchRevoke(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to revoke");
    }
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Website lead webhooks</h2>
      <p className="text-sm text-muted-foreground">
        Generate a webhook URL, paste it into your form tool, and Alex will follow up on every new
        lead within seconds.
      </p>

      <form onSubmit={onCreate} className="flex flex-col gap-3 max-w-xl border rounded-md p-4">
        <label className="text-sm">
          Label
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., Tally — Contact form"
            required
            className="mt-1 block w-full border rounded px-2 py-1"
          />
        </label>
        <label className="text-sm">
          Form tool
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as SourceType)}
            className="mt-1 block w-full border rounded px-2 py-1"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          WhatsApp greeting template (optional)
          <input
            type="text"
            value={greetingTemplateName}
            onChange={(e) => setGreetingTemplateName(e.target.value)}
            placeholder="lead_welcome"
            className="mt-1 block w-full border rounded px-2 py-1"
          />
          <span className="block mt-1 text-xs text-muted-foreground">
            Defaults to <code>lead_welcome</code>. Use a different approved template if your brand
            greets in another language.
          </span>
        </label>
        <button
          type="submit"
          className="self-start px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
        >
          Generate webhook URL
        </button>
        {error && <div className="text-sm text-destructive">{error}</div>}
      </form>

      {revealed && (
        <div className="border rounded-md p-4 bg-muted">
          <div className="text-sm font-medium mb-2">
            Your webhook URL — copy it now, you won&apos;t see it again
          </div>
          <code className="block break-all text-xs bg-background p-2 rounded">{revealed.url}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(revealed.url)}
            className="mt-2 text-xs underline"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Existing webhooks</h3>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No webhooks yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Label</th>
                <th className="text-left py-2">Source</th>
                <th className="text-left py-2">Token</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Last used</th>
                <th className="text-right py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-b">
                  <td className="py-2">{w.label}</td>
                  <td className="py-2">{w.sourceType}</td>
                  <td className="py-2">
                    <code>{w.tokenPrefix}…</code>
                  </td>
                  <td className="py-2">{w.status}</td>
                  <td className="py-2">
                    {w.lastUsedAt ? new Date(w.lastUsedAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 text-right">
                    {w.status === "active" && (
                      <button
                        onClick={() => onRevoke(w.id)}
                        className="text-xs text-destructive underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
