import "server-only";
import { prisma } from "@nexrole/database";
import { AccessDeniedError, requirePermission } from "./authorization";
import { hasPermission, type Permission } from "./permissions";

export { writeRequiredAudit } from "@nexrole/database";
type Actor = Awaited<ReturnType<typeof requirePermission>>;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// The caller captures the authenticated actor first. Recheck after the tenant
// lock, retaining membership locks until the business write and audit commit.
export async function withAuthorizedActor<T>(actor: Actor, permission: Permission, work: (tx: Transaction) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const tenants = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
    if (!tenants.length) throw new AccessDeniedError();
    const [current] = await tx.$queryRaw<{ isActive: boolean; emailVerifiedAt: Date | null; sessionVersion: number; role: string }[]>`
      SELECT u."isActive", u."emailVerifiedAt", u."sessionVersion", r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${actor.tenantId}::uuid FOR UPDATE OF u FOR SHARE OF r`;
    if (!current?.isActive || !current.emailVerifiedAt || current.sessionVersion !== actor.sessionVersion || !hasPermission(current.role, permission)) throw new AccessDeniedError();
    return work(tx);
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 });
}
