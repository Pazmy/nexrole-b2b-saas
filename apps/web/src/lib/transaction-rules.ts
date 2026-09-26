import { z } from "zod";

export const TRANSACTION_CURRENCY = "USD";
export const INITIAL_TRANSACTION_STATUS = "pending";
export const TRANSACTION_DESCRIPTION_LIMIT = 500;
export const transactionStatusSchema = z.enum(["pending", "completed", "failed"]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

// Accept decimal text from the form, never a floating-point calculation.
// Decimal(10,2) supports 0.01 through 99999999.99; do not round excess precision.
export const transactionAmountSchema = z.string().trim()
  .regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Enter a USD amount with at most 8 whole-number digits and 2 decimal places.")
  .refine((value) => /[1-9]/.test(value), "Amount must be greater than zero.")
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return `${BigInt(whole).toString()}.${fraction.padEnd(2, "0")}`;
  });

export const createTransactionSchema = z.object({
  description: z.string().trim().min(1, "Enter a description.")
    .max(TRANSACTION_DESCRIPTION_LIMIT, "Description must be at most 500 characters."),
  amount: transactionAmountSchema,
}).strict();

export const updateTransactionStatusSchema = z.object({
  id: z.uuid("Choose a valid transaction."),
  status: z.enum(["completed", "failed"], "Choose Completed or Failed."),
}).strict();

// Unknown states and self-transitions fail closed. Terminal transactions cannot reopen.
export function canTransitionTransactionStatus(from: unknown, to: unknown): boolean {
  return from === INITIAL_TRANSACTION_STATUS && (to === "completed" || to === "failed");
}
