"use server";

import { requirePermission } from "@/lib/authorization";
import { prisma } from "@nexrole/database";
import crypto from "crypto";
import { writeAuditLog } from "@/lib/audit";
import { isWorkspaceRole } from "@/lib/permissions";

export async function createMemberInvitation(
  email: string,
  roleName: string = "Member",
) {
  const { tenantId } = await requirePermission("members:invite");
  if (!isWorkspaceRole(roleName)) throw new Error("Invalid workspace role.");

  // Find target role entry in database
  const targetRole = await prisma.role.upsert({
    where: { name: roleName },
    create: { name: roleName, permissions: [] },
    update: {},
  });

  // Generate an un-guessable cryptographic secure token string
  const secretToken = crypto.randomBytes(32).toString("hex");
  const expirationWindow = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Hours expiry duration

  await prisma.invitation.create({
    data: {
      email: email.trim().toLowerCase(),
      token: secretToken,
      roleId: targetRole.id,
      tenantId: tenantId,
      expiresAt: expirationWindow,
    },
  });

  await writeAuditLog("MEMBER_INVITED", {
    invitedEmail: email.trim().toLowerCase(),
    roleAssigned: roleName,
    expiresAt: expirationWindow.toISOString(),
  });

  // NOTE: In production, this token is sent via email. For development testing, return the URL link.
  return `http://localhost:3000/register/invite?token=${secretToken}`;
}
