"use server";
import { requirePermission } from "@/lib/authorization";
import { emailSchema } from "@/lib/account-validation";
import { limitAccountRequest } from "@/lib/account-rate-limit";
import { inviteAccount } from "@/lib/accounts";
import { writeAuditLog } from "@/lib/audit";
import { isWorkspaceRole } from "@/lib/permissions";
export async function createMemberInvitation(email: string, roleName = "Member") {
  const { tenantId } = await requirePermission("members:invite");
  if (!isWorkspaceRole(roleName)) throw new Error("Invalid workspace role.");
  const normalized = emailSchema.parse(email);
  await limitAccountRequest("invite", tenantId, 10);
  await inviteAccount(normalized, roleName, tenantId);
  await writeAuditLog("MEMBER_INVITED", { invitedEmail: normalized, roleAssigned: roleName });
  return { success: true };
}
