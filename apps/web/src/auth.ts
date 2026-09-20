import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@nexrole/database";
import bcrypt from "bcryptjs";
import { getActiveUser } from "@/lib/current-user";
import { isWorkspaceRole } from "@/lib/permissions";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (typeof credentials?.email !== "string" || typeof credentials.password !== "string") return null;

        // 1. Find the user and include their role/tenant context
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { role: true, tenant: true },
        });

        if (!user || !user.isActive || !user.passwordHash || !isWorkspaceRole(user.role.name)) return null;

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
        token.sub = user.id;
        token.role = user.role;
        token.tenantId = user.tenantId;
      }
      const currentUser = await getActiveUser(token.sub, token.tenantId);
      if (!currentUser) return null;
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
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
