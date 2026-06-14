// Global typing for Meta's JavaScript SDK (window.FB). Loaded by the
// MetaSdkScript loader (mounted only in the authed layout) and consumed by the
// WhatsApp embedded-signup flow.
interface Window {
  FB?: {
    init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(
      callback: (response: { authResponse?: { accessToken: string } }) => void,
      params: {
        config_id: string;
        response_type: string;
        override_default_response_type: boolean;
        extras: Record<string, unknown>;
      },
    ): void;
  };
}
