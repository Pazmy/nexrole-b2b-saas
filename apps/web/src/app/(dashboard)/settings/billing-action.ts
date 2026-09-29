"use server";

import { requirePermission } from "@/lib/authorization";
import { getBillingService, getBillingReconciler } from "@/lib/stripe-billing";
import { BillingError, ReconciliationError } from "@nexrole/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function startCheckoutSession() {
  const actor = await requirePermission("billing:manage");
  await getBillingReconciler().reconcile(actor);
  const url = await getBillingService().start(actor, "checkout");
  redirect(url);
}

export async function reconcileBillingAction() {
  const actor = await requirePermission("billing:manage");
  try {
    const result = await getBillingReconciler().reconcile(actor);
    try { revalidatePath("/settings"); revalidatePath("/transactions"); } catch { /* A committed reconciliation remains successful. */ }
    return { success: true as const, reason: result.reason };
  } catch (error) {
    if (error instanceof BillingError || error instanceof ReconciliationError) return { success: false as const, code: error.code, error: error.message };
    return { success: false as const, code: "unavailable", error: "Billing synchronization could not be confirmed. Retry shortly." };
  }
}

export async function startCustomerPortalSession() {
  const actor = await requirePermission("billing:manage");
  const url = await getBillingService().start(actor, "portal");
  redirect(url);
}

// Structured transport for inline feedback; service authorization remains authoritative.
export async function requestBillingSession(intent: "checkout" | "portal") {
  const actor = await requirePermission("billing:manage");
  try {
    if (intent !== "checkout" && intent !== "portal") return { success: false as const, error: "Invalid billing request." };
    if (intent === "checkout") await getBillingReconciler().reconcile(actor);
    const url = await getBillingService().start(actor, intent);
    return { success: true as const, url };
  } catch (error) {
    return { success: false as const, error: error instanceof BillingError || error instanceof ReconciliationError
      ? error.message : "The billing outcome could not be confirmed. Retry to recover the existing request." };
  }
}
