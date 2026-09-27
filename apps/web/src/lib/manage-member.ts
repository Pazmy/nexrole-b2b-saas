import "server-only";
import { prisma } from "@nexrole/database";
import { AccessDeniedError, requirePermission } from "./authorization";
import { hasPermission } from "./permissions";
import { changeMemberRoleSchema, deactivateMemberSchema, getMemberChangeDecision } from "./membership-rules";

const messages = {
  not_found: "Member not found.",
  last_admin: "Keep at least one other active, verified administrator before making this change.",
  inactive_member: "This member is already inactive. Inactive members cannot be changed.",
  unchanged_role: "This member already has that role.",
  invalid_state: "The membership state could not be confirmed. Refresh before trying again.",
};
export class MemberManagementError extends Error {
  constructor(public readonly code: keyof typeof messages) { super(messages[code]); this.name = "MemberManagementError"; }
}

type LockedMember = { id: string; role: string; isActive: boolean; emailVerifiedAt: Date | null; sessionVersion: number };

async function manageMember(input: unknown, operation: "change-role" | "deactivate") {
  const actor = await requirePermission("members:manage");
  const values = operation === "change-role"
    ? { ...changeMemberRoleSchema.parse(input), operation: "change-role" as const }
    : { ...deactivateMemberSchema.parse(input), operation: "deactivate" as const };
  const change = values;
  return prisma.$transaction(async (tx) => {
    const tenants = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
    if (!tenants[0]) throw new AccessDeniedError();
    // Tenant-first matches transaction writes. Lock membership rows in ID order
    // so actor checks and the replacement-admin count cannot change until commit.
    const members = await tx.$queryRaw<LockedMember[]>`
      SELECT u.id, u."isActive", u."emailVerifiedAt", u."sessionVersion", r.name AS role
      FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u."tenantId" = ${actor.tenantId}::uuid ORDER BY u.id
      FOR UPDATE OF u FOR SHARE OF r`;
    const currentActor = members.find((member) => member.id === actor.id);
    if (!currentActor?.isActive || !currentActor.emailVerifiedAt || currentActor.sessionVersion !== actor.sessionVersion ||
      !hasPermission(currentActor.role, "members:manage")) throw new AccessDeniedError();
    const target = members.find((member) => member.id === values.id);
    if (!target) throw new MemberManagementError("not_found");
    const otherAdmins = members.filter((member) => member.id !== target.id && member.isActive && member.emailVerifiedAt && member.role === "SuperAdmin").length;
    const decision = getMemberChangeDecision(target, change, otherAdmins);
    if (!decision.allowed) throw new MemberManagementError(decision.reason);

    let roleId: string | undefined;
    if (change.operation === "change-role") {
      // A newly registered workspace may never have invited this role yet.
      await tx.role.createMany({ data: [{ name: change.role, permissions: [] }], skipDuplicates: true });
      const role = await tx.role.findUnique({ where: { name: change.role }, select: { id: true } });
      if (!role) throw new MemberManagementError("invalid_state");
      roleId = role.id;
    }
    const updated = await tx.user.updateMany({
      where: { id: target.id, tenantId: actor.tenantId, isActive: true, sessionVersion: target.sessionVersion },
      data: { ...(change.operation === "deactivate" ? { isActive: false } : { roleId }), sessionVersion: { increment: 1 } },
    });
    if (updated.count !== 1) throw new MemberManagementError("invalid_state");
    return { id: target.id, selfChanged: target.id === actor.id };
  }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
}

export async function changeMemberRole(input: unknown) { return manageMember(input, "change-role"); }
export async function deactivateMember(input: unknown) { return manageMember(input, "deactivate"); }
