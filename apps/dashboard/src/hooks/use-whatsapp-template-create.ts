import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { WhatsAppCreateTemplateRequest } from "@switchboard/schemas";

export interface CreateTemplateResult {
  id: string | null;
  status: string;
  category: string;
}

interface ApiError {
  error: { code: string; message: string; retryable: boolean };
}

async function postCreateTemplate(
  body: WhatsAppCreateTemplateRequest,
): Promise<CreateTemplateResult> {
  const res = await fetch("/api/dashboard/whatsapp/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(err.error?.message ?? `Create template failed (${res.status})`);
  }
  return (await res.json()) as CreateTemplateResult;
}

export function useCreateWhatsAppTemplate() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: postCreateTemplate,
    onSuccess: () => {
      if (keys) {
        void queryClient.invalidateQueries({ queryKey: keys.whatsappManagement.templates() });
      }
    },
  });
}
