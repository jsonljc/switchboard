import NextAuth, { type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
import { encryptApiKey } from "./crypto";
import { verifyPassword } from "./password";

const prisma = new PrismaClient();

const providers: NextAuthConfig["providers"] = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const email = credentials.email as string;
      const password = credentials.password as string;

      const user = await prisma.dashboardUser.findUnique({ where: { email } });
      if (!user || !user.passwordHash) return null;

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        organizationId: user.organizationId,
        principalId: user.principalId,
      };
    },
  }),
];

// Only include the email (magic link) provider when SMTP is configured
if (process.env.EMAIL_SERVER_HOST) {
  providers.push(
    EmailProvider({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT || 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM || "noreply@switchboard.app",
    }),
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  adapter: {
    async createUser(user) {
      // When a user first signs in via magic link, create the DashboardUser,
      // plus a Principal and IdentitySpec via the Switchboard API
      const orgId = `org_${randomUUID()}`;
      const principalId = `principal_${randomUUID()}`;
      const apiKey = `sk_${randomUUID().replace(/-/g, "")}`;

      const dashboardUser = await prisma.dashboardUser.create({
        data: {
          id: randomUUID(),
          email: user.email!,
          name: user.name,
          emailVerified: user.emailVerified,
          organizationId: orgId,
          principalId,
          apiKeyEncrypted: encryptApiKey(apiKey),
          apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
        },
      });

      return {
        id: dashboardUser.id,
        email: dashboardUser.email,
        name: dashboardUser.name,
        emailVerified: dashboardUser.emailVerified,
      };
    },
    async getUser(id) {
      const user = await prisma.dashboardUser.findUnique({ where: { id } });
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified };
    },
    async getUserByEmail(email) {
      const user = await prisma.dashboardUser.findUnique({ where: { email } });
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified };
    },
    async getUserByAccount() {
      return null; // We only use email provider
    },
    async updateUser(user) {
      const updated = await prisma.dashboardUser.update({
        where: { id: user.id! },
        data: {
          name: user.name,
          emailVerified: user.emailVerified,
        },
      });
      return {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        emailVerified: updated.emailVerified,
      };
    },
    async linkAccount() {
      return undefined as any;
    },
    async unlinkAccount() {
      return undefined as any;
    },
    async createSession(session) {
      await prisma.dashboardSession.create({
        data: {
          id: randomUUID(),
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        },
      });
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const session = await prisma.dashboardSession.findUnique({
        where: { sessionToken },
        include: { user: true },
      });
      if (!session) return null;
      return {
        session: {
          sessionToken: session.sessionToken,
          userId: session.userId,
          expires: session.expires,
        },
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        },
      };
    },
    async updateSession(session) {
      await prisma.dashboardSession.update({
        where: { sessionToken: session.sessionToken },
        data: { expires: session.expires },
      });
      return session as any;
    },
    async deleteSession(sessionToken) {
      await prisma.dashboardSession.delete({ where: { sessionToken } }).catch(() => {});
    },
    async createVerificationToken(token) {
      await prisma.dashboardVerificationToken.create({
        data: { identifier: token.identifier, token: token.token, expires: token.expires },
      });
      return token;
    },
    async useVerificationToken({ identifier, token }) {
      try {
        const vt = await prisma.dashboardVerificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
        return { identifier: vt.identifier, token: vt.token, expires: vt.expires };
      } catch {
        return null;
      }
    },
  },
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login?verify=true",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: populate JWT from user object
        token.id = user.id;

        // For credentials sign-in, organizationId/principalId are on the user object
        const credUser = user as typeof user & {
          organizationId?: string;
          principalId?: string;
        };
        if (credUser.organizationId) {
          token.organizationId = credUser.organizationId;
          token.principalId = credUser.principalId;
        } else {
          // Magic link sign-in: look up from DB
          const dashUser = await prisma.dashboardUser.findUnique({
            where: { id: user.id },
          });
          if (dashUser) {
            token.organizationId = dashUser.organizationId;
            token.principalId = dashUser.principalId;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Populate session from JWT token
      if (token.id) {
        session.user.id = token.id as string;
      }
      (session as any).organizationId = token.organizationId;
      (session as any).principalId = token.principalId;
      return session;
    },
  },
});
