import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@nexrole/database";
import { emailConfig } from "./email-config";
import { sendAccountEmail } from "./email";
import { isWorkspaceRole } from "./permissions";

export class AccountError extends Error {}
const INVALID_LINK = "This link is invalid, expired, or already used. Request a new one.";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const isDuplicate = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

export async function issueAccountToken(user: { id: string; email: string; sessionVersion: number }, purpose: "verify" | "reset") {
  emailConfig();
  const token = secret();
  await prisma.accountToken.create({ data: {
    tokenHash: hashToken(token), userId: user.id, purpose, sessionVersion: user.sessionVersion,
    expiresAt: new Date(Date.now() + (purpose === "reset" ? 30 * 60_000 : 24 * 60 * 60_000)),
  } });
  // Keep previous links usable if delivery fails. A successful consume invalidates all sibling links.
  await sendAccountEmail(user.email, purpose, token);
}

export async function registerAccount(input: { name: string; email: string; password: string }) {
  emailConfig(); // Detect configuration problems before creating a workspace.
  const passwordHash = await bcrypt.hash(input.password, 12);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const role = await tx.role.upsert({ where: { name: "SuperAdmin" }, update: {}, create: { name: "SuperAdmin", permissions: ["all"] } });
      const tenant = await tx.tenant.create({ data: { name: input.name, subscriptionStatus: "free" } });
      return tx.user.create({ data: { email: input.email, passwordHash, tenantId: tenant.id, roleId: role.id } });
    });
  } catch (error) {
    if (isDuplicate(error)) throw new AccountError("An account with this email already exists. Sign in or request a verification email.");
    throw error;
  }
  try {
    await issueAccountToken(user, "verify");
    return "Your workspace is ready. Check your email to verify your account before signing in.";
  } catch {
    // A delivery failure must not prompt the user to create the same account again.
    console.error("Verification email delivery failed after registration.");
    return "Your workspace was created, but we could not send your verification email. Use Resend verification to try again.";
  }
}

export async function requestAccountEmail(email: string, purpose: "verify" | "reset") {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.isActive || (purpose === "verify" && user.emailVerifiedAt)) return;
  await issueAccountToken(user, purpose);
}

export async function verifyAccount(token: string) {
  await prisma.$transaction(async (tx) => {
    const tokenHash = hashToken(token);
    const record = await tx.accountToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== "verify" || record.expiresAt <= new Date()) throw new AccountError(INVALID_LINK);
    const updated = await tx.user.updateMany({ where: {
      id: record.userId, isActive: true, emailVerifiedAt: null, sessionVersion: record.sessionVersion,
    }, data: { emailVerifiedAt: new Date() } });
    if (updated.count !== 1) throw new AccountError(INVALID_LINK);
    const consumed = await tx.accountToken.deleteMany({ where: { tokenHash, expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) throw new AccountError(INVALID_LINK);
    await tx.accountToken.deleteMany({ where: { userId: record.userId, purpose: "verify" } });
  });
}

export async function resetAccountPassword(token: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const tokenHash = hashToken(token);
    const record = await tx.accountToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== "reset" || record.expiresAt <= new Date()) throw new AccountError(INVALID_LINK);
    const updated = await tx.user.updateMany({ where: {
      id: record.userId, isActive: true, sessionVersion: record.sessionVersion,
    }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new AccountError(INVALID_LINK);
    const consumed = await tx.accountToken.deleteMany({ where: { tokenHash, expiresAt: { gt: new Date() } } });
    if (consumed.count !== 1) throw new AccountError(INVALID_LINK);
    await tx.accountToken.deleteMany({ where: { userId: record.userId } });
  });
}

export async function changeAccountPassword(id: string, tenantId: string, sessionVersion: number, currentPassword: string, password: string) {
  const user = await prisma.user.findFirst({ where: { id, tenantId, isActive: true, sessionVersion, emailVerifiedAt: { not: null } } });
  if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) throw new AccountError("Your current password is incorrect, or your session has expired.");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id, tenantId, isActive: true, sessionVersion },
      data: { passwordHash, sessionVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new AccountError("Your session has expired. Sign in again.");
    await tx.accountToken.deleteMany({ where: { userId: id } });
  });
}

export async function inviteAccount(email: string, roleName: string, tenantId: string) {
  emailConfig();
  if (!isWorkspaceRole(roleName)) throw new AccountError("Invalid workspace role.");
  if (await prisma.user.findUnique({ where: { email } })) throw new AccountError("An account with this email already exists. It cannot join another workspace.");
  const role = await prisma.role.upsert({ where: { name: roleName }, create: { name: roleName, permissions: [] }, update: {} });
  const token = secret();
  const tokenHash = hashToken(token);
  await prisma.invitation.create({ data: { email, token: tokenHash, roleId: role.id, tenantId, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
  try { await sendAccountEmail(email, "invite", token); }
  catch {
    await prisma.invitation.deleteMany({ where: { token: tokenHash } });
    throw new AccountError("We could not send the invitation. Please try again.");
  }
}

export async function acceptInvitation(token: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const tokenHash = hashToken(token);
      const invitation = await tx.invitation.findUnique({ where: { token: tokenHash } });
      if (!invitation || invitation.expiresAt <= new Date()) throw new AccountError(INVALID_LINK);
      const role = await tx.role.findUnique({ where: { id: invitation.roleId } });
      if (!role || !isWorkspaceRole(role.name)) throw new AccountError(INVALID_LINK);
      const consumed = await tx.invitation.deleteMany({ where: { token: tokenHash, expiresAt: { gt: new Date() } } });
      if (consumed.count !== 1) throw new AccountError(INVALID_LINK);
      await tx.user.create({ data: {
        email: invitation.email, passwordHash, roleId: invitation.roleId, tenantId: invitation.tenantId,
        // Possession of an invitation delivered to this address proves email ownership.
        emailVerifiedAt: new Date(),
      } });
    });
  } catch (error) {
    if (isDuplicate(error)) throw new AccountError("An account with this email already exists. Sign in with that account.");
    throw error;
  }
}
