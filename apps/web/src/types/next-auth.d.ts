import type { DefaultSession } from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      role?: string;
      tenantId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    tenantId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    tenantId?: string;
  }
}
