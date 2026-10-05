import "server-only";
import { auth } from "@/auth";
import { getActiveUser } from "./current-user";
import { hasPermission, type Permission } from "./permissions";

export class AccessDeniedError extends Error {
  constructor() {
    super("Access denied. Sign in with an active account that has permission for this action.");
    this.name = "AccessDeniedError";
  }
}

export async function requirePermission(permission: Permission) {
  const session = await auth();
  const user = await getActiveUser(session?.user?.id, session?.user?.tenantId);
  if (!user || user.sessionVersion !== session?.user?.sessionVersion || !hasPermission(user.role, permission)) throw new AccessDeniedError();
  return user;
}
