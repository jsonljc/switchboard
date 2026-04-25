import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Switchboard",
  description: "Switchboard privacy policy — how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1A1714",
        color: "#EDE8E1",
        padding: "4rem 2rem",
      }}
    >
      <div style={{ maxWidth: "48rem", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            marginBottom: "0.5rem",
            letterSpacing: "-0.02em",
          }}
        >
          Privacy Policy
        </h1>
        <p style={{ color: "#7A736C", marginBottom: "3rem", fontSize: "0.875rem" }}>
          Last updated: April 24, 2026
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          <Section title="1. Information We Collect">
            <p>We collect information you provide directly when you create an account:</p>
            <Ul>
              <li>
                <strong>Account information:</strong> email address and hashed password.
              </li>
              <li>
                <strong>Organization data:</strong> business name, timezone, and business hours you
                configure.
              </li>
              <li>
                <strong>Integration credentials:</strong> OAuth tokens for services you connect
                (Google Calendar, Meta Ads, WhatsApp, Telegram). These are encrypted at rest.
              </li>
              <li>
                <strong>Usage data:</strong> conversation logs processed by your AI agents, task
                outcomes, and audit trails.
              </li>
            </Ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <Ul>
              <li>To provide and maintain the Switchboard platform and AI agent services.</li>
              <li>To process leads, schedule bookings, and execute agent tasks on your behalf.</li>
              <li>
                To generate performance analytics (conversion rates, response times, ROI metrics).
              </li>
              <li>To improve our AI models and service quality.</li>
              <li>To communicate service updates and security notices.</li>
            </Ul>
          </Section>

          <Section title="3. Data Processing">
            <p>
              Switchboard acts as a data processor on your behalf. Conversation data between your AI
              agents and your leads is processed to fulfill the services you configure (lead
              qualification, appointment booking, ad optimization). We do not sell your data or your
              customers&apos; data to third parties.
            </p>
          </Section>

          <Section title="4. Third-Party Services">
            <p>We integrate with the following third-party services when you connect them:</p>
            <Ul>
              <li>
                <strong>Anthropic (Claude):</strong> AI language model for agent conversations.
              </li>
              <li>
                <strong>Google Calendar:</strong> appointment scheduling.
              </li>
              <li>
                <strong>Meta Ads:</strong> ad performance data and optimization.
              </li>
              <li>
                <strong>WhatsApp / Telegram:</strong> messaging channel delivery.
              </li>
            </Ul>
            <p style={{ marginTop: "0.75rem" }}>
              Each integration is governed by the respective provider&apos;s privacy policy. We only
              access data necessary to provide our services.
            </p>
          </Section>

          <Section title="5. Data Security">
            <p>
              We implement industry-standard security measures including encryption of credentials
              at rest, secure session management, and access controls. Integration tokens are
              encrypted using AES-256 before storage.
            </p>
          </Section>

          <Section title="6. Data Retention">
            <p>
              We retain your data for as long as your account is active. Conversation logs and task
              records are retained for 90 days after completion. You may request deletion of your
              account and associated data at any time by contacting us.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p>You have the right to:</p>
            <Ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data.</li>
              <li>Export your data in a portable format.</li>
              <li>Withdraw consent for data processing.</li>
            </Ul>
          </Section>

          <Section title="8. Cookies">
            <p>
              We use essential cookies for authentication and session management. We do not use
              third-party tracking cookies or advertising pixels on our platform.
            </p>
          </Section>

          <Section title="9. Changes to This Policy">
            <p>
              We may update this policy from time to time. We will notify you of material changes
              via email or through the platform dashboard.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              For privacy-related inquiries, contact us at{" "}
              <a href="mailto:hello@switchboard.ai" style={{ color: "#A07850" }}>
                hello@switchboard.ai
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>{title}</h2>
      <div
        style={{
          color: "#A09A93",
          fontSize: "0.9375rem",
          lineHeight: 1.7,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return (
    <ul
      style={{
        paddingLeft: "1.25rem",
        listStyleType: "disc",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      {children}
    </ul>
  );
}
