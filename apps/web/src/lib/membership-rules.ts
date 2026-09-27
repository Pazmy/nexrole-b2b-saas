import { z } from "zod";
import { emailSchema } from "./account-validation";
import { ROLE } from "./constants";

export const workspaceRoleSchema = z.enum([ROLE.SUPER_ADMIN, ROLE.MEMBER, ROLE.DEVELOPER]);
export const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const INVITATION_REQUEST_LIMIT = 10;

export const changeMemberRoleSchema = z.object({
  id: z.uuid("Choose a valid member."),
  role: workspaceRoleSchema,
}).strict();
export const deactivateMemberSchema = z.object({ id: z.uuid("Choose a valid member.") }).strict();
export const createInvitationSchema = z.object({ email: emailSchema, role: workspaceRoleSchema }).strict();
export const manageInvitationSchema = z.object({ id: z.uuid("Choose a valid invitation.") }).strict();

type MemberChange = { operation: "change-role"; role: z.infer<typeof workspaceRoleSchema> } | { operation: "deactivate" };
type MemberDecision = { allowed: true } | { allowed: false; reason: "invalid_state" | "inactive_member" | "unchanged_role" | "last_admin" };

// Pure policy, not authorization. The service must lock the tenant, recheck the
// actor and read the target/count under that lock before applying this decision.
// Count OTHER active, email-verified SuperAdmins in this same tenant only.
export function getMemberChangeDecision(
  target: { role: string; isActive: boolean },
  change: MemberChange,
  otherActiveVerifiedAdmins: number,
): MemberDecision {
  if (!workspaceRoleSchema.safeParse(target.role).success ||
    !Number.isSafeInteger(otherActiveVerifiedAdmins) || otherActiveVerifiedAdmins < 0 ||
    (change.operation !== "deactivate" && change.operation !== "change-role") ||
    (change.operation === "change-role" && !workspaceRoleSchema.safeParse(change.role).success)) {
    return { allowed: false, reason: "invalid_state" };
  }
  if (!target.isActive) return { allowed: false, reason: "inactive_member" };
  if (change.operation === "change-role" && change.role === target.role) return { allowed: false, reason: "unchanged_role" };
  if (target.role === ROLE.SUPER_ADMIN && otherActiveVerifiedAdmins === 0) return { allowed: false, reason: "last_admin" };
  return { allowed: true };
}

// Email/account existence must be read from the DB, never accepted from a form.
// An expired invitation is still managed with Resend, not a duplicate row.
export function getInvitationCreationDecision(existingAccount: boolean, existingInvitation: boolean):
  { allowed: true } | { allowed: false; reason: "account_exists" | "use_resend" } {
  if (existingAccount) return { allowed: false, reason: "account_exists" };
  if (existingInvitation) return { allowed: false, reason: "use_resend" };
  return { allowed: true };
}

export function isInvitationUnexpired(expiresAt: Date, now: Date): boolean {
  return Number.isFinite(expiresAt.getTime()) && Number.isFinite(now.getTime()) && expiresAt.getTime() > now.getTime();
}
