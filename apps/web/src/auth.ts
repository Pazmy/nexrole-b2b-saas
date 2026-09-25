import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@nexrole/database";
import bcrypt from "bcryptjs";
import { getActiveUser } from "@/lib/current-user";
import { isWorkspaceRole } from "@/lib/permissions";
import { loginSchema } from "@/lib/account-validation";
import { limitAccountRequest } from "@/lib/account-rate-limit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        try { await limitAccountRequest("login", parsed.data.email, 10); }
        catch { return null; }

        // 1. Find the user and include their role/tenant context
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { role: true, tenant: true },
        });

        if (!user || !user.isActive || !user.emailVerifiedAt || !user.passwordHash || !isWorkspaceRole(user.role.name)) return null;

        // 2. Verify the password
        const isValid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash,
        );

        if (!isValid) return null;

        // 3. Return the user object for the session
        return {
          id: user.id,
          email: user.email,
          name: user.tenant.name, // Display tenant name as user name
          role: user.role.name,
          tenantId: user.tenantId,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    // Add Tenant ID and Role to the JWT token so the frontend can use it
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
        token.sessionVersion = user.sessionVersion;
      }
      const currentUser = await getActiveUser(token.sub, token.tenantId);
      if (!currentUser || typeof token.sessionVersion !== "number" || token.sessionVersion !== currentUser.sessionVersion) return null;
      token.role = currentUser.role;
      token.email = currentUser.email;
      token.name = currentUser.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
        session.user.sessionVersion = token.sessionVersion;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
