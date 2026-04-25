import type { FastifyPluginAsync } from "fastify";
import { privateDecrypt, createDecipheriv, createCipheriv, constants } from "node:crypto";

export interface FlowHandler {
  handleInit: () => Promise<{ screen: string; data: Record<string, unknown> }>;
  handleDataExchange: (
    screen: string,
    data: Record<string, unknown>,
  ) => Promise<{ screen: string; data: Record<string, unknown> }>;
}

interface FlowsPluginOptions {
  privateKey: string;
  getFlowHandler: () => FlowHandler;
}

function decryptRequest(
  body: { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string },
  rsaPrivateKey: string,
): { decryptedData: Record<string, unknown>; aesKey: Buffer; iv: Buffer } {
  const encryptedAesKey = Buffer.from(body.encrypted_aes_key, "base64");
  const aesKey = privateDecrypt(
    { key: rsaPrivateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    encryptedAesKey,
  );
  const iv = Buffer.from(body.initial_vector, "base64");
  const encryptedData = Buffer.from(body.encrypted_flow_data, "base64");

  const authTagLength = 16;
  const ciphertext = encryptedData.subarray(0, encryptedData.length - authTagLength);
  const authTag = encryptedData.subarray(encryptedData.length - authTagLength);

  const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return { decryptedData: JSON.parse(decrypted.toString("utf-8")), aesKey, iv };
}

// IV reuse with same AES key is per WhatsApp's Flows endpoint spec — not a bug.
function encryptResponse(response: Record<string, unknown>, aesKey: Buffer, iv: Buffer): string {
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return encrypted.toString("base64");
}

export const whatsappFlowsRoutes: FastifyPluginAsync<FlowsPluginOptions> = async (app, opts) => {
  app.post<{
    Body: { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string };
  }>("/whatsapp/flows", async (request, reply) => {
    let decryptedData: Record<string, unknown>;
    let aesKey: Buffer;
    let iv: Buffer;

    try {
      ({ decryptedData, aesKey, iv } = decryptRequest(request.body, opts.privateKey));
    } catch {
      return reply.code(421).send("Decryption failed");
    }

    const action = decryptedData["action"] as string;
    const handler = opts.getFlowHandler();
    let responseData: { screen: string; data: Record<string, unknown> };

    if (action === "INIT") {
      responseData = await handler.handleInit();
    } else if (action === "DATA_EXCHANGE") {
      const screen = decryptedData["screen"] as string;
      const data = decryptedData["data"] as Record<string, unknown>;
      responseData = await handler.handleDataExchange(screen, data);
    } else if (action === "ping") {
      const encrypted = encryptResponse({ data: { status: "active" } }, aesKey, iv);
      return reply.code(200).send(encrypted);
    } else {
      return reply.code(400).send("Unknown action");
    }

    const encrypted = encryptResponse(responseData, aesKey, iv);
    return reply.code(200).send(encrypted);
  });
};
