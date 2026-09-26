"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AccessDeniedError } from "@/lib/authorization";
import { createTransaction, TransactionCreationError } from "@/lib/create-transaction";

export type CreateTransactionState =
  | { success: true; transactionId: string; message: string }
  | { success: false; code: "invalid_input" | "access_denied" | "creation_limit_reached" | "subscription_restricted" | "unavailable"; error: string }
  | null;

export async function createTransactionAction(_state: CreateTransactionState, form: FormData): Promise<CreateTransactionState> {
  try {
    const fields = new Map<string, FormDataEntryValue>();
    for (const [key, value] of form.entries()) {
      // React form transport metadata is not application input. All other extra
      // fields (including tenantId, userId, status) go through strict validation.
      if (key.startsWith("$ACTION_")) continue;
      if (fields.has(key)) return { success: false, code: "invalid_input", error: "Submit each transaction field only once." };
      fields.set(key, value);
    }
    const transaction = await createTransaction(Object.fromEntries(fields));
    // The write already committed. A cache failure must not report it as a failed
    // creation and encourage a duplicate submission.
    try {
      revalidatePath("/transactions");
      revalidatePath("/");
    } catch { console.error("Transaction created, but cache refresh failed."); }
    return { success: true, transactionId: transaction.id, message: "Transaction created." };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, code: "invalid_input", error: error.issues[0].message };
    if (error instanceof AccessDeniedError) return { success: false, code: "access_denied", error: error.message };
    if (error instanceof TransactionCreationError) {
      // Return the current quota/billing UI in the same action response.
      try { revalidatePath("/transactions"); } catch { console.error("Transaction policy refresh failed."); }
      return { success: false, code: error.code, error: error.message };
    }
    console.error("Transaction creation failed.");
    return { success: false, code: "unavailable", error: "We could not create the transaction. Check the transaction list before trying again." };
  }
}
