"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { requirePermission } from "@/lib/authorization";
import { AccountError, registerAccount, requestAccountEmail, verifyAccount, resetAccountPassword, changeAccountPassword, acceptInvitation, hashToken } from "@/lib/accounts";
import { RateLimitError, limitAccountRequest } from "@/lib/account-rate-limit";
import { emailSchema, newPasswordSchema, registrationSchema, tokenSchema, tokenPasswordSchema, type AccountState } from "@/lib/account-validation";

function failure(error: unknown): AccountState {
  if (error instanceof z.ZodError) return { error: error.issues[0].message };
  if (error instanceof AccountError || error instanceof RateLimitError) return { error: error.message };
  console.error("Account action failed.");
  return { error: "We could not complete this request. Please try again later." };
}

export async function registerWorkspaceAction(_state: AccountState, form: FormData): Promise<AccountState> {
  try {
    const input = registrationSchema.parse(Object.fromEntries(form));
    await limitAccountRequest("register", input.email);
    return { success: true, message: await registerAccount(input) };
  } catch (error) { return failure(error); }
}

async function emailRequest(form: FormData, purpose: "verify" | "reset"): Promise<AccountState> {
  try {
    const email = emailSchema.parse(form.get("email"));
    await limitAccountRequest(`email-${purpose}`, email, 3);
    try { await requestAccountEmail(email, purpose); }
    catch { console.error("Account email request failed."); }
    // Identical response for absent, inactive, verified accounts and delivery errors.
    return { success: true, message: "If this address is eligible, we will send an email. Check your inbox and spam folder. If nothing arrives, wait 15 minutes before trying again." };
  } catch (error) { return failure(error); }
}

export async function forgotPasswordAction(_state: AccountState, form: FormData) { return emailRequest(form, "reset"); }
export async function resendVerificationAction(_state: AccountState, form: FormData) { return emailRequest(form, "verify"); }

export async function verifyEmailAction(_state: AccountState, form: FormData): Promise<AccountState> {
  try {
    const token = tokenSchema.parse(form.get("token"));
    await limitAccountRequest("verify-token", hashToken(token), 10);
    await verifyAccount(token);
    return { success: true, message: "Your email is verified. You can now sign in." };
  } catch (error) { return failure(error); }
}

export async function resetPasswordAction(_state: AccountState, form: FormData): Promise<AccountState> {
  try {
    const input = tokenPasswordSchema.parse(Object.fromEntries(form));
    await limitAccountRequest("reset-token", hashToken(input.token));
    await resetAccountPassword(input.token, input.password);
    return { success: true, message: "Your password has been reset and all previous sessions have ended. Sign in with your new password. If your email is not verified yet, request a verification email first." };
  } catch (error) { return failure(error); }
}

export async function changePasswordAction(_state: AccountState, form: FormData): Promise<AccountState> {
  try {
    const user = await requirePermission("workspace:read");
    const session = await auth();
    if (typeof session?.user?.sessionVersion !== "number") throw new AccountError("Sign in again to continue.");
    await limitAccountRequest("change-password", user.id);
    const currentPassword = z.string().min(1).max(256).parse(form.get("currentPassword"));
    const password = newPasswordSchema.parse(form.get("password"));
    await changeAccountPassword(user.id, user.tenantId, session.user.sessionVersion, currentPassword, password);
    return { success: true, message: "Your password has changed and all sessions have ended. Sign in again with your new password." };
  } catch (error) { return failure(error); }
}

export async function acceptInvitationAction(_state: AccountState, form: FormData): Promise<AccountState> {
  try {
    const input = tokenPasswordSchema.parse(Object.fromEntries(form));
    await limitAccountRequest("accept-invite", hashToken(input.token));
    await acceptInvitation(input.token, input.password);
    return { success: true, message: "You have joined the workspace. You can now sign in." };
  } catch (error) { return failure(error); }
}
