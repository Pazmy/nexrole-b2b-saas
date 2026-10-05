import "server-only";
import { prisma } from "@nexrole/database";
import { isWorkspaceRole } from "./permissions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Re-read membership at the boundary; never authorize using a role copied into an old JWT.
export async function getActiveUser(id?: string, tenantId?: string) {
  if (!id || !tenantId || !UUID.test(id) || !UUID.test(tenantId)) return null;

  const user = await prisma.user.findFirst({
    where: { id, tenantId, isActive: true },
    select: {
      id: true, email: true, tenantId: true,
      emailVerifiedAt: true, sessionVersion: true,
      role: { select: { name: true } },
      tenant: { select: { name: true } },
    },
  });
  if (!user || !user.emailVerifiedAt || !isWorkspaceRole(user.role.name)) return null;
  return {
    id: user.id, email: user.email, tenantId: user.tenantId,
    role: user.role.name, name: user.tenant.name,
    sessionVersion: user.sessionVersion,
  };
}
