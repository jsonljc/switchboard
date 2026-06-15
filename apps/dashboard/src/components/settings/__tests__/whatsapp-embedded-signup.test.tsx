import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WhatsAppEmbeddedSignup } from "../whatsapp-embedded-signup";

describe("WhatsAppEmbeddedSignup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        wabaId: "WABA_X",
        phoneNumberId: "PHONE_X",
        connectionId: "conn_X",
        verifiedName: "Acme",
        displayPhoneNumber: "+15551230000",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the OAuth code + ESU session info (code flow), not the accessToken/esToken", async () => {
    // FB.login under response_type:"code": the SDK first posts a WA_EMBEDDED_SIGNUP
    // `message` with the session info, then invokes the callback with an auth CODE.
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH",
            data: { phone_number_id: "PHONE_FROM_SDK", waba_id: "WABA_FROM_SDK" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/dashboard/connections/whatsapp-embedded");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      code: "AUTH_CODE_123",
      wabaId: "WABA_FROM_SDK",
      phoneNumberId: "PHONE_FROM_SDK",
    });
    expect(body.esToken).toBeUndefined();
  });

  it("requests the code flow (response_type:code) with the config id", () => {
    const fbLogin = vi.fn();
    vi.stubGlobal("FB", { login: fbLogin });
    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="my_config" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    expect(fbLogin).toHaveBeenCalledTimes(1);
    const opts = fbLogin.mock.calls[0]![1] as { response_type: string; config_id: string };
    expect(opts.response_type).toBe("code");
    expect(opts.config_id).toBe("my_config");
  });

  it("returns to idle without posting when the user cancels (no code)", async () => {
    const fbLogin = vi.fn((cb: (r: unknown) => void) => cb({ authResponse: undefined }));
    vi.stubGlobal("FB", { login: fbLogin });
    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores message events from a non-facebook origin", async () => {
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://evil.example.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            data: { phone_number_id: "ATTACKER", waba_id: "ATTACKER" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    // The spoofed origin must not populate the session info.
    expect(body.wabaId).toBeUndefined();
    expect(body.phoneNumberId).toBeUndefined();
    expect(body.code).toBe("AUTH_CODE_123");
  });

  it("renders an optional two-step-verification PIN field", () => {
    vi.stubGlobal("FB", { login: vi.fn() });
    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    expect(screen.getByLabelText(/two-step verification pin/i)).toBeDefined();
  });

  it("includes the entered pin in the POST body when provided", async () => {
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH",
            data: { phone_number_id: "PHONE_FROM_SDK", waba_id: "WABA_FROM_SDK" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.change(screen.getByLabelText(/two-step verification pin/i), {
      target: { value: "246810" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.pin).toBe("246810");
    expect(body.code).toBe("AUTH_CODE_123");
    expect(body.wabaId).toBe("WABA_FROM_SDK");
    expect(body.phoneNumberId).toBe("PHONE_FROM_SDK");
  });

  it("surfaces the pin-required error and marks the PIN field invalid on a 422", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        code: "whatsapp_registration_pin_required",
        error:
          "This WhatsApp number has two-step verification enabled. Enter its existing 6-digit PIN and try again. If you don't know it, reset it in WhatsApp Manager.",
      }),
    });
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH",
            data: { phone_number_id: "PHONE_FROM_SDK", waba_id: "WABA_FROM_SDK" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // pinRequired (-> aria-invalid="true") only flips after `await res.json()`
    // resolves and React re-renders, a microtask after fetch is merely called.
    // Poll for the re-render rather than asserting synchronously, or this races
    // under CI load.
    await waitFor(() =>
      expect(screen.getByLabelText(/two-step verification pin/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getAllByText(/two-step verification/i).length).toBeGreaterThan(0);
  });
});
