import NextAuth, { type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import { PrismaClient } from "@prisma/client";
import { assertSafeDashboardAuthEnv } from "./dev-auth";
import { verifyPassword } from "./password";
import { provisionDashboardUser } from "./provision-dashboard-user";

const prisma = new PrismaClient();

assertSafeDashboardAuthEnv();

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

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

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
  secret: process.env.NEXTAUTH_SECRET,
  providers,
  adapter: {
    async createUser(user) {
      const dashboardUser = await provisionDashboardUser(prisma, {
        email: user.email!,
        name: user.name,
        emailVerified: user.emailVerified,
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
    async getUserByAccount({ provider, providerAccountId }) {
      if (provider === "google") {
        const user = await prisma.dashboardUser.findUnique({
          where: { googleId: providerAccountId },
        });
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
        };
      }
      return null;
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
    async linkAccount({ userId, provider, providerAccountId }) {
      if (provider === "google") {
        const existing = await prisma.dashboardUser.findUnique({
          where: { googleId: providerAccountId },
        });
        if (existing && existing.id !== userId) {
          throw new Error("This Google account is already linked to another user");
        }
        await prisma.dashboardUser.update({
          where: { id: userId },
          data: { googleId: providerAccountId },
        });
      }
      return undefined as never;
    },
    async unlinkAccount() {
      // SAFETY: No OAuth providers — account unlinking is never called
      return undefined as never;
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
      // SAFETY: Extending session with custom fields from JWT token — NextAuth's
      // type definitions don't include custom fields, but the session object is
      // a plain object that accepts additional properties at runtime
      (session as unknown as Record<string, unknown>).organizationId = token.organizationId;
      (session as unknown as Record<string, unknown>).principalId = token.principalId;
      return session;
    },
  },
});
