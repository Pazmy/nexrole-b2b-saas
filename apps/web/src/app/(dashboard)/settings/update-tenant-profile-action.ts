"use server";

import { AccessDeniedError, requirePermission } from "@/lib/authorization";
import { withAuthorizedActor, writeRequiredAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export interface ProfileFormState { error?: string | null; success?: string | null; }

export async function updateTenantProfile(_prevState: ProfileFormState | null, formData: FormData) {
  try {
    const actor = await requirePermission("workspace:update");
    const name = formData.get("name") || formData.get("companyName");
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 256) return { error: "Organization name must be between 2 and 256 characters long." };
    await withAuthorizedActor(actor, "workspace:update", async (tx) => {
      const previous = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { name: true } });
      if (previous.name === name.trim()) return;
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { name: name.trim() } });
      await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
        action: "TENANT_PROFILE_UPDATED", details: { previousName: previous.name.slice(0, 256) || "(unnamed)", name: name.trim() } });
    });
    try { revalidatePath("/settings"); } catch { console.error("Profile updated, but cache refresh failed."); }
    return { success: "Organization profile updated successfully!", error: null };
  } catch (error) {
    if (error instanceof AccessDeniedError) return { error: error.message };
    console.error("Organization profile update could not be confirmed.");
    return { error: "An unexpected internal database error occurred.", success: null };
  }
}
