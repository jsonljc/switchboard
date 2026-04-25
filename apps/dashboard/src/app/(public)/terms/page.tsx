import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Switchboard",
  description: "Switchboard terms of service — the agreement governing use of our platform.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p style={{ color: "#7A736C", marginBottom: "3rem", fontSize: "0.875rem" }}>
          Last updated: April 24, 2026
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
          <Section title="1. Acceptance of Terms">
            <p>
              By creating an account or using Switchboard (&quot;the Service&quot;), you agree to be
              bound by these Terms of Service. If you are using the Service on behalf of an
              organization, you represent that you have authority to bind that organization to these
              terms.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              Switchboard provides AI-powered agents for lead qualification, appointment booking, ad
              creative generation, and advertising optimization. The Service operates through
              integrations with third-party platforms including messaging channels and advertising
              networks.
            </p>
          </Section>

          <Section title="3. Account Responsibilities">
            <Ul>
              <li>You must provide accurate registration information.</li>
              <li>You are responsible for maintaining the security of your account credentials.</li>
              <li>
                You are responsible for all activity that occurs under your account, including
                actions taken by AI agents you configure.
              </li>
              <li>You must notify us immediately of any unauthorized use of your account.</li>
            </Ul>
          </Section>

          <Section title="4. Subscription and Billing">
            <p>
              During the beta period, the Service is provided free of charge. When paid plans are
              introduced:
            </p>
            <Ul>
              <li>Billing cycles are monthly unless otherwise agreed.</li>
              <li>Subscription fees are non-refundable except as required by applicable law.</li>
              <li>
                We will provide at least 30 days notice before introducing charges or changing
                pricing.
              </li>
              <li>Failure to pay may result in suspension or termination of your account.</li>
            </Ul>
          </Section>

          <Section title="5. Acceptable Use">
            <p>You agree not to use the Service to:</p>
            <Ul>
              <li>Violate any applicable law or regulation.</li>
              <li>Send spam or unsolicited messages through connected channels.</li>
              <li>Misrepresent AI agents as human agents to end users.</li>
              <li>Process data in violation of privacy regulations (GDPR, CCPA, etc.).</li>
              <li>Interfere with or disrupt the Service or its infrastructure.</li>
              <li>Attempt to gain unauthorized access to other users&apos; accounts or data.</li>
            </Ul>
          </Section>

          <Section title="6. Data Ownership">
            <p>
              You retain ownership of all data you provide to the Service, including business
              information, conversation logs, and creative assets. We are granted a limited license
              to process this data solely to provide the Service. See our{" "}
              <a href="/privacy" style={{ color: "#A07850" }}>
                Privacy Policy
              </a>{" "}
              for details on data handling.
            </p>
          </Section>

          <Section title="7. Service Availability">
            <p>
              We strive to maintain high availability but do not guarantee uninterrupted service.
              Planned maintenance will be communicated in advance when possible. We are not liable
              for any losses resulting from service interruptions.
            </p>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>
              To the maximum extent permitted by law, Switchboard shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, including loss of
              profits, revenue, data, or business opportunities, arising from your use of the
              Service. Our total liability shall not exceed the amount you paid for the Service in
              the 12 months preceding the claim.
            </p>
          </Section>

          <Section title="9. Indemnification">
            <p>
              You agree to indemnify and hold Switchboard harmless from any claims, damages, or
              expenses arising from your use of the Service, your violation of these terms, or your
              violation of any third-party rights.
            </p>
          </Section>

          <Section title="10. Account Termination">
            <Ul>
              <li>You may close your account at any time by contacting us.</li>
              <li>
                We may suspend or terminate your account for violation of these terms, with
                reasonable notice when possible.
              </li>
              <li>
                Upon termination, your data will be retained for 30 days to allow export, then
                deleted.
              </li>
              <li>Provisions that by nature should survive termination will survive.</li>
            </Ul>
          </Section>

          <Section title="11. Modifications to Terms">
            <p>
              We may modify these terms at any time. Material changes will be communicated via email
              or platform notification at least 30 days before taking effect. Continued use of the
              Service after changes take effect constitutes acceptance of the updated terms.
            </p>
          </Section>

          <Section title="12. Governing Law">
            <p>
              These terms are governed by the laws of Singapore. Any disputes shall be resolved
              through binding arbitration in Singapore, except where prohibited by law.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              For questions about these terms, contact us at{" "}
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
