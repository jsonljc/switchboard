import type { FastifyPluginAsync } from "fastify";

interface TestResult {
  success: boolean;
  verifiedName?: string;
  displayPhoneNumber?: string;
  error?: string;
  statusCode?: number;
}

interface GraphApiError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export async function testWhatsAppCredentials(
  token: string,
  phoneNumberId: string,
): Promise<TestResult> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?access_token=${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });

    if (res.ok) {
      const data = (await res.json()) as {
        verified_name?: string;
        display_phone_number?: string;
      };
      return {
        success: true,
        verifiedName: data.verified_name,
        displayPhoneNumber: data.display_phone_number,
      };
    }

    const body = (await res.json().catch(() => ({}))) as GraphApiError;
    const graphCode = body.error?.code;
    const graphMessage = body.error?.message ?? "Unknown error";

    if (graphCode === 190 || res.status === 401) {
      return {
        success: false,
        error: "Invalid access token. Check that you copied the full token.",
        statusCode: 401,
      };
    }

    if (graphCode === 100 || res.status === 404) {
      return {
        success: false,
        error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
        statusCode: 404,
      };
    }

    return {
      success: false,
      error: `Meta API error: ${graphMessage}`,
      statusCode: res.status,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: "Could not reach Meta's servers. Check your network and try again.",
        statusCode: 504,
      };
    }
    return {
      success: false,
      error: "Could not reach Meta's servers. Check your network and try again.",
      statusCode: 504,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const whatsappTestRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { token?: string; phoneNumberId?: string };
  }>(
    "/whatsapp/test",
    {
      schema: {
        description: "Test WhatsApp Cloud API credentials before saving.",
        tags: ["Connections", "WhatsApp"],
      },
    },
    async (request, reply) => {
      const { token, phoneNumberId } = request.body ?? {};

      if (!token || !phoneNumberId) {
        return reply.code(400).send({
          error: "Both token and phoneNumberId are required",
          statusCode: 400,
        });
      }

      const result = await testWhatsAppCredentials(token, phoneNumberId);

      if (result.success) {
        // Update lastHealthCheck on the org's WhatsApp connections
        const orgId = request.organizationIdFromAuth;
        if (orgId && app.prisma) {
          await app.prisma.connection.updateMany({
            where: {
              organizationId: orgId,
              serviceId: "whatsapp",
            },
            data: {
              lastHealthCheck: new Date(),
            },
          });
        }
        return reply.code(200).send(result);
      }
      return reply.code(result.statusCode ?? 502).send(result);
    },
  );
};
