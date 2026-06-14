import type { ReactNode } from "react";

type PaymentResultVariant = "success" | "cancel";

interface VariantContent {
  readonly title: string;
  readonly body: string;
  readonly icon: ReactNode;
  readonly accent: string;
}

const CHECK_ICON = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const CANCEL_ICON = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const CONTENT: Record<PaymentResultVariant, VariantContent> = {
  success: {
    title: "Thank you for your payment",
    body: "Your clinic will confirm your appointment shortly. You can close this page and return to your chat.",
    icon: CHECK_ICON,
    accent: "#1F8A5B",
  },
  cancel: {
    title: "Payment canceled",
    body: "You have not been charged. To secure your appointment, return to your chat with the clinic to complete payment.",
    icon: CANCEL_ICON,
    accent: "#9A6A2E",
  },
};

export function PaymentResultCard({ variant }: { variant: PaymentResultVariant }) {
  const content = CONTENT[variant];
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#F7F4EF",
        color: "#1A1714",
      }}
    >
      <section
        style={{
          maxWidth: "26rem",
          width: "100%",
          textAlign: "center",
          background: "#FFFFFF",
          border: "1px solid #E7E0D6",
          borderRadius: "1rem",
          padding: "2.5rem 2rem",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "3rem",
            height: "3rem",
            margin: "0 auto 1.25rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "999px",
            background: `${content.accent}1A`,
            color: content.accent,
          }}
        >
          {content.icon}
        </div>
        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            margin: "0 0 0.625rem",
          }}
        >
          {content.title}
        </h1>
        <p style={{ fontSize: "0.9375rem", lineHeight: 1.5, color: "#5C544B", margin: 0 }}>
          {content.body}
        </p>
        <p
          style={{
            marginTop: "2rem",
            marginBottom: 0,
            fontSize: "0.75rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "#9A938A",
          }}
        >
          Switchboard
        </p>
      </section>
    </div>
  );
}
