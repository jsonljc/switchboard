import { useMutation } from "@tanstack/react-query";

export interface SendTestRequest {
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
}

export interface SendTestResult {
  messageId: string;
  status: "sent" | "failed";
  sentAt: string;
}

interface ApiError {
  error: { code: string; message: string; retryable: boolean };
}

async function postSendTest(body: SendTestRequest): Promise<SendTestResult> {
  const res = await fetch("/api/dashboard/whatsapp/send-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(err.error?.message ?? `Send-test failed (${res.status})`);
  }
  return (await res.json()) as SendTestResult;
}

export function useSendWhatsAppTest() {
  return useMutation({ mutationFn: postSendTest });
}
