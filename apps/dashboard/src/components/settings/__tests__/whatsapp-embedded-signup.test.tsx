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

  it("tucks the 2SV PIN behind a collapsed disclosure, revealed on toggle", () => {
    vi.stubGlobal("FB", { login: vi.fn() });
    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);

    // The PIN is in the DOM (so its value can still post) but hidden by default,
    // so the default surface is a single clean Connect button.
    const pin = screen.getByLabelText(/two-step verification pin/i);
    expect(pin).not.toBeVisible();

    const toggle = screen.getByRole("button", {
      name: /already has two-step verification/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(pin).toBeVisible();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("auto-opens the PIN disclosure when the server reports pin-required", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        code: "whatsapp_registration_pin_required",
        error: "Enter the existing 6-digit PIN.",
      }),
    });
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            data: { phone_number_id: "PHONE_X", waba_id: "WABA_X" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    // closed before the failed attempt
    expect(
      screen.getByRole("button", { name: /already has two-step verification/i }),
    ).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /already has two-step verification/i }),
      ).toHaveAttribute("aria-expanded", "true"),
    );
    expect(screen.getByLabelText(/two-step verification pin/i)).toBeVisible();
  });

  it("renders the branded Connect WhatsApp Business step with the what-happens preview", () => {
    vi.stubGlobal("FB", { login: vi.fn() });
    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);

    expect(screen.getByRole("heading", { name: /connect whatsapp business/i })).toBeInTheDocument();
    // "Sign in with Meta" appears as both the lede and the step-1 title.
    expect(screen.getAllByText(/sign in with meta/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Choose your Business Account")).toBeInTheDocument();
    expect(screen.getByText("Verify your number")).toBeInTheDocument();
  });

  it("shows the connected card with a Done button that fires onSuccess (deferred, not before)", async () => {
    const onSuccess = vi.fn();
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            data: { phone_number_id: "PHONE_X", waba_id: "WABA_X" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    // The branded success card renders the verified identity...
    await waitFor(() => expect(screen.getByText(/whatsapp business connected/i)).toBeVisible());
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // ...and onSuccess is held until the operator confirms with Done.
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onSuccess).toHaveBeenCalledWith({
      wabaId: "WABA_X",
      phoneNumberId: "PHONE_X",
      connectionId: "conn_X",
    });
  });

  it("fires onConnected the moment the onboard succeeds, before the card is dismissed", async () => {
    const onConnected = vi.fn();
    const onSuccess = vi.fn();
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            data: { phone_number_id: "PHONE_X", waba_id: "WABA_X" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(
      <WhatsAppEmbeddedSignup
        _metaAppId="app"
        metaConfigId="cfg"
        onConnected={onConnected}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));

    // The list refresh fires on success (independent of Done / X dismissal)...
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    // ...while the close is still gated on the operator confirming with Done.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("renders the Verified status as the editorial positive Badge, not a raw-hex chip", async () => {
    const fbLogin = vi.fn((cb: (r: unknown) => void) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: JSON.stringify({
            type: "WA_EMBEDDED_SIGNUP",
            data: { phone_number_id: "PHONE_X", waba_id: "WABA_X" },
          }),
        }),
      );
      cb({ authResponse: { code: "AUTH_CODE_123" } });
    });
    vi.stubGlobal("FB", { login: fbLogin });

    render(<WhatsAppEmbeddedSignup _metaAppId="app" metaConfigId="cfg" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect WhatsApp" }));
    await waitFor(() => expect(screen.getByText(/whatsapp business connected/i)).toBeVisible());

    const verified = screen.getByText("Verified");
    expect(verified.className).toContain("bg-positive");
    expect(verified.className).not.toContain("bg-[#e9f9f0]");
  });
});
