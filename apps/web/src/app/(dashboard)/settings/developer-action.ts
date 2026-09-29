"use server";

import { requirePermission } from "@/lib/authorization";
import { withAuthorizedActor, writeRequiredAudit } from "@/lib/audit";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

export async function generateApiKey(name: string) {
  const actor = await requirePermission("keys:manage");
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 256) throw new Error("API Key label must be between 2 and 256 characters long.");
  const raw = `nr_live_${crypto.randomBytes(24).toString("hex")}`;
  const key = crypto.createHash("sha256").update(raw).digest("hex");
  await withAuthorizedActor(actor, "keys:manage", async (tx) => {
    const created = await tx.apiKey.create({ data: { name: name.trim(), key, tenantId: actor.tenantId } });
    await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
      action: "DEVELOPER_API_KEY_GENERATED", details: { targetId: created.id, name: created.name } });
  });
  try { revalidatePath("/settings"); } catch { console.error("API key created, but cache refresh failed."); }
  return raw;
}

export async function revokeApiKey(keyId: string) {
  const actor = await requirePermission("keys:manage");
  await withAuthorizedActor(actor, "keys:manage", async (tx) => {
    const key = await tx.apiKey.findFirst({ where: { id: keyId, tenantId: actor.tenantId } });
    if (!key) return;
    await tx.apiKey.delete({ where: { id: key.id, tenantId: actor.tenantId } });
    await writeRequiredAudit(tx, { tenantId: actor.tenantId, actor: { kind: "user", id: actor.id, tenantId: actor.tenantId },
      action: "DEVELOPER_API_KEY_REVOKED", details: { targetId: key.id, name: key.name.slice(0, 256) || "(unnamed)" } });
  });
  try { revalidatePath("/settings"); } catch { console.error("API key revoked, but cache refresh failed."); }
}
