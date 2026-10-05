"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AccessDeniedError } from "@/lib/authorization";
import { updateTransactionStatus, TransactionStatusError } from "@/lib/update-transaction-status";

export type TransactionStatusState = { success: true; message: string } | { success: false; error: string; code: string } | null;

export async function updateTransactionStatusAction(_state: TransactionStatusState, form: FormData): Promise<TransactionStatusState> {
  try {
    const fields = new Map<string, FormDataEntryValue>();
    for (const [key, value] of form.entries()) {
      if (key.startsWith("$ACTION_")) continue;
      if (fields.has(key)) return { success: false, code: "invalid_input", error: "Submit each transaction field only once." };
      fields.set(key, value);
    }
    const result = await updateTransactionStatus(Object.fromEntries(fields));
    try {
      revalidatePath(`/transactions/${result.id}`);
      revalidatePath("/transactions");
      revalidatePath("/");
    } catch { console.error("Transaction status changed, but cache refresh failed."); }
    return { success: true, message: `Transaction marked ${result.status}.` };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, code: "invalid_input", error: error.issues[0].message };
    if (error instanceof AccessDeniedError) return { success: false, code: "access_denied", error: error.message };
    if (error instanceof TransactionStatusError) {
      const id = z.uuid().safeParse(form.get("id"));
      if (id.success) {
        try { revalidatePath(`/transactions/${id.data}`); } catch { console.error("Transaction status refresh failed."); }
      }
      return { success: false, code: error.code, error: error.message };
    }
    console.error("Transaction status update failed.");
    return { success: false, code: "unavailable", error: "Could not confirm the update. Refresh before trying again." };
  }
}
