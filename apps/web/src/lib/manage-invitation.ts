import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma, writeRequiredAudit } from "@nexrole/database";
import { AccessDeniedError, requirePermission } from "./authorization";
import { hasPermission, isWorkspaceRole } from "./permissions";
import { limitAccountRequest } from "./account-rate-limit";
import { emailConfig } from "./email-config";
import { sendAccountEmail } from "./email";
import { createInvitationSchema, manageInvitationSchema, getInvitationCreationDecision, INVITATION_LIFETIME_MS, INVITATION_REQUEST_LIMIT } from "./membership-rules";

const messages = {
  not_found: "Invitation not found.",
  account_exists: "An account with this email already exists. It cannot join another workspace.",
  use_resend: "An invitation already exists for this email. Use Resend or revoke it first.",
  invalid_role: "This invitation has an unsupported role. Revoke it and create a new invitation.",
  delivery_failed: "We could not send the invitation. No new link is usable. Retry the invitation.",
  activation_unconfirmed: "The email may have been sent, but invitation activation was not confirmed. Refresh the list and resend the invitation.",
  changed: "The invitation changed while sending. Refresh the invitation list before trying again.",
};
export class InvitationError extends Error {
  constructor(public readonly code: keyof typeof messages) { super(messages[code]); this.name = "InvitationError"; }
}
type Actor = Awaited<ReturnType<typeof requirePermission>>;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withActor<T>(actor: Actor, work: (tx: Transaction) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const tenants = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
    if (!tenants.length) throw new AccessDeniedError();
    const [current] = await tx.$queryRaw<{ isActive: boolean; emailVerifiedAt: Date | null; sessionVersion: number; role: string }[]>`
      SELECT u."isActive", u."emailVerifiedAt", u."sessionVersion", r.name AS role
      FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${actor.tenantId}::uuid
      FOR UPDATE OF u FOR SHARE OF r`;
    if (!current?.isActive || !current.emailVerifiedAt || current.sessionVersion !== actor.sessionVersion ||
      !hasPermission(current.role, "invitations:manage")) throw new AccessDeniedError();
    return work(tx);
  }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 10_000 });
}

export async function listInvitations() {
  const actor = await requirePermission("invitations:manage");
  return withActor(actor, async (tx) => {
    const rows = await tx.invitation.findMany({ where: { tenantId: actor.tenantId },
      select: { id: true, email: true, roleId: true, expiresAt: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const roles = await tx.role.findMany({ where: { id: { in: rows.map((row) => row.roleId) } }, select: { id: true, name: true } });
    return rows.map(({ roleId, ...row }) => ({ ...row, role: roles.find((role) => role.id === roleId)?.name ?? "Unknown",
      expired: row.expiresAt <= new Date() }));
  });
}

async function issueInvitation(input: unknown, operation: "create" | "resend") {
  const actor = await requirePermission("invitations:manage");
  const values = operation === "create" ? createInvitationSchema.parse(input) : manageInvitationSchema.parse(input);
  emailConfig();
  // Create and resend share the existing workspace/network email budget.
  await limitAccountRequest("invite", actor.tenantId, INVITATION_REQUEST_LIMIT);
  const rawToken = randomBytes(32).toString("hex");
  const token = createHash("sha256").update(rawToken).digest("hex");
  const reserved = await withActor(actor, async (tx) => {
    let invitation;
    let roleName: "SuperAdmin" | "Member" | "Developer";
    if ("email" in values) {
      const decision = getInvitationCreationDecision(
        !!await tx.user.findUnique({ where: { email: values.email }, select: { id: true } }),
        !!await tx.invitation.findFirst({ where: { tenantId: actor.tenantId, email: values.email }, select: { id: true } }));
      if (!decision.allowed) throw new InvitationError(decision.reason);
      await tx.role.createMany({ data: [{ name: values.role, permissions: [] }], skipDuplicates: true });
      const role = await tx.role.findUniqueOrThrow({ where: { name: values.role } });
      invitation = await tx.invitation.create({ data: { tenantId: actor.tenantId, email: values.email, roleId: role.id, token, expiresAt: new Date(0) } });
      roleName = values.role;
    } else {
      const existing = await tx.invitation.findFirst({ where: { id: values.id, tenantId: actor.tenantId } });
      if (!existing) throw new InvitationError("not_found");
      if (await tx.user.findUnique({ where: { email: existing.email }, select: { id: true } })) throw new InvitationError("account_exists");
      const role = await tx.role.findUnique({ where: { id: existing.roleId } });
      if (!role || !isWorkspaceRole(role.name)) throw new InvitationError("invalid_role");
      // Invalidate the old token immediately. The replacement stays expired until delivery succeeds.
      invitation = await tx.invitation.update({ where: { id: existing.id }, data: { token, expiresAt: new Date(0) } });
      roleName = role.name as "SuperAdmin" | "Member" | "Developer";
    }
    const generation = randomUUID();
    const attempt = await tx.externalOperation.create({ data: { tenantId: actor.tenantId, actorId: actor.id, kind: "invitation_delivery",
      idempotencyKey: `invitation_${generation}`, invitationId: invitation.id, invitationGeneration: generation,
      parameterFingerprint: createHash("sha256").update(JSON.stringify({ invitationId: invitation.id, email: invitation.email, role: roleName, generation })).digest("hex") } });
    await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
      action: "INVITATION_DELIVERY", operation: { id: attempt.id, phase: "requested" }, details: { targetId: invitation.id, outcome: "requested" } });
    return { invitation, attempt, roleName };
  });
  const { invitation, attempt, roleName } = reserved;
  // Provider results are system facts. They can be recorded after the initiating
  // admin is revoked, without granting permission to activate any invitation.
  async function recordUnconfirmed(delivered: boolean) {
    await prisma.$transaction(async (tx) => {
      const tenants = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
      if (!tenants.length) return;
      const outcome = delivered ? "delivered_inactive" : "unconfirmed";
      const changed = await tx.externalOperation.updateMany({ where: { id: attempt.id, tenantId: actor.tenantId, state: "pending" },
        data: { state: delivered ? "succeeded" : "unknown", outcomeCode: outcome, resolvedAt: delivered ? new Date() : null } });
      if (!changed.count) return;
      if (!delivered && operation === "create") await tx.invitation.deleteMany({ where: { id: invitation.id, tenantId: actor.tenantId, token } });
      await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "email_delivery" }, action: "INVITATION_DELIVERY",
        operation: { id: attempt.id, phase: outcome }, details: { targetId: invitation.id, outcome } });
    }, { maxWait: 5000, timeout: 10000 });
  }
  try { await sendAccountEmail(invitation.email, "invite", rawToken); }
  catch {
    // Failed creates can be retried in the existing form. Failed resends keep the
    // outstanding row expired for another resend. CAS cannot delete a newer resend.
    try { await recordUnconfirmed(false); } catch { /* Durable pending intent and expired replacement remain safe. */ }
    throw new InvitationError("delivery_failed");
  }
  try {
    return await withActor(actor, async (tx) => {
      const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
      const activated = await tx.invitation.updateMany({ where: { id: invitation.id, tenantId: actor.tenantId, token }, data: { expiresAt } });
      if (activated.count !== 1) throw new InvitationError("changed");
      const finished = await tx.externalOperation.updateMany({ where: { id: attempt.id, tenantId: actor.tenantId, state: "pending" },
        data: { state: "succeeded", outcomeCode: "activated", resolvedAt: new Date() } });
      if (finished.count !== 1) throw new InvitationError("changed");
      await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
        action: operation === "create" ? "MEMBER_INVITED" : "INVITATION_RESENT", operation: { id: attempt.id, phase: "activated" },
        details: { targetId: invitation.id, role: roleName, expiresAt: expiresAt.toISOString() } });
      await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "email_delivery" }, action: "INVITATION_DELIVERY",
        operation: { id: attempt.id, phase: "confirmed" }, details: { targetId: invitation.id, outcome: "activated" } });
      return { id: invitation.id, email: invitation.email, expiresAt };
    });
  } catch (error) {
    try { await recordUnconfirmed(true); } catch { /* Do not pretend the provider send was rolled back. */ }
    if (error instanceof InvitationError || error instanceof AccessDeniedError) throw error;
    throw new InvitationError("activation_unconfirmed");
  }
}

export async function createInvitation(input: unknown) { return issueInvitation(input, "create"); }
export async function resendInvitation(input: unknown) { return issueInvitation(input, "resend"); }
export async function revokeInvitation(input: unknown) {
  const actor = await requirePermission("invitations:manage");
  const { id } = manageInvitationSchema.parse(input);
  return withActor(actor, async (tx) => {
    const deleted = await tx.invitation.deleteMany({ where: { id, tenantId: actor.tenantId } });
    if (deleted.count !== 1) throw new InvitationError("not_found");
    await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
      action: "INVITATION_REVOKED", details: { targetId: id } });
    return { id };
  });
}
