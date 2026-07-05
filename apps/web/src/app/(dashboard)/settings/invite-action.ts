"use server";

import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import crypto from "crypto";
import { writeAuditLog } from "@/lib/audit";

export async function createMemberInvitation(
  email: string,
  roleName: string = "Member",
) {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userRole = session?.user?.role;

  if (!tenantId || userRole !== "SuperAdmin") {
    throw new Error("Unauthorized access. SuperAdmin credentials required.");
  }

  // Find target role entry in database
  let targetRole = await prisma.role.findFirst({ where: { name: roleName } });
  if (!targetRole) {
    targetRole = await prisma.role.create({
      data: { name: roleName, permissions: [] },
    });
  }

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
