import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  generateKeyPairSync,
  publicEncrypt,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  constants,
} from "node:crypto";
import { whatsappFlowsRoutes } from "../whatsapp-flows.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function encryptFlowRequest(
  payload: Record<string, unknown>,
  rsaPublicKey: string,
): { encrypted_aes_key: string; encrypted_flow_data: string; initial_vector: string } {
  const aesKey = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const encryptedAesKey = publicEncrypt(
    { key: rsaPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey,
  );
  return {
    encrypted_aes_key: encryptedAesKey.toString("base64"),
    encrypted_flow_data: encrypted.toString("base64"),
    initial_vector: iv.toString("base64"),
  };
}

function decryptFlowResponse(
  responseBase64: string,
  aesKey: Buffer,
  iv: Buffer,
): Record<string, unknown> {
  const data = Buffer.from(responseBase64, "base64");
  const authTagLength = 16;
  const ciphertext = data.subarray(0, data.length - authTagLength);
  const authTag = data.subarray(data.length - authTagLength);
  const decipher = createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf-8"));
}

describe("WhatsApp Flows data endpoint", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(whatsappFlowsRoutes, {
      privateKey,
      getFlowHandler: () => ({
        handleInit: async () => ({
          screen: "SERVICE_SELECTION",
          data: { services: ["haircut", "color"] },
        }),
        handleDataExchange: async (_screen: string, _data: Record<string, unknown>) => ({
          screen: "DATE_TIME",
          data: { slots: ["10:00", "14:00"] },
        }),
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should decrypt INIT request and return encrypted response", async () => {
    const aesKey = randomBytes(16);
    const iv = randomBytes(12);
    const flowPayload = { action: "INIT", flow_token: "test_token" };

    // Encrypt manually to have access to the AES key for decryption
    const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(flowPayload), "utf-8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const encryptedAesKey = publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      aesKey,
    );

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: {
        encrypted_aes_key: encryptedAesKey.toString("base64"),
        encrypted_flow_data: encrypted.toString("base64"),
        initial_vector: iv.toString("base64"),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(typeof body).toBe("string");
    expect(body.length).toBeGreaterThan(0);

    // Decrypt and verify
    const decrypted = decryptFlowResponse(body, aesKey, iv);
    expect(decrypted).toEqual({
      screen: "SERVICE_SELECTION",
      data: { services: ["haircut", "color"] },
    });
  });

  it("should handle DATA_EXCHANGE action", async () => {
    const aesKey = randomBytes(16);
    const iv = randomBytes(12);
    const flowPayload = {
      action: "DATA_EXCHANGE",
      screen: "SERVICE_SELECTION",
      data: { service: "haircut" },
    };

    const cipher = createCipheriv("aes-128-gcm", aesKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(flowPayload), "utf-8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const encryptedAesKey = publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      aesKey,
    );

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: {
        encrypted_aes_key: encryptedAesKey.toString("base64"),
        encrypted_flow_data: encrypted.toString("base64"),
        initial_vector: iv.toString("base64"),
      },
    });

    expect(response.statusCode).toBe(200);
    const decrypted = decryptFlowResponse(response.body, aesKey, iv);
    expect(decrypted).toEqual({
      screen: "DATE_TIME",
      data: { slots: ["10:00", "14:00"] },
    });
  });

  it("should return 421 for invalid encrypted data", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: {
        encrypted_aes_key: "invalid",
        encrypted_flow_data: "invalid",
        initial_vector: "invalid",
      },
    });

    expect(response.statusCode).toBe(421);
  });

  it("should handle ping action for health check", async () => {
    const encrypted = encryptFlowRequest({ action: "ping" }, publicKey);

    const response = await app.inject({
      method: "POST",
      url: "/whatsapp/flows",
      payload: encrypted,
    });

    expect(response.statusCode).toBe(200);
  });
});
