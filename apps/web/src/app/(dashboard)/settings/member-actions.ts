"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AccessDeniedError } from "@/lib/authorization";
import { changeMemberRole, deactivateMember, MemberManagementError } from "@/lib/manage-member";

export type MemberActionState =
  | { success: true; memberId: string; selfChanged: boolean; message: string }
  | { success: false; code: string; error: string }
  | null;

async function performMemberAction(form: FormData, operation: "change-role" | "deactivate"): Promise<MemberActionState> {
  try {
    const fields = new Map<string, FormDataEntryValue>();
    for (const [key, value] of form.entries()) {
      if (key.startsWith("$ACTION_")) continue;
      if (fields.has(key)) return { success: false, code: "invalid_input", error: "Submit each member field only once." };
      fields.set(key, value);
    }
    const result = await (operation === "change-role" ? changeMemberRole : deactivateMember)(Object.fromEntries(fields));
    // A committed mutation remains successful if a subsequent cache refresh fails.
    // Self-changes invalidate this session; the future UI must navigate to login.
    if (!result.selfChanged) {
      try { revalidatePath("/settings"); revalidatePath("/settings/members"); }
      catch { console.error("Member changed, but cache refresh failed."); }
    }
    return { success: true, memberId: result.id, selfChanged: result.selfChanged,
      message: result.selfChanged ? "Your membership changed. Sign in again to continue."
        : operation === "change-role" ? "Member role updated." : "Member deactivated." };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, code: "invalid_input", error: error.issues[0].message };
    if (error instanceof AccessDeniedError) return { success: false, code: "access_denied", error: error.message };
    if (error instanceof MemberManagementError) return { success: false, code: error.code, error: error.message };
    console.error("Member update failed.");
    return { success: false, code: "unavailable", error: "Could not confirm the change. Refresh the member list before trying again." };
  }
}

export async function changeMemberRoleAction(_state: MemberActionState, form: FormData) { return performMemberAction(form, "change-role"); }
export async function deactivateMemberAction(_state: MemberActionState, form: FormData) { return performMemberAction(form, "deactivate"); }
