"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AccessDeniedError } from "@/lib/authorization";
import { RateLimitError } from "@/lib/account-rate-limit";
import { createInvitation, resendInvitation, revokeInvitation, InvitationError } from "@/lib/manage-invitation";
import { writeAuditLog } from "@/lib/audit";

export type InvitationActionState = { success: true; id: string; message: string } | { success: false; code: string; error: string } | null;

async function perform(input: unknown, operation: "create" | "resend" | "revoke"): Promise<InvitationActionState> {
  try {
    const result = await (operation === "create" ? createInvitation : operation === "resend" ? resendInvitation : revokeInvitation)(input);
    if (operation === "create") await writeAuditLog("MEMBER_INVITED", { invitationId: result.id });
    try { revalidatePath("/settings"); revalidatePath("/settings/members"); }
    catch { console.error("Invitation changed, but cache refresh failed."); }
    return { success: true, id: result.id, message: operation === "revoke" ? "Invitation revoked." : "Invitation email sent." };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, code: "invalid_input", error: error.issues[0].message };
    if (error instanceof AccessDeniedError) return { success: false, code: "access_denied", error: error.message };
    if (error instanceof RateLimitError) return { success: false, code: "rate_limited", error: error.message };
    if (error instanceof InvitationError) return { success: false, code: error.code, error: error.message };
    console.error("Invitation operation failed.");
    return { success: false, code: "unavailable", error: "Could not confirm the invitation change. Refresh the list before trying again." };
  }
}

// Keep the original form's call contract until its UI checkpoint.
export async function createMemberInvitation(email: string, roleName = "Member") {
  const result = await perform({ email, role: roleName }, "create");
  if (!result?.success) throw new Error(result?.error ?? "Invitation failed.");
  return result;
}

async function fromForm(form: FormData, operation: "create" | "resend" | "revoke"): Promise<InvitationActionState> {
  const fields = new Map<string, FormDataEntryValue>();
  for (const [key, value] of form.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (fields.has(key)) return { success: false, code: "invalid_input", error: "Submit each invitation field only once." };
    fields.set(key, value);
  }
  return perform(Object.fromEntries(fields), operation);
}
export async function createInvitationAction(_state: InvitationActionState, form: FormData) { return fromForm(form, "create"); }
export async function resendInvitationAction(_state: InvitationActionState, form: FormData) { return fromForm(form, "resend"); }
export async function revokeInvitationAction(_state: InvitationActionState, form: FormData) { return fromForm(form, "revoke"); }
