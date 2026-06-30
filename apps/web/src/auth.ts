import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@nexrole/database";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        // 1. Find the user and include their role/tenant context
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { role: true, tenant: true },
        });

        if (!user || !user.passwordHash) return null;

        // 2. Verify the password
        const isValid = await bcrypt.compare(
          credentials.password as string,
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
        };
      },
    }),
  ],
  callbacks: {
    // Add Tenant ID and Role to the JWT token so the frontend can use it
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: string }).role;
        token.tenantId = (user as { tenantId: string }).tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as { role: string; tenantId: string }).role =
          token.role as string;
        (
          session.user as unknown as { role: string; tenantId: string }
        ).tenantId = token.tenantId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
