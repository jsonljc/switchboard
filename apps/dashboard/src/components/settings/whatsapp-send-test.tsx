"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useSendWhatsAppTest } from "@/hooks/use-whatsapp-send-test";

export interface SendTestPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
}

export interface SendTestTemplate {
  name: string;
  status: string;
  language: string;
}

interface Props {
  phoneNumbers: SendTestPhoneNumber[];
  templates: SendTestTemplate[];
  allowedRecipients: string[];
}

export function WhatsAppSendTest({ phoneNumbers, templates, allowedRecipients }: Props) {
  const activeNumbers = useMemo(
    () => phoneNumbers.filter((p) => p.status === "active"),
    [phoneNumbers],
  );
  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status.toUpperCase() === "APPROVED"),
    [templates],
  );

  const [phoneNumberId, setPhoneNumberId] = useState(activeNumbers[0]?.id ?? "");
  const [templateName, setTemplateName] = useState(approvedTemplates[0]?.name ?? "");
  const [languageCode, setLanguageCode] = useState(approvedTemplates[0]?.language ?? "en_US");
  const [toNumber, setToNumber] = useState(allowedRecipients[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const send = useSendWhatsAppTest();

  const disabled =
    !phoneNumberId ||
    !templateName ||
    !toNumber ||
    approvedTemplates.length === 0 ||
    allowedRecipients.length === 0 ||
    send.isPending;

  async function onSubmit() {
    setError(null);
    try {
      const tpl = approvedTemplates.find((t) => t.name === templateName);
      await send.mutateAsync({
        phoneNumberId,
        templateName,
        languageCode: tpl?.language ?? languageCode,
        toNumber,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Send test</CardTitle>
        <p className="text-sm text-muted-foreground">
          Send an approved template to an allowlisted recipient to verify the integration is wired
          up correctly.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">From phone</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            >
              {activeNumbers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayPhoneNumber ?? p.id} — {p.verifiedName ?? "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Template (approved only)</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={templateName}
              onChange={(e) => {
                const next = e.target.value;
                setTemplateName(next);
                const tpl = approvedTemplates.find((t) => t.name === next);
                if (tpl) setLanguageCode(tpl.language);
              }}
            >
              {approvedTemplates.length === 0 ? (
                <option value="">No approved templates</option>
              ) : (
                approvedTemplates.map((t) => (
                  <option key={`${t.name}:${t.language}`} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Test recipient (allowlist)</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
            >
              {allowedRecipients.length === 0 ? (
                <option value="">No allowlisted numbers</option>
              ) : (
                allowedRecipients.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        {allowedRecipients.length === 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertCircle className="h-4 w-4" />
            Add a test recipient to this channel before send-test can be used.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div>
          <Button onClick={onSubmit} disabled={disabled}>
            {send.isPending ? "Sending…" : "Send test"}
          </Button>
        </div>

        {send.data && (
          <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
            <div className="space-y-0.5">
              <div>Accepted by WhatsApp.</div>
              <div className="font-mono text-xs text-green-800">
                messageId: {send.data.messageId}
              </div>
              <div className="text-xs text-green-700">
                Sent at {new Date(send.data.sentAt).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
